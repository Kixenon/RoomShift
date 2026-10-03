import { rotatedHalfExtents, rotationMatrixXYZ } from '../model/room-scene.js';
import { findObjectCollision } from '../model/room-collision.js';

const LIMITS = Object.freeze({
  roomMin: 2,
  roomMax: 20,
  heightMin: 2,
  heightMax: 6,
  minCellSize: 0.15,
  maxCellSize: 0.75,
  minSteps: 1,
  maxSteps: 240,
  minPressureIterations: 4,
  maxPressureIterations: 20,
  maxGridX: 40,
  maxGridY: 24,
  maxGridZ: 40,
  maxSpeed: 2.5,
  maxTemperature: 60,
});

export const FIELD_PHYSICS_DEFAULTS = Object.freeze({
  ambientTemperature: 20,
  outdoorTemperature: 10,
  kinematicViscosity: 0.018,
  effectiveThermalDiffusivity: 0.018,
  coolingRate: 0.02,
  fanAcceleration: 4.5,
  fanRange: 3.8,
  heaterRate: 0.8,
  heaterRadius: 0.45,
});
const DEFAULTS = Object.freeze({
  ...FIELD_PHYSICS_DEFAULTS,
  cellSize: 0.15,
  steps: 120,
  timeStep: 0.05,
  pressureIterations: 20,
});
const FAN_SOURCE_GRID_CELLS = 1.25;

export const FIELD_ASSUMPTIONS = Object.freeze({
  model: 'simplified 3D transient advection-diffusion estimate',
  defaultCellSizeMeters: DEFAULTS.cellSize,
  defaultDurationSeconds: DEFAULTS.steps * DEFAULTS.timeStep,
  maximumGridDimensions: Object.freeze([LIMITS.maxGridX, LIMITS.maxGridY, LIMITS.maxGridZ]),
  maximumGridCells: LIMITS.maxGridX * LIMITS.maxGridY * LIMITS.maxGridZ,
  maximumSteps: LIMITS.maxSteps,
  maximumPressureIterations: LIMITS.maxPressureIterations,
  maximumSpeedMetersPerSecond: LIMITS.maxSpeed,
  thermalSourceUnits: 'estimated degrees Celsius per second',
  thermalDiffusivity: 'effective mixing coefficient; not molecular air diffusivity',
  boundaries: 'closed walls with prescribed window flow and outdoor-temperature inflow',
});

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const indexOf = (i, j, k, grid) => (j * grid.nz + k) * grid.nx + i;

export function validateScene(scene) {
  if (!scene?.room || !Array.isArray(scene.objects)) {
    throw new TypeError('A room scene with a room and object list is required.');
  }
  const { width, depth, height } = scene.room;
  if (![width, depth, height].every(Number.isFinite)
    || width < LIMITS.roomMin || width > LIMITS.roomMax
    || depth < LIMITS.roomMin || depth > LIMITS.roomMax
    || height < LIMITS.heightMin || height > LIMITS.heightMax) {
    throw new RangeError('Room dimensions are outside the supported 2–20 m footprint and 2–6 m height.');
  }
  if (scene.room.outdoorTemperature !== undefined
    && (!Number.isFinite(scene.room.outdoorTemperature) || scene.room.outdoorTemperature < -20 || scene.room.outdoorTemperature > 50)) {
    throw new RangeError('Outdoor temperature must be between -20 °C and 50 °C.');
  }

  for (const object of scene.objects) {
    if (![object?.position?.x, object?.position?.y, object?.position?.z,
      object?.dimensions?.width, object?.dimensions?.height, object?.dimensions?.depth,
      object?.rotation?.x, object?.rotation?.y, object?.rotation?.z].every(Number.isFinite)
      || object.dimensions.width <= 0 || object.dimensions.height <= 0 || object.dimensions.depth <= 0) {
      throw new TypeError(`Object ${object?.id ?? '(unknown)'} has invalid geometry.`);
    }
    if (['fan', 'heater', 'lamp'].includes(object.model)
      && object.intensity !== undefined
      && (!Number.isFinite(object.intensity) || object.intensity < 0 || object.intensity > 2)) {
      throw new RangeError(`Object ${object.id ?? '(unknown)'} source strength must be between 0 and 2.`);
    }
    if (object.model === 'fan' && object.enabled !== undefined && typeof object.enabled !== 'boolean') {
      throw new TypeError(`Fan ${object.id ?? '(unknown)'} enabled state must be boolean.`);
    }
    if (object.model === 'window'
      && ((object.flowDirection !== undefined && !['exchange', 'inlet', 'outlet'].includes(object.flowDirection))
        || (object.flowRate !== undefined && (!Number.isFinite(object.flowRate) || object.flowRate < 0 || object.flowRate > 1.5)))) {
      throw new RangeError(`Window ${object.id ?? '(unknown)'} has invalid airflow settings.`);
    }
    const [halfWidth, halfHeight, halfDepth] = rotatedHalfExtents(object.dimensions, object.rotation);
    const { x, y, z } = object.position;
    const tolerance = 1e-7;
    if (x - halfWidth < -tolerance || x + halfWidth > width + tolerance
      || y + object.dimensions.height / 2 - halfHeight < -tolerance
      || y + object.dimensions.height / 2 + halfHeight > height + tolerance
      || z - halfDepth < -tolerance || z + halfDepth > depth + tolerance) {
      throw new RangeError(`Object ${object.id ?? '(unknown)'} extends outside room bounds.`);
    }
  }

  for (let index = 0; index < scene.objects.length; index += 1) {
    const collision = findObjectCollision(scene.objects.slice(0, index), scene.objects[index]);
    if (collision) throw new RangeError(`Objects ${scene.objects[index].name} and ${collision.name} overlap.`);
  }
}

function validateOptions(options, room) {
  const values = {
    ...DEFAULTS,
    ...options,
    outdoorTemperature: options.outdoorTemperature ?? room.outdoorTemperature ?? DEFAULTS.outdoorTemperature,
  };
  if (!Number.isFinite(values.cellSize) || values.cellSize < LIMITS.minCellSize || values.cellSize > LIMITS.maxCellSize) {
    throw new RangeError(`Cell size must be between ${LIMITS.minCellSize} m and ${LIMITS.maxCellSize} m.`);
  }
  if (!Number.isInteger(values.steps) || values.steps < LIMITS.minSteps || values.steps > LIMITS.maxSteps) {
    throw new RangeError(`Simulation steps must be an integer from ${LIMITS.minSteps} to ${LIMITS.maxSteps}.`);
  }
  if (!Number.isInteger(values.pressureIterations)
    || values.pressureIterations < LIMITS.minPressureIterations
    || values.pressureIterations > LIMITS.maxPressureIterations) {
    throw new RangeError(`Pressure iterations must be an integer from ${LIMITS.minPressureIterations} to ${LIMITS.maxPressureIterations}.`);
  }
  if (!Number.isFinite(values.ambientTemperature) || values.ambientTemperature < 0 || values.ambientTemperature > 40) {
    throw new RangeError('Ambient temperature must be between 0 °C and 40 °C.');
  }
  if (!Number.isFinite(values.outdoorTemperature) || values.outdoorTemperature < -20 || values.outdoorTemperature > 50) {
    throw new RangeError('Outdoor temperature must be between -20 °C and 50 °C.');
  }

  const roomReach = Math.hypot(room.width, room.depth, room.height);
  const boundedParameters = [
    ['timeStep', 0.0001, 0.05],
    ['kinematicViscosity', 0, 0.05],
    ['effectiveThermalDiffusivity', 0, 0.05],
    ['coolingRate', 0, 1],
    ['fanAcceleration', 0, 10],
    ['fanRange', 0.05, roomReach],
    ['heaterRate', 0, 10],
    ['heaterRadius', 0.05, roomReach],
  ];
  for (const [name, min, max] of boundedParameters) {
    if (!Number.isFinite(values[name]) || values[name] < min || values[name] > max) {
      throw new RangeError(`${name} must be a finite value between ${min} and ${max}.`);
    }
  }
  return values;
}

function buildGrid(room, cellSize) {
  const nx = clamp(Math.ceil(room.width / cellSize), 4, LIMITS.maxGridX);
  const ny = clamp(Math.ceil(room.height / cellSize), 4, LIMITS.maxGridY);
  const nz = clamp(Math.ceil(room.depth / cellSize), 4, LIMITS.maxGridZ);
  return {
    width: room.width,
    height: room.height,
    depth: room.depth,
    nx,
    ny,
    nz,
    dx: room.width / nx,
    dy: room.height / ny,
    dz: room.depth / nz,
  };
}

function cellPosition(i, j, k, grid) {
  return { x: (i + 0.5) * grid.dx, y: (j + 0.5) * grid.dy, z: (k + 0.5) * grid.dz };
}

function inverseRotate(x, y, z, matrix) {
  return {
    x: matrix[0][0] * x + matrix[1][0] * y + matrix[2][0] * z,
    y: matrix[0][1] * x + matrix[1][1] * y + matrix[2][1] * z,
    z: matrix[0][2] * x + matrix[1][2] * y + matrix[2][2] * z,
  };
}

export function buildSolidMask(scene, grid) {
  const solid = new Uint8Array(grid.nx * grid.ny * grid.nz);
  for (const object of scene.objects) {
    if (object.model === 'fan' || object.model === 'window') continue;
    const [halfWidth, halfHeight, halfDepth] = rotatedHalfExtents(object.dimensions, object.rotation);
    const centerY = object.position.y + object.dimensions.height / 2;
    const minI = clamp(Math.floor((object.position.x - halfWidth) / grid.dx), 0, grid.nx - 1);
    const maxI = clamp(Math.floor((object.position.x + halfWidth) / grid.dx), 0, grid.nx - 1);
    const minJ = clamp(Math.floor((centerY - halfHeight) / grid.dy), 0, grid.ny - 1);
    const maxJ = clamp(Math.floor((centerY + halfHeight) / grid.dy), 0, grid.ny - 1);
    const minK = clamp(Math.floor((object.position.z - halfDepth) / grid.dz), 0, grid.nz - 1);
    const maxK = clamp(Math.floor((object.position.z + halfDepth) / grid.dz), 0, grid.nz - 1);
    const matrix = rotationMatrixXYZ(object.rotation);

    for (let j = minJ; j <= maxJ; j += 1) {
      for (let k = minK; k <= maxK; k += 1) {
        for (let i = minI; i <= maxI; i += 1) {
          const position = cellPosition(i, j, k, grid);
          const local = inverseRotate(
            position.x - object.position.x,
            position.y - centerY,
            position.z - object.position.z,
            matrix,
          );
          if (Math.abs(local.x) <= object.dimensions.width / 2
            && Math.abs(local.y) <= object.dimensions.height / 2
            && Math.abs(local.z) <= object.dimensions.depth / 2) {
            solid[indexOf(i, j, k, grid)] = 1;
          }
        }
      }
    }
  }
  return solid;
}

export function buildOutletMask(scene, grid, settings = {}) {
  return buildWindowBoundary(scene, grid, settings).outlets;
}

export function buildWindowBoundary(scene, grid, settings = {}) {
  const count = grid.nx * grid.ny * grid.nz;
  const outlets = new Uint8Array(count);
  const flow = new Float32Array(count);
  for (const window of scene.objects) {
    if (window.model !== 'window' || !window.open) continue;
    const alongX = window.wall === 'back' || window.wall === 'front';
    const sideBit = window.wall === 'left' ? 1
      : window.wall === 'right' ? 2
        : window.wall === 'front' ? 16 : 32;
    const firstJ = clamp(Math.floor(window.position.y / grid.dy), 0, grid.ny - 1);
    const lastJ = clamp(Math.floor((window.position.y + window.dimensions.height) / grid.dy), 0, grid.ny - 1);
    const direction = window.flowDirection ?? 'exchange';
    const wallSign = window.wall === 'left' || window.wall === 'front' ? -1 : 1;
    const speed = window.flowRate ?? 0.35;
    const alongCells = alongX ? grid.nx : grid.nz;
    const alongSpacing = alongX ? grid.dx : grid.dz;
    const alongPosition = alongX ? window.position.x : window.position.z;
    const firstAlong = clamp(Math.floor((alongPosition - window.dimensions.width / 2) / alongSpacing), 0, alongCells - 1);
    const lastAlong = clamp(Math.floor((alongPosition + window.dimensions.width / 2) / alongSpacing), 0, alongCells - 1);
    const cells = [];
    for (let j = firstJ; j <= lastJ; j += 1) {
      for (let along = firstAlong; along <= lastAlong; along += 1) {
        const i = alongX ? along : window.wall === 'left' ? 0 : grid.nx - 1;
        const k = alongX ? window.wall === 'front' ? 0 : grid.nz - 1 : along;
        cells.push({ index: indexOf(i, j, k, grid), j, along });
      }
    }

    let inlets = [];
    let exits = [];
    if (direction === 'exchange') {
      const outdoorAirIsWarmer = (settings.outdoorTemperature ?? scene.room.outdoorTemperature ?? DEFAULTS.outdoorTemperature)
        > (settings.ambientTemperature ?? DEFAULTS.ambientTemperature);
      cells.sort((a, b) => outdoorAirIsWarmer ? b.j - a.j || a.along - b.along : a.j - b.j || a.along - b.along);
      const split = Math.floor(cells.length / 2);
      if (split === 0) continue;
      inlets = cells.slice(0, split);
      exits = cells.slice(split);
    } else if (direction === 'inlet') {
      inlets = cells;
    } else {
      exits = cells;
    }

    const exchangeSpeed = direction === 'exchange' ? speed * cells.length / (2 * inlets.length) : speed;
    for (const { index } of inlets) {
      outlets[index] |= sideBit;
      flow[index] = -wallSign * exchangeSpeed;
    }
    const exitSpeed = direction === 'exchange' ? speed * cells.length / (2 * exits.length) : speed;
    for (const { index } of exits) {
      outlets[index] |= sideBit;
      flow[index] = wallSign * exitSpeed;
    }
  }
  return { outlets, flow };
}

function sampleField(field, x, y, z, grid, solid, fallback, skipSolid = false) {
  if (x < 0 || x > grid.width || y < 0 || y > grid.height || z < 0 || z > grid.depth) return fallback;
  const gx = clamp(x / grid.dx - 0.5, 0, grid.nx - 1);
  const gy = clamp(y / grid.dy - 0.5, 0, grid.ny - 1);
  const gz = clamp(z / grid.dz - 0.5, 0, grid.nz - 1);
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const z0 = Math.floor(gz);
  const x1 = Math.min(x0 + 1, grid.nx - 1);
  const y1 = Math.min(y0 + 1, grid.ny - 1);
  const z1 = Math.min(z0 + 1, grid.nz - 1);
  const tx = gx - x0;
  const ty = gy - y0;
  const tz = gz - z0;
  let value = 0;
  let weightTotal = 0;

  for (let oy = 0; oy <= 1; oy += 1) {
    for (let oz = 0; oz <= 1; oz += 1) {
      for (let ox = 0; ox <= 1; ox += 1) {
        const i = ox ? x1 : x0;
        const j = oy ? y1 : y0;
        const k = oz ? z1 : z0;
        const weight = (ox ? tx : 1 - tx) * (oy ? ty : 1 - ty) * (oz ? tz : 1 - tz);
        const index = indexOf(i, j, k, grid);
        if (skipSolid && solid[index]) continue;
        value += (solid[index] ? fallback : field[index]) * weight;
        weightTotal += weight;
      }
    }
  }
  if (skipSolid) return weightTotal > 1e-8 ? value / weightTotal : fallback;
  return value;
}

function clipBacktrace(position, back, grid, solid) {
  const distance = Math.hypot(back.x - position.x, back.y - position.y, back.z - position.z);
  const stepLength = Math.min(grid.dx, grid.dy, grid.dz) * 0.5;
  const steps = Math.max(1, Math.ceil(distance / stepLength));
  let lastFluidPoint = position;
  for (let step = 1; step <= steps; step += 1) {
    const fraction = step / steps;
    const point = {
      x: position.x + (back.x - position.x) * fraction,
      y: position.y + (back.y - position.y) * fraction,
      z: position.z + (back.z - position.z) * fraction,
    };
    if (point.x < 0 || point.x > grid.width || point.y < 0 || point.y > grid.height
      || point.z < 0 || point.z > grid.depth) continue;
    const i = Math.min(grid.nx - 1, Math.floor(point.x / grid.dx));
    const j = Math.min(grid.ny - 1, Math.floor(point.y / grid.dy));
    const k = Math.min(grid.nz - 1, Math.floor(point.z / grid.dz));
    if (solid[indexOf(i, j, k, grid)]) return lastFluidPoint;
    lastFluidPoint = point;
  }
  return back;
}

function advect(field, u, v, w, grid, solid, timeStep, fallback, skipSolid = false) {
  const next = new Float32Array(field.length);
  for (let j = 0; j < grid.ny; j += 1) {
    for (let k = 0; k < grid.nz; k += 1) {
      for (let i = 0; i < grid.nx; i += 1) {
        const index = indexOf(i, j, k, grid);
        if (solid[index]) {
          next[index] = fallback;
          continue;
        }
        const position = cellPosition(i, j, k, grid);
        const back = clipBacktrace(position, {
          x: position.x - u[index] * timeStep,
          y: position.y - v[index] * timeStep,
          z: position.z - w[index] * timeStep,
        }, grid, solid);
        next[index] = sampleField(field, back.x, back.y, back.z, grid, solid, fallback, skipSolid);
      }
    }
  }
  return next;
}

function neighborValue(field, i, j, k, di, dj, dk, center, grid, solid) {
  const ni = i + di;
  const nj = j + dj;
  const nk = k + dk;
  if (ni < 0 || ni >= grid.nx || nj < 0 || nj >= grid.ny || nk < 0 || nk >= grid.nz) return center;
  const index = indexOf(ni, nj, nk, grid);
  return solid[index] ? center : field[index];
}

function laplacian(field, i, j, k, grid, solid) {
  const center = field[indexOf(i, j, k, grid)];
  return (neighborValue(field, i, j, k, -1, 0, 0, center, grid, solid)
      - 2 * center + neighborValue(field, i, j, k, 1, 0, 0, center, grid, solid)) / (grid.dx ** 2)
    + (neighborValue(field, i, j, k, 0, -1, 0, center, grid, solid)
      - 2 * center + neighborValue(field, i, j, k, 0, 1, 0, center, grid, solid)) / (grid.dy ** 2)
    + (neighborValue(field, i, j, k, 0, 0, -1, center, grid, solid)
      - 2 * center + neighborValue(field, i, j, k, 0, 0, 1, center, grid, solid)) / (grid.dz ** 2);
}

function applyVelocityBoundaries(u, v, w, grid, solid, outlets, windowFlow) {
  for (let j = 0; j < grid.ny; j += 1) {
    for (let k = 0; k < grid.nz; k += 1) {
      for (let i = 0; i < grid.nx; i += 1) {
        const index = indexOf(i, j, k, grid);
        if (solid[index]) {
          u[index] = 0;
          v[index] = 0;
          w[index] = 0;
          continue;
        }
        if (i === 0) u[index] = outlets[index] & 1 ? windowFlow[index] : 0;
        if (i === grid.nx - 1) u[index] = outlets[index] & 2 ? windowFlow[index] : 0;
        if (j === 0 || j === grid.ny - 1) v[index] = 0;
        if (k === 0) w[index] = outlets[index] & 16 ? windowFlow[index] : 0;
        if (k === grid.nz - 1) w[index] = outlets[index] & 32 ? windowFlow[index] : 0;
        if ((i > 0 && solid[indexOf(i - 1, j, k, grid)] && u[index] < 0)
          || (i + 1 < grid.nx && solid[indexOf(i + 1, j, k, grid)] && u[index] > 0)) u[index] = 0;
        if ((j > 0 && solid[indexOf(i, j - 1, k, grid)] && v[index] < 0)
          || (j + 1 < grid.ny && solid[indexOf(i, j + 1, k, grid)] && v[index] > 0)) v[index] = 0;
        if ((k > 0 && solid[indexOf(i, j, k - 1, grid)] && w[index] < 0)
          || (k + 1 < grid.nz && solid[indexOf(i, j, k + 1, grid)] && w[index] > 0)) w[index] = 0;
      }
    }
  }
}

function rayIntersectsBox(start, endX, endY, endZ, box) {
  const matrix = box.rotation;
  const offsetX = start.x - box.center.x;
  const offsetY = start.y - box.center.y;
  const offsetZ = start.z - box.center.z;
  const directionX = endX - start.x;
  const directionY = endY - start.y;
  const directionZ = endZ - start.z;
  const localStartX = matrix[0][0] * offsetX + matrix[1][0] * offsetY + matrix[2][0] * offsetZ;
  const localStartY = matrix[0][1] * offsetX + matrix[1][1] * offsetY + matrix[2][1] * offsetZ;
  const localStartZ = matrix[0][2] * offsetX + matrix[1][2] * offsetY + matrix[2][2] * offsetZ;
  const localDirectionX = matrix[0][0] * directionX + matrix[1][0] * directionY + matrix[2][0] * directionZ;
  const localDirectionY = matrix[0][1] * directionX + matrix[1][1] * directionY + matrix[2][1] * directionZ;
  const localDirectionZ = matrix[0][2] * directionX + matrix[1][2] * directionY + matrix[2][2] * directionZ;
  let near = 0;
  let far = 1;
  if (Math.abs(localDirectionX) < 1e-8) {
    if (localStartX < -box.halfWidth || localStartX > box.halfWidth) return false;
  } else {
    const first = (-box.halfWidth - localStartX) / localDirectionX;
    const second = (box.halfWidth - localStartX) / localDirectionX;
    near = Math.max(near, Math.min(first, second));
    far = Math.min(far, Math.max(first, second));
    if (near > far) return false;
  }
  if (Math.abs(localDirectionY) < 1e-8) {
    if (localStartY < -box.halfHeight || localStartY > box.halfHeight) return false;
  } else {
    const first = (-box.halfHeight - localStartY) / localDirectionY;
    const second = (box.halfHeight - localStartY) / localDirectionY;
    near = Math.max(near, Math.min(first, second));
    far = Math.min(far, Math.max(first, second));
    if (near > far) return false;
  }
  if (Math.abs(localDirectionZ) < 1e-8) {
    if (localStartZ < -box.halfDepth || localStartZ > box.halfDepth) return false;
  } else {
    const first = (-box.halfDepth - localStartZ) / localDirectionZ;
    const second = (box.halfDepth - localStartZ) / localDirectionZ;
    near = Math.max(near, Math.min(first, second));
    far = Math.min(far, Math.max(first, second));
    if (near > far) return false;
  }
  return far > 1e-5 && near < 1 - 1e-5;
}

function rayIsClear(start, endX, endY, endZ, blockers) {
  for (const blocker of blockers) {
    if (rayIntersectsBox(start, endX, endY, endZ, blocker)) return false;
  }
  return true;
}

export function buildFanAccelerationField(scene, grid, solid, settings = DEFAULTS) {
  const acceleration = new Float32Array(grid.nx * grid.ny * grid.nz * 4);
  const fans = scene.objects.filter((object) => object.model === 'fan' && object.enabled !== false);
  const blockers = scene.objects.filter((object) => object.model !== 'fan' && object.model !== 'window').map((object) => ({
    center: { x: object.position.x, y: object.position.y + object.dimensions.height / 2, z: object.position.z },
    halfWidth: object.dimensions.width / 2,
    halfHeight: object.dimensions.height / 2,
    halfDepth: object.dimensions.depth / 2,
    rotation: rotationMatrixXYZ(object.rotation),
  }));
  for (const fan of fans) {
    const matrix = rotationMatrixXYZ(fan.rotation);
    const direction = [matrix[0][2], matrix[1][2], matrix[2][2]];
    const localSource = { x: 0, y: fan.dimensions.height * 0.24, z: fan.dimensions.depth * 0.1 };
    const source = {
      x: fan.position.x + matrix[0][0] * localSource.x + matrix[0][1] * localSource.y + matrix[0][2] * localSource.z,
      y: fan.position.y + fan.dimensions.height / 2 + matrix[1][0] * localSource.x + matrix[1][1] * localSource.y + matrix[1][2] * localSource.z,
      z: fan.position.z + matrix[2][0] * localSource.x + matrix[2][1] * localSource.y + matrix[2][2] * localSource.z,
    };
    const sourceReach = FAN_SOURCE_GRID_CELLS * Math.hypot(
      grid.dx * direction[0],
      grid.dy * direction[1],
      grid.dz * direction[2],
    );
    for (let j = 0; j < grid.ny; j += 1) {
      for (let k = 0; k < grid.nz; k += 1) {
        for (let i = 0; i < grid.nx; i += 1) {
          const index = indexOf(i, j, k, grid);
          if (solid[index]) continue;
          const x = (i + 0.5) * grid.dx;
          const y = (j + 0.5) * grid.dy;
          const z = (k + 0.5) * grid.dz;
          const dx = x - source.x;
          const dy = y - source.y;
          const dz = z - source.z;
          const forward = dx * direction[0] + dy * direction[1] + dz * direction[2];
          if (forward < -sourceReach || forward > settings.fanRange) continue;
          const lateralSquared = Math.max(0, dx ** 2 + dy ** 2 + dz ** 2 - forward ** 2);
          const spread = Math.max(0.12, fan.dimensions.width * 0.32) + Math.max(0, forward) * 0.28;
          if (lateralSquared > 9 * spread ** 2 || !rayIsClear(source, x, y, z, blockers)) continue;
          const upstreamFade = Math.exp(-0.5 * (Math.min(0, forward) / sourceReach) ** 2);
          const beam = Math.exp(-lateralSquared / (2 * spread ** 2))
            * Math.exp(-Math.max(0, forward) / settings.fanRange)
            * upstreamFade;
          const magnitude = settings.fanAcceleration * (fan.intensity ?? 1) * beam;
          const offset = index * 4;
          acceleration[offset] += direction[0] * magnitude;
          acceleration[offset + 1] += direction[1] * magnitude;
          acceleration[offset + 2] += direction[2] * magnitude;
        }
      }
    }
  }
  return acceleration;
}

function applyFanForces(u, v, w, acceleration, timeStep) {
  for (let index = 0; index < u.length; index += 1) {
    const offset = index * 4;
    u[index] += acceleration[offset] * timeStep;
    v[index] += acceleration[offset + 1] * timeStep;
    w[index] += acceleration[offset + 2] * timeStep;
  }
}

function applyBuoyancy(v, temperature, solid, timeStep, ambientTemperature) {
  const accelerationPerDegree = 9.81 / (ambientTemperature + 273.15);
  for (let index = 0; index < v.length; index += 1) {
    if (!solid[index]) {
      v[index] += (temperature[index] - ambientTemperature) * accelerationPerDegree * timeStep;
    }
  }
}

function projectVelocity(u, v, w, grid, solid, outlets, windowFlow, iterations) {
  let pressure = new Float32Array(u.length);
  let nextPressure = new Float32Array(u.length);
  const divergence = new Float32Array(u.length);
  const ix = 1 / (grid.dx ** 2);
  const iy = 1 / (grid.dy ** 2);
  const iz = 1 / (grid.dz ** 2);
  const denominator = 2 * (ix + iy + iz);

  for (let j = 0; j < grid.ny; j += 1) {
    for (let k = 0; k < grid.nz; k += 1) {
      for (let i = 0; i < grid.nx; i += 1) {
        const index = indexOf(i, j, k, grid);
        if (solid[index]) continue;
        const leftU = neighborValue(u, i, j, k, -1, 0, 0, 0, grid, solid);
        const rightU = neighborValue(u, i, j, k, 1, 0, 0, 0, grid, solid);
        const belowV = neighborValue(v, i, j, k, 0, -1, 0, 0, grid, solid);
        const aboveV = neighborValue(v, i, j, k, 0, 1, 0, 0, grid, solid);
        const nearW = neighborValue(w, i, j, k, 0, 0, -1, 0, grid, solid);
        const farW = neighborValue(w, i, j, k, 0, 0, 1, 0, grid, solid);
        divergence[index] = (rightU - leftU) / (2 * grid.dx)
          + (aboveV - belowV) / (2 * grid.dy)
          + (farW - nearW) / (2 * grid.dz);
      }
    }
  }

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    nextPressure.fill(0);
    for (let j = 0; j < grid.ny; j += 1) {
      for (let k = 0; k < grid.nz; k += 1) {
        for (let i = 0; i < grid.nx; i += 1) {
          const index = indexOf(i, j, k, grid);
          if (solid[index]) continue;
          const center = pressure[index];
          const left = neighborValue(pressure, i, j, k, -1, 0, 0, center, grid, solid);
          const right = neighborValue(pressure, i, j, k, 1, 0, 0, center, grid, solid);
          const below = neighborValue(pressure, i, j, k, 0, -1, 0, center, grid, solid);
          const above = neighborValue(pressure, i, j, k, 0, 1, 0, center, grid, solid);
          const near = neighborValue(pressure, i, j, k, 0, 0, -1, center, grid, solid);
          const far = neighborValue(pressure, i, j, k, 0, 0, 1, center, grid, solid);
          nextPressure[index] = (ix * (left + right) + iy * (below + above)
            + iz * (near + far) - divergence[index]) / denominator;
        }
      }
    }
    [pressure, nextPressure] = [nextPressure, pressure];
  }

  for (let j = 0; j < grid.ny; j += 1) {
    for (let k = 0; k < grid.nz; k += 1) {
      for (let i = 0; i < grid.nx; i += 1) {
        const index = indexOf(i, j, k, grid);
        if (solid[index]) continue;
        const center = pressure[index];
        const left = neighborValue(pressure, i, j, k, -1, 0, 0, center, grid, solid);
        const right = neighborValue(pressure, i, j, k, 1, 0, 0, center, grid, solid);
        const below = neighborValue(pressure, i, j, k, 0, -1, 0, center, grid, solid);
        const above = neighborValue(pressure, i, j, k, 0, 1, 0, center, grid, solid);
        const near = neighborValue(pressure, i, j, k, 0, 0, -1, center, grid, solid);
        const far = neighborValue(pressure, i, j, k, 0, 0, 1, center, grid, solid);
        u[index] -= (right - left) / (2 * grid.dx);
        v[index] -= (above - below) / (2 * grid.dy);
        w[index] -= (far - near) / (2 * grid.dz);
      }
    }
  }
  applyVelocityBoundaries(u, v, w, grid, solid, outlets, windowFlow);
}

function diffuse(field, coefficient, timeStep, grid, solid, clampMin, clampMax) {
  if (coefficient === 0) return field;
  const next = new Float32Array(field.length);
  for (let j = 0; j < grid.ny; j += 1) {
    for (let k = 0; k < grid.nz; k += 1) {
      for (let i = 0; i < grid.nx; i += 1) {
        const index = indexOf(i, j, k, grid);
        if (solid[index]) continue;
        next[index] = clamp(field[index] + coefficient * timeStep * laplacian(field, i, j, k, grid, solid), clampMin, clampMax);
      }
    }
  }
  return next;
}

function addHeatSources(temperature, heaters, grid, solid, settings, timeStep) {
  for (const heater of heaters) {
    const centerY = heater.position.y + heater.dimensions.height / 2;
    const radiusSquared = 2 * settings.heaterRadius ** 2;
    for (let j = 0; j < grid.ny; j += 1) {
      for (let k = 0; k < grid.nz; k += 1) {
        for (let i = 0; i < grid.nx; i += 1) {
          const index = indexOf(i, j, k, grid);
          if (solid[index]) continue;
          const position = cellPosition(i, j, k, grid);
          const distanceSquared = (position.x - heater.position.x) ** 2
            + (position.y - centerY) ** 2 + (position.z - heater.position.z) ** 2;
          temperature[index] += settings.heaterRate * (heater.intensity ?? 1) * Math.exp(-distanceSquared / radiusSquared) * timeStep;
        }
      }
    }
  }
}

function calculateStats(u, v, w, temperature, solid, grid, ambientTemperature) {
  let maxSpeed = 0;
  let divergenceSquared = 0;
  let fluidCells = 0;
  let totalTemperature = 0;
  let maxTemperature = -Infinity;
  let solidCells = 0;
  for (let j = 0; j < grid.ny; j += 1) {
    for (let k = 0; k < grid.nz; k += 1) {
      for (let i = 0; i < grid.nx; i += 1) {
        const index = indexOf(i, j, k, grid);
        if (solid[index]) {
          solidCells += 1;
          continue;
        }
        const speed = Math.hypot(u[index], v[index], w[index]);
        maxSpeed = Math.max(maxSpeed, speed);
        const divergence = (
          neighborValue(u, i, j, k, 1, 0, 0, 0, grid, solid)
          - neighborValue(u, i, j, k, -1, 0, 0, 0, grid, solid)
        ) / (2 * grid.dx) + (
          neighborValue(v, i, j, k, 0, 1, 0, 0, grid, solid)
          - neighborValue(v, i, j, k, 0, -1, 0, 0, grid, solid)
        ) / (2 * grid.dy) + (
          neighborValue(w, i, j, k, 0, 0, 1, 0, grid, solid)
          - neighborValue(w, i, j, k, 0, 0, -1, 0, grid, solid)
        ) / (2 * grid.dz);
        divergenceSquared += divergence ** 2;
        totalTemperature += temperature[index];
        maxTemperature = Math.max(maxTemperature, temperature[index]);
        fluidCells += 1;
      }
    }
  }
  return {
    maxSpeed: Number(maxSpeed.toFixed(4)),
    rmsDivergence: fluidCells ? Number(Math.sqrt(divergenceSquared / fluidCells).toFixed(4)) : 0,
    meanTemperature: fluidCells ? Number((totalTemperature / fluidCells).toFixed(2)) : ambientTemperature,
    maxTemperature: fluidCells ? Number(maxTemperature.toFixed(2)) : ambientTemperature,
    solidCells,
    fluidCells,
  };
}

function createSimulationState(scene, options) {
  validateScene(scene);
  const settings = validateOptions(options, scene.room);
  const grid = buildGrid(scene.room, settings.cellSize);
  const solid = buildSolidMask(scene, grid);
  const { outlets, flow: windowFlow } = buildWindowBoundary(scene, grid, settings);
  const count = grid.nx * grid.ny * grid.nz;
  return {
    scene,
    settings,
    grid,
    solid,
    outlets,
    windowFlow,
    fanAcceleration: buildFanAccelerationField(scene, grid, solid, settings),
    heaters: scene.objects.filter((object) => object.model === 'heater'),
    u: new Float32Array(count),
    v: new Float32Array(count),
    w: new Float32Array(count),
    temperature: new Float32Array(count).fill(settings.ambientTemperature),
  };
}

function advanceSimulation(state) {
  const { settings, grid, solid, outlets, windowFlow, fanAcceleration, heaters } = state;
  let { u, v, w, temperature } = state;
  const previousU = u;
  const previousV = v;
  const previousW = w;
  u = advect(previousU, previousU, previousV, previousW, grid, solid, settings.timeStep, 0);
  v = advect(previousV, previousU, previousV, previousW, grid, solid, settings.timeStep, 0);
  w = advect(previousW, previousU, previousV, previousW, grid, solid, settings.timeStep, 0);
  applyFanForces(u, v, w, fanAcceleration, settings.timeStep);
  applyBuoyancy(v, temperature, solid, settings.timeStep, settings.ambientTemperature);

  const damp = Math.exp(-0.08 * settings.timeStep);
  for (let index = 0; index < u.length; index += 1) {
    if (solid[index]) continue;
    u[index] = clamp(u[index] * damp, -LIMITS.maxSpeed, LIMITS.maxSpeed);
    v[index] = clamp(v[index] * damp, -LIMITS.maxSpeed, LIMITS.maxSpeed);
    w[index] = clamp(w[index] * damp, -LIMITS.maxSpeed, LIMITS.maxSpeed);
  }
  u = diffuse(u, settings.kinematicViscosity, settings.timeStep, grid, solid, -LIMITS.maxSpeed, LIMITS.maxSpeed);
  v = diffuse(v, settings.kinematicViscosity, settings.timeStep, grid, solid, -LIMITS.maxSpeed, LIMITS.maxSpeed);
  w = diffuse(w, settings.kinematicViscosity, settings.timeStep, grid, solid, -LIMITS.maxSpeed, LIMITS.maxSpeed);
  projectVelocity(u, v, w, grid, solid, outlets, windowFlow, settings.pressureIterations);
  for (let index = 0; index < u.length; index += 1) {
    const speed = Math.hypot(u[index], v[index], w[index]);
    if (speed > LIMITS.maxSpeed) {
      const scale = LIMITS.maxSpeed / speed;
      u[index] *= scale;
      v[index] *= scale;
      w[index] *= scale;
    }
  }

  temperature = advect(temperature, previousU, previousV, previousW, grid, solid, settings.timeStep, settings.outdoorTemperature, true);
  temperature = diffuse(temperature, settings.effectiveThermalDiffusivity, settings.timeStep, grid, solid, 0, LIMITS.maxTemperature);
  for (let index = 0; index < temperature.length; index += 1) {
    if (solid[index]) {
      temperature[index] = settings.ambientTemperature;
      continue;
    }
    temperature[index] = clamp(
      temperature[index] + (settings.ambientTemperature - temperature[index]) * settings.coolingRate * settings.timeStep,
      0,
      LIMITS.maxTemperature,
    );
    if (outlets[index]) {
      const isInlet = outlets[index] & 1 ? windowFlow[index] > 0
        : outlets[index] & 2 ? windowFlow[index] < 0
          : outlets[index] & 16 ? windowFlow[index] > 0 : windowFlow[index] < 0;
      if (isInlet) temperature[index] = settings.outdoorTemperature;
    }
  }
  addHeatSources(temperature, heaters, grid, solid, settings, settings.timeStep);
  for (let index = 0; index < temperature.length; index += 1) {
    temperature[index] = clamp(temperature[index], 0, LIMITS.maxTemperature);
  }
  Object.assign(state, { u, v, w, temperature });
}

function finishSimulation(state) {
  const { settings, grid, solid, outlets, windowFlow, u, v, w, temperature } = state;
  const stats = calculateStats(u, v, w, temperature, solid, grid, settings.ambientTemperature);
  return {
    grid: { ...grid, cellSize: settings.cellSize },
    fields: { u, v, w, temperature, solid, outlets, windowFlow },
    backend: 'cpu-preview',
    ambientTemperature: settings.ambientTemperature,
    outdoorTemperature: settings.outdoorTemperature,
    durationSeconds: settings.steps * settings.timeStep,
    assumptions: FIELD_ASSUMPTIONS,
    stats,
  };
}

export function simulateRoomFields(scene, options = {}) {
  const state = createSimulationState(scene, options);
  for (let step = 0; step < state.settings.steps; step += 1) advanceSimulation(state);
  return finishSimulation(state);
}

export async function simulateRoomFieldsAsync(scene, options = {}, { isCancelled = () => false, yieldEvery = 2 } = {}) {
  const state = createSimulationState(scene, options);
  for (let step = 0; step < state.settings.steps; step += 1) {
    if (isCancelled()) return null;
    advanceSimulation(state);
    if ((step + 1) % yieldEvery === 0) await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return isCancelled() ? null : finishSimulation(state);
}
