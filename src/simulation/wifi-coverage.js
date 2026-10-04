import { rotationMatrixXYZ } from '../model/room-scene.js';
import { isOpeningObject } from '../model/openings.js';
import { buildSolidMask, validateScene } from './room-fields-3d.js';

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const indexOf = (i, j, k, grid) => (j * grid.nz + k) * grid.nx + i;
const BLOCKER_ATTENUATION_DB = Object.freeze({
  bed: 7,
  chair: 3,
  'ceiling-fan': 1,
  desk: 5,
  heater: 3,
  'air-conditioner': 2,
  lamp: 2,
  sofa: 8,
  table: 4,
});

function createGrid(room) {
  const nx = Math.min(80, Math.ceil(room.width / 0.25));
  const ny = Math.min(24, Math.ceil(room.height / 0.25));
  const nz = Math.min(80, Math.ceil(room.depth / 0.25));
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
    cellSize: Math.max(room.width / nx, room.height / ny, room.depth / nz),
  };
}

function makeBox(object) {
  return {
    center: [object.position.x, object.position.y + object.dimensions.height / 2, object.position.z],
    half: [object.dimensions.width / 2, object.dimensions.height / 2, object.dimensions.depth / 2],
    matrix: rotationMatrixXYZ(object.rotation),
    attenuation: BLOCKER_ATTENUATION_DB[object.model] ?? 5,
  };
}

function toLocal(point, box) {
  const delta = point.map((value, axis) => value - box.center[axis]);
  return [0, 1, 2].map((column) => (
    box.matrix[0][column] * delta[0]
    + box.matrix[1][column] * delta[1]
    + box.matrix[2][column] * delta[2]
  ));
}

function rayIntersectsBox(start, end, box) {
  const localStart = toLocal(start, box);
  const localEnd = toLocal(end, box);
  let near = 0;
  let far = 1;
  for (let axis = 0; axis < 3; axis += 1) {
    const direction = localEnd[axis] - localStart[axis];
    if (Math.abs(direction) < 1e-8) {
      if (Math.abs(localStart[axis]) > box.half[axis]) return false;
      continue;
    }
    const first = (-box.half[axis] - localStart[axis]) / direction;
    const second = (box.half[axis] - localStart[axis]) / direction;
    near = Math.max(near, Math.min(first, second));
    far = Math.min(far, Math.max(first, second));
    if (near > far) return false;
  }
  return far > 1e-5 && near < 1 - 1e-5;
}

function estimateSignalDbm(router, point, blockers) {
  const source = [router.position.x, router.position.y + router.dimensions.height / 2, router.position.z];
  const distance = Math.max(0.6, Math.hypot(point[0] - source[0], point[1] - source[1], point[2] - source[2]));
  const power = 20 + 10 * Math.log10(router.intensity ?? 1);
  let attenuation = 0;
  for (const blocker of blockers) {
    if (rayIntersectsBox(source, point, blocker)) attenuation += blocker.attenuation;
  }
  return clamp(power - 50 - 42 * Math.log10(distance) - attenuation, -100, 20);
}

export async function estimateWifiCoverage(scene, { isCancelled = () => false } = {}) {
  validateScene(scene);
  const grid = createGrid(scene.room);
  const routers = scene.objects.filter((object) => object.model === 'router' && object.enabled !== false && (object.intensity ?? 1) > 0);
  const blockers = scene.objects
    .filter((object) => object.model !== 'router' && !['fan', 'ceiling-fan'].includes(object.model) && !isOpeningObject(object))
    .map(makeBox);
  const objectsWithoutRouters = { ...scene, objects: scene.objects.filter((object) => object.model !== 'router') };
  const solid = buildSolidMask(objectsWithoutRouters, grid);
  const wifi = new Float32Array(grid.nx * grid.ny * grid.nz);
  let minimum = Infinity;
  let maximum = -Infinity;
  let sum = 0;
  let sampleCount = 0;

  for (let j = 0; j < grid.ny; j += 1) {
    if (isCancelled()) return null;
    for (let k = 0; k < grid.nz; k += 1) {
      for (let i = 0; i < grid.nx; i += 1) {
        const index = indexOf(i, j, k, grid);
        if (solid[index]) {
          wifi[index] = -100;
          continue;
        }
        const point = [(i + 0.5) * grid.dx, (j + 0.5) * grid.dy, (k + 0.5) * grid.dz];
        let signal = -100;
        for (const router of routers) signal = Math.max(signal, estimateSignalDbm(router, point, blockers));
        wifi[index] = signal;
        minimum = Math.min(minimum, signal);
        maximum = Math.max(maximum, signal);
        sum += signal;
        sampleCount += 1;
      }
    }
    if (j % 3 === 2) await new Promise((resolve) => setTimeout(resolve, 0));
  }

  return {
    grid,
    fields: { wifi, solid },
    backend: 'analytic-wifi-preview',
    stats: {
      minWifiDbm: sampleCount ? minimum : -100,
      maxWifiDbm: sampleCount ? maximum : -100,
      meanWifiDbm: sampleCount ? sum / sampleCount : -100,
      routerCount: routers.length,
    },
    assumptions: {
      model: 'indicative 2.4 GHz indoor path-loss estimate; not a measured RF prediction',
      pathLoss: '50 dB at 1 m plus 42 dB per distance decade',
      furnitureAttenuation: 'coarse per-object attenuation; wall materials, multipath, antenna patterns, and interference are not modeled',
      transmitPowerDbm: '20 dBm at relative router strength 1',
    },
  };
}
