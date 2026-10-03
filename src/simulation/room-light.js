import { rotationMatrixXYZ } from '../model/room-scene.js';
import { createSimulationGrid, DEFAULT_CELL_SIZE, MAX_SIMULATION_CELLS } from './room-grid.js';
import { buildSolidMask } from './room-fields-3d.js';

const DEFAULTS = Object.freeze({ cellSize: DEFAULT_CELL_SIZE, ambientLevel: 0.06, lampStrength: 1.3 });
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function validate(scene, options) {
  if (!scene?.room || !Array.isArray(scene.objects)) {
    throw new TypeError('A room scene with a room and object list is required.');
  }
  const { width, depth, height } = scene.room;
  if (![width, depth, height].every(Number.isFinite)
    || width < 2 || width > 20 || depth < 2 || depth > 20 || height < 2 || height > 6) {
    throw new RangeError('Room dimensions must be 2–20 m wide and deep, and 2–6 m high.');
  }
  const settings = { ...DEFAULTS, ...options };
  if (!Number.isFinite(settings.cellSize) || settings.cellSize < 0.01 || settings.cellSize > 1.5) {
    throw new RangeError('Cell size must be between 0.01 m and 1.5 m.');
  }
  if (!Number.isFinite(settings.ambientLevel) || settings.ambientLevel < 0 || settings.ambientLevel > 0.25) {
    throw new RangeError('Ambient level must be between 0 and 0.25.');
  }
  if (!Number.isFinite(settings.lampStrength) || settings.lampStrength < 0 || settings.lampStrength > 5) {
    throw new RangeError('Lamp strength must be between 0 and 5.');
  }
  const lamps = scene.objects.filter((object) => object.model === 'lamp');
  if (lamps.length > 64) throw new RangeError('A room can contain at most 64 simulated light sources.');
  for (const lamp of lamps) {
    if (![lamp.position?.x, lamp.position?.y, lamp.position?.z,
      lamp.rotation?.x, lamp.rotation?.y, lamp.rotation?.z,
      lamp.dimensions?.width, lamp.dimensions?.height, lamp.dimensions?.depth].every(Number.isFinite)
      || lamp.dimensions.height <= 0) {
      throw new TypeError(`Lamp ${lamp.id ?? '(unknown)'} has invalid geometry.`);
    }
  }
  return { settings, lamps };
}

function toLocal(vector, matrix) {
  return {
    x: matrix[0][0] * vector.x + matrix[1][0] * vector.y + matrix[2][0] * vector.z,
    y: matrix[0][1] * vector.x + matrix[1][1] * vector.y + matrix[2][1] * vector.z,
    z: matrix[0][2] * vector.x + matrix[1][2] * vector.y + matrix[2][2] * vector.z,
  };
}

function isOccluded(source, target, blocker) {
  const start = toLocal({
    x: source.x - blocker.center.x,
    y: source.y - blocker.center.y,
    z: source.z - blocker.center.z,
  }, blocker.inverseRotation);
  const direction = toLocal({
    x: target.x - source.x,
    y: target.y - source.y,
    z: target.z - source.z,
  }, blocker.inverseRotation);
  let near = 0;
  let far = 1;

  for (const axis of ['x', 'y', 'z']) {
    const halfExtent = blocker.halfExtents[axis];
    if (Math.abs(direction[axis]) < 1e-8) {
      if (start[axis] < -halfExtent || start[axis] > halfExtent) return false;
      continue;
    }
    const first = (-halfExtent - start[axis]) / direction[axis];
    const second = (halfExtent - start[axis]) / direction[axis];
    near = Math.max(near, Math.min(first, second));
    far = Math.min(far, Math.max(first, second));
    if (near > far) return false;
  }
  return far > 1e-5 && near < 1 - 1e-5;
}

export function estimateRoomLight(scene, options = {}) {
  const { settings, lamps } = validate(scene, options);
  const grid = createSimulationGrid(scene.room, settings.cellSize);
  const light = new Float32Array(grid.nx * grid.ny * grid.nz).fill(settings.ambientLevel);
  const sources = lamps.map((lamp) => {
    const matrix = rotationMatrixXYZ(lamp.rotation);
    const localBulb = { x: 0, y: lamp.dimensions.height * 0.22, z: 0 };
    return {
      position: {
        x: lamp.position.x + matrix[0][1] * localBulb.y,
        y: lamp.position.y + lamp.dimensions.height / 2 + matrix[1][1] * localBulb.y,
        z: lamp.position.z + matrix[2][1] * localBulb.y,
      },
      direction: [-matrix[0][1], -matrix[1][1], -matrix[2][1]],
      id: lamp.id,
    };
  });
  const blockers = scene.objects.map((object) => ({
    id: object.id,
    center: { x: object.position.x, y: object.position.y + object.dimensions.height / 2, z: object.position.z },
    halfExtents: {
      x: object.dimensions.width / 2,
      y: object.dimensions.height / 2,
      z: object.dimensions.depth / 2,
    },
    inverseRotation: rotationMatrixXYZ(object.rotation),
  }));
  let total = 0;
  let maximum = settings.ambientLevel;

  for (let j = 0; j < grid.ny; j += 1) {
    for (let k = 0; k < grid.nz; k += 1) {
      for (let i = 0; i < grid.nx; i += 1) {
        const index = (j * grid.nz + k) * grid.nx + i;
        const point = { x: (i + 0.5) * grid.dx, y: (j + 0.5) * grid.dy, z: (k + 0.5) * grid.dz };
        let illumination = settings.ambientLevel;
        for (const source of sources) {
          const dx = point.x - source.position.x;
          const dy = point.y - source.position.y;
          const dz = point.z - source.position.z;
          const distanceSquared = dx ** 2 + dy ** 2 + dz ** 2;
          const distance = Math.sqrt(distanceSquared);
          if (distance < 1e-6) continue;
          if (blockers.some((blocker) => blocker.id !== source.id && isOccluded(source.position, point, blocker))) continue;
          const cosine = Math.max(0, (dx * source.direction[0] + dy * source.direction[1] + dz * source.direction[2]) / distance);
          const irradiance = settings.lampStrength * cosine ** 2 / (distanceSquared + 0.25);
          illumination += irradiance / (0.5 + irradiance);
        }
        light[index] = clamp(illumination, 0, 1);
        total += light[index];
        maximum = Math.max(maximum, light[index]);
      }
    }
  }

  return {
    grid,
    fields: { light, solid: buildSolidMask(scene, grid) },
    backend: 'cpu-light',
    ambientLevel: settings.ambientLevel,
    assumptions: Object.freeze({
      model: 'relative light falloff estimate',
      units: 'normalized 0–1 intensity; not lux or calibrated photometry',
      sources: 'downward-oriented lamp presets with inverse-square-like falloff',
      occlusion: 'opaque box shadows from room objects',
      maximumGridCells: MAX_SIMULATION_CELLS,
    }),
    stats: {
      sourceCount: lamps.length,
      meanLevel: Number((total / light.length).toFixed(3)),
      maxLevel: Number(maximum.toFixed(3)),
    },
  };
}
