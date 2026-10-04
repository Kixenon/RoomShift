import { rotatedHalfExtents, rotationMatrixXYZ, DEVICE_MODELS } from '../model/room-scene.js';
import { findObjectCollision } from '../model/room-collision.js';
import { roomObstacles } from '../model/object-parts.js';
import { isOpeningObject } from '../model/openings.js';

const LIMITS = Object.freeze({
  roomMin: 2,
  roomMax: 20,
  heightMin: 2,
  heightMax: 6,
  minCellSize: 0.075,
  maxCellSize: 0.75,
  minSteps: 1,
  maxSteps: 240,
  minPressureIterations: 4,
  maxPressureIterations: 20,
  maxGridX: 80,
  maxGridY: 48,
  maxGridZ: 80,
  maxSpeed: 2.5,
  maxTemperature: 60,
});

export const FIELD_PHYSICS_DEFAULTS = Object.freeze({
  ambientTemperature: 20,
  outdoorTemperature: 10,
  kinematicViscosity: 0.001,
  effectiveThermalDiffusivity: 0.018,
  coolingRate: 0,
  envelopeUValue: 0.7,
  fanOutletSpeed: 1.2,
  vorticityConfinement: 2,
  heaterRadius: 0.45,
});
const DEFAULTS = Object.freeze({
  ...FIELD_PHYSICS_DEFAULTS,
  cellSize: 0.15,
  steps: 240,
  timeStep: 0.05,
  pressureIterations: 20,
});
const FAN_SOURCE_DEPTH = 0.2;

export const FIELD_ASSUMPTIONS = Object.freeze({
  model: '3D planning preview with finite-volume face-flux pressure projection; not validated CFD',
  defaultCellSizeMeters: DEFAULTS.cellSize,
  defaultDurationSeconds: DEFAULTS.steps * DEFAULTS.timeStep,
  maximumGridDimensions: Object.freeze([LIMITS.maxGridX, LIMITS.maxGridY, LIMITS.maxGridZ]),
  maximumGridCells: LIMITS.maxGridX * LIMITS.maxGridY * LIMITS.maxGridZ,
  maximumSteps: LIMITS.maxSteps,
  maximumPressureIterations: LIMITS.maxPressureIterations,
  pressureSolver: 'warm-started fixed-count red/black successive over-relaxation; no residual-convergence stop',
  turbulence: 'coarse-grid vorticity confinement to restore resolved fan and obstacle eddies; not a calibrated turbulence closure',
  maximumSpeedMetersPerSecond: LIMITS.maxSpeed,
  thermalSourceUnits: 'heater watts distributed over fluid cells; air density 1.204 kg/m³ and heat capacity 1006 J/(kg K)',
  heatLoss: 'instantaneous envelope conduction to outside; uniform U-value, no wall heat storage or radiation',
  thermalDiffusivity: 'effective mixing coefficient; not molecular air diffusivity',
  boundaries: 'no-penetration voxel walls and pressure-driven open windows with exterior pressure head from wind settings; no-slip walls are not modeled',
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

  for (const [name, min, max] of [['initialTemperature', -20, 40], ['envelopeUValue', 0, 5], ['headingDegrees', 0, 360]]) {
    if (scene.room[name] !== undefined && (!Number.isFinite(scene.room[name]) || scene.room[name] < min || scene.room[name] > max)) throw new RangeError(`Invalid room ${name}.`);
  }
  for (const object of scene.objects) {
    if (![object?.position?.x, object?.position?.y, object?.position?.z,
      object?.dimensions?.width, object?.dimensions?.height, object?.dimensions?.depth,
      object?.rotation?.x, object?.rotation?.y, object?.rotation?.z].every(Number.isFinite)
      || object.dimensions.width <= 0 || object.dimensions.height <= 0 || object.dimensions.depth <= 0) {
      throw new TypeError(`Object ${object?.id ?? '(unknown)'} has invalid geometry.`);
    }
    if (DEVICE_MODELS.includes(object.model)
      && object.intensity !== undefined
      && (!Number.isFinite(object.intensity) || object.intensity < 0 || object.intensity > 2)) {
      throw new RangeError(`Object ${object.id ?? '(unknown)'} source strength must be between 0 and 2.`);
    }
    if (['heater', 'air-conditioner'].includes(object.model) && object.powerWatts !== undefined
      && (!Number.isFinite(object.powerWatts) || object.powerWatts < 0 || object.powerWatts > 3000)) {
      throw new RangeError('Heater power must be between 0 and 3000 watts.');
    }
    if (DEVICE_MODELS.includes(object.model) && object.enabled !== undefined && typeof object.enabled !== 'boolean') {
      throw new TypeError(`Device ${object.id ?? '(unknown)'} enabled state must be boolean.`);
    }
    if (isOpeningObject(object)
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

export function validateOptions(options, room) {
  const values = {
    ...DEFAULTS,
    ...options,
    timeStep: options.timeStep ?? ((options.cellSize ?? DEFAULTS.cellSize) < 0.15 ? 0.02 : DEFAULTS.timeStep),
    ambientTemperature: options.ambientTemperature ?? room.initialTemperature ?? DEFAULTS.ambientTemperature,
    envelopeUValue: options.envelopeUValue ?? room.envelopeUValue ?? DEFAULTS.envelopeUValue,
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
  if (!Number.isFinite(values.ambientTemperature) || values.ambientTemperature < -20 || values.ambientTemperature > 40) {
    throw new RangeError('Ambient temperature must be between -20 °C and 40 °C.');
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
    ['fanOutletSpeed', 0, 3],
    ['vorticityConfinement', 0, 4],
    ['envelopeUValue', 0, 5],
    ['heaterRadius', 0.05, roomReach],
  ];
  for (const [name, min, max] of boundedParameters) {
    if (!Number.isFinite(values[name]) || values[name] < min || values[name] > max) {
      throw new RangeError(`${name} must be a finite value between ${min} and ${max}.`);
    }
  }
  const grid = buildGrid(room, values.cellSize);
  if (values.timeStep * Math.max(values.kinematicViscosity, values.effectiveThermalDiffusivity)
    * (1 / grid.dx ** 2 + 1 / grid.dy ** 2 + 1 / grid.dz ** 2) > 0.5) {
    throw new RangeError('Time step is too large for explicit diffusion on this grid.');
  }
  return values;
}

export function buildGrid(room, cellSize) {
  const nx = clamp(Math.ceil(room.width / cellSize), 4, LIMITS.maxGridX);
  const ny = clamp(Math.ceil(room.height / cellSize), 4, LIMITS.maxGridY);
  const nz = clamp(Math.ceil(room.depth / cellSize), 4, LIMITS.maxGridZ);
  const dx = room.width / nx;
  const dy = room.height / ny;
  const dz = room.depth / nz;
  return {
    width: room.width,
    height: room.height,
    depth: room.depth,
    nx,
    ny,
    nz,
    dx,
    dy,
    dz,
    cellSize: Math.max(dx, dy, dz),
    requestedCellSize: cellSize,
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
  for (const object of roomObstacles(scene)) {
    const [halfWidth, halfHeight, halfDepth] = rotatedHalfExtents(object.dimensions, object.rotation);
    const centerY = object.position.y + object.dimensions.height / 2;
    const minI = clamp(Math.floor((object.position.x - halfWidth) / grid.dx), 0, grid.nx - 1);
    const maxI = clamp(Math.floor((object.position.x + halfWidth) / grid.dx), 0, grid.nx - 1);
    const minJ = clamp(Math.floor((centerY - halfHeight) / grid.dy), 0, grid.ny - 1);
    const maxJ = clamp(Math.floor((centerY + halfHeight) / grid.dy), 0, grid.ny - 1);
    const minK = clamp(Math.floor((object.position.z - halfDepth) / grid.dz), 0, grid.nz - 1);
    const maxK = clamp(Math.floor((object.position.z + halfDepth) / grid.dz), 0, grid.nz - 1);
    const matrix = rotationMatrixXYZ(object.rotation);
    const cellHalf = [grid.dx / 2, grid.dy / 2, grid.dz / 2];
    const padding = [0, 1, 2].map((axis) => matrix.reduce((sum, row, worldAxis) => sum + Math.abs(row[axis]) * cellHalf[worldAxis], 0));

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
          if (Math.abs(local.x) < object.dimensions.width / 2 + padding[0] - 1e-8
            && Math.abs(local.y) < object.dimensions.height / 2 + padding[1] - 1e-8
            && Math.abs(local.z) < object.dimensions.depth / 2 + padding[2] - 1e-8) {
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
  const pressure = new Float32Array(count);
  for (const window of scene.objects) {
    if (!isOpeningObject(window) || !window.open) continue;
    const alongX = window.wall === 'back' || window.wall === 'front';
    const sideBit = window.wall === 'left' ? 1
      : window.wall === 'right' ? 2
        : window.wall === 'front' ? 16 : 32;
    const firstJ = clamp(Math.floor(window.position.y / grid.dy), 0, grid.ny - 1);
    const lastJ = clamp(Math.floor((window.position.y + window.dimensions.height) / grid.dy), 0, grid.ny - 1);
    const direction = window.flowDirection ?? 'exchange';
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

    const pressureHead = 0.5 * speed ** 2;
    for (const { index } of cells) outlets[index] |= sideBit;
    if (direction === 'exchange') {
      const ambient = settings.ambientTemperature ?? DEFAULTS.ambientTemperature;
      const outside = settings.outdoorTemperature ?? scene.room.outdoorTemperature ?? DEFAULTS.outdoorTemperature;
      const neutralHeight = window.position.y + window.dimensions.height / 2;
      for (const { index, j } of cells) {
        pressure[index] = 9.81 * (ambient - outside) / (ambient + 273.15) * (neutralHeight - (j + 0.5) * grid.dy);
      }
    } else if (direction === 'inlet') {
      for (const { index } of cells) pressure[index] = pressureHead;
    } else if (direction === 'outlet') {
      for (const { index } of cells) pressure[index] = -pressureHead;
    }
  }
  return { outlets, pressure };
}

function clipBacktrace(x, y, z, backX, backY, backZ, grid, solid, target) {
  const distance = Math.hypot(backX - x, backY - y, backZ - z);
  if (distance < 1e-12) {
    target.x = x;
    target.y = y;
    target.z = z;
    return target;
  }
  const stepLength = Math.min(grid.dx, grid.dy, grid.dz) * 0.5;
  const steps = Math.max(1, Math.ceil(distance / stepLength));
  let lastX = x;
  let lastY = y;
  let lastZ = z;
  for (let step = 1; step <= steps; step += 1) {
    const fraction = step / steps;
    const pointX = x + (backX - x) * fraction;
    const pointY = y + (backY - y) * fraction;
    const pointZ = z + (backZ - z) * fraction;
    if (pointX < 0 || pointX > grid.width || pointY < 0 || pointY > grid.height
      || pointZ < 0 || pointZ > grid.depth) continue;
    const i = Math.min(grid.nx - 1, Math.floor(pointX / grid.dx));
    const j = Math.min(grid.ny - 1, Math.floor(pointY / grid.dy));
    const k = Math.min(grid.nz - 1, Math.floor(pointZ / grid.dz));
    if (solid[indexOf(i, j, k, grid)]) {
      target.x = lastX;
      target.y = lastY;
      target.z = lastZ;
      return target;
    }
    lastX = pointX;
    lastY = pointY;
    lastZ = pointZ;
  }
  target.x = backX;
  target.y = backY;
  target.z = backZ;
  return target;
}

function advectState(state) {
  const { u, v, w, temperature, nextU, nextV, nextW, nextTemperature, grid, solid, settings } = state;
  const back = { x: 0, y: 0, z: 0 };
  for (let j = 0; j < grid.ny; j += 1) for (let k = 0; k < grid.nz; k += 1) for (let i = 0; i < grid.nx; i += 1) {
    const id = indexOf(i, j, k, grid);
    nextU[id] = 0; nextV[id] = 0; nextW[id] = 0;
    nextTemperature[id] = settings.ambientTemperature;
    if (solid[id]) continue;
    const x = (i + 0.5) * grid.dx;
    const y = (j + 0.5) * grid.dy;
    const z = (k + 0.5) * grid.dz;
    clipBacktrace(x, y, z, x - u[id] * settings.timeStep, y - v[id] * settings.timeStep, z - w[id] * settings.timeStep, grid, solid, back);
    if (back.x < 0 || back.x > grid.width || back.y < 0 || back.y > grid.height || back.z < 0 || back.z > grid.depth) continue;
    const gx = clamp(back.x / grid.dx - 0.5, 0, grid.nx - 1);
    const gy = clamp(back.y / grid.dy - 0.5, 0, grid.ny - 1);
    const gz = clamp(back.z / grid.dz - 0.5, 0, grid.nz - 1);
    const x0 = Math.floor(gx), y0 = Math.floor(gy), z0 = Math.floor(gz);
    const tx = gx - x0, ty = gy - y0, tz = gz - z0;
    let sumU = 0, sumV = 0, sumW = 0, sumT = 0, total = 0;
    for (let oy = 0; oy < 2; oy += 1) for (let oz = 0; oz < 2; oz += 1) for (let ox = 0; ox < 2; ox += 1) {
      const source = indexOf(Math.min(x0 + ox, grid.nx - 1), Math.min(y0 + oy, grid.ny - 1), Math.min(z0 + oz, grid.nz - 1), grid);
      if (solid[source]) continue;
      const weight = (ox ? tx : 1 - tx) * (oy ? ty : 1 - ty) * (oz ? tz : 1 - tz);
      sumU += u[source] * weight; sumV += v[source] * weight; sumW += w[source] * weight;
      sumT += temperature[source] * weight; total += weight;
    }
    if (total > 1e-8) {
      nextU[id] = sumU / total; nextV[id] = sumV / total; nextW[id] = sumW / total;
      nextTemperature[id] = sumT / total;
    }
  }
}

function neighborValue(field, i, j, k, di, dj, dk, center, grid, solid) {
  const ni = i + di;
  const nj = j + dj;
  const nk = k + dk;
  if (ni < 0 || ni >= grid.nx || nj < 0 || nj >= grid.ny || nk < 0 || nk >= grid.nz) return center;
  const index = indexOf(ni, nj, nk, grid);
  return solid[index] ? center : field[index];
}

function buildFaceVelocities(u, v, w, grid, solid, outlets, windowFlow, target, useWindowFlow = true) {
  const count = u.length;
  const x = target?.x ?? new Float32Array(count);
  const y = target?.y ?? new Float32Array(count);
  const z = target?.z ?? new Float32Array(count);
  const xLow = target?.xLow ?? new Float32Array(count);
  const zLow = target?.zLow ?? new Float32Array(count);
  x.fill(0);
  y.fill(0);
  z.fill(0);
  xLow.fill(0);
  zLow.fill(0);
  for (let j = 0; j < grid.ny; j += 1) {
    for (let k = 0; k < grid.nz; k += 1) {
      for (let i = 0; i < grid.nx; i += 1) {
        const index = indexOf(i, j, k, grid);
        if (solid[index]) continue;
        if (i === 0 && (outlets[index] & 1)) xLow[index] = useWindowFlow ? windowFlow[index] : u[index];
        if (k === 0 && (outlets[index] & 16)) zLow[index] = useWindowFlow ? windowFlow[index] : w[index];
        if (i + 1 < grid.nx) {
          const right = indexOf(i + 1, j, k, grid);
          if (!solid[right]) x[index] = (u[index] + u[right]) * 0.5;
        } else {
          if (outlets[index] & 2) x[index] = useWindowFlow ? windowFlow[index] : u[index];
        }
        if (j + 1 < grid.ny) {
          const above = indexOf(i, j + 1, k, grid);
          if (!solid[above]) y[index] = (v[index] + v[above]) * 0.5;
        }
        if (k + 1 < grid.nz) {
          const far = indexOf(i, j, k + 1, grid);
          if (!solid[far]) z[index] = (w[index] + w[far]) * 0.5;
        } else {
          if (outlets[index] & 32) z[index] = useWindowFlow ? windowFlow[index] : w[index];
        }
      }
    }
  }
  return { x, y, z, xLow, zLow };
}

function faceDivergence(faces, i, j, k, grid) {
  const index = indexOf(i, j, k, grid);
  const west = i > 0 ? faces.x[indexOf(i - 1, j, k, grid)] : faces.xLow[index];
  const below = j > 0 ? faces.y[indexOf(i, j - 1, k, grid)] : 0;
  const near = k > 0 ? faces.z[indexOf(i, j, k - 1, grid)] : faces.zLow[index];
  return (faces.x[index] - west) / grid.dx
    + (faces.y[index] - below) / grid.dy
    + (faces.z[index] - near) / grid.dz;
}

function buildPressureStencil(grid, solid, outlets, windowPressure) {
  const count = solid.length;
  const neighbors = new Int32Array(count * 6).fill(-1);
  const diagonal = new Float32Array(count);
  const boundarySource = new Float32Array(count);
  const xWeight = 1 / grid.dx ** 2;
  const yWeight = 1 / grid.dy ** 2;
  const zWeight = 1 / grid.dz ** 2;
  const weights = [xWeight, xWeight, yWeight, yWeight, zWeight, zWeight];
  const offsets = [[-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1]];
  for (let j = 0; j < grid.ny; j += 1) {
    for (let k = 0; k < grid.nz; k += 1) {
      for (let i = 0; i < grid.nx; i += 1) {
        const index = indexOf(i, j, k, grid);
        if (solid[index]) continue;
        for (let direction = 0; direction < offsets.length; direction += 1) {
          const [di, dj, dk] = offsets[direction];
          const ni = i + di;
          const nj = j + dj;
          const nk = k + dk;
          if (ni < 0 || ni >= grid.nx || nj < 0 || nj >= grid.ny || nk < 0 || nk >= grid.nz) continue;
          const neighbor = indexOf(ni, nj, nk, grid);
          if (solid[neighbor]) continue;
          neighbors[index * 6 + direction] = neighbor;
          diagonal[index] += weights[direction];
        }
        if (i === 0 && (outlets[index] & 1)) {
          diagonal[index] += 2 * xWeight;
          boundarySource[index] += 2 * xWeight * windowPressure[index];
        }
        if (i + 1 === grid.nx && (outlets[index] & 2)) {
          diagonal[index] += 2 * xWeight;
          boundarySource[index] += 2 * xWeight * windowPressure[index];
        }
        if (k === 0 && (outlets[index] & 16)) {
          diagonal[index] += 2 * zWeight;
          boundarySource[index] += 2 * zWeight * windowPressure[index];
        }
        if (k + 1 === grid.nz && (outlets[index] & 32)) {
          diagonal[index] += 2 * zWeight;
          boundarySource[index] += 2 * zWeight * windowPressure[index];
        }
      }
    }
  }
  return { neighbors, diagonal, weights, boundarySource };
}

function buildPressureWorkspace(count) {
  return {
    pressure: new Float32Array(count),
    divergence: new Float32Array(count),
    projectedDivergence: new Float32Array(count),
    faces: {
      x: new Float32Array(count),
      y: new Float32Array(count),
      z: new Float32Array(count),
      xLow: new Float32Array(count),
      zLow: new Float32Array(count),
    },
  };
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
  const fans = scene.objects.filter((object) => ['fan', 'ceiling-fan'].includes(object.model) && object.enabled !== false);
  const blockers = roomObstacles(scene).map((object) => ({
    center: { x: object.position.x, y: object.position.y + object.dimensions.height / 2, z: object.position.z },
    halfWidth: object.dimensions.width / 2,
    halfHeight: object.dimensions.height / 2,
    halfDepth: object.dimensions.depth / 2,
    rotation: rotationMatrixXYZ(object.rotation),
  }));
  for (const fan of fans) {
    const isCeilingFan = fan.model === 'ceiling-fan';
    const matrix = rotationMatrixXYZ(fan.rotation);
    const direction = isCeilingFan ? [0, -1, 0] : [matrix[0][2], matrix[1][2], matrix[2][2]];
    const localSource = {
      x: 0,
      y: fan.dimensions.height * 0.24,
      z: fan.dimensions.depth / 2,
    };
    const pedestalSource = {
      x: fan.position.x + matrix[0][0] * localSource.x + matrix[0][1] * localSource.y + matrix[0][2] * localSource.z,
      y: fan.position.y + fan.dimensions.height / 2 + matrix[1][0] * localSource.x + matrix[1][1] * localSource.y + matrix[1][2] * localSource.z,
      z: fan.position.z + matrix[2][0] * localSource.x + matrix[2][1] * localSource.y + matrix[2][2] * localSource.z,
    };
    const source = isCeilingFan ? { x: fan.position.x, y: fan.position.y + fan.dimensions.height * 0.38, z: fan.position.z } : pedestalSource;
    const sourceReach = FAN_SOURCE_DEPTH;
    const radius = isCeilingFan ? Math.max(0.12, Math.min(fan.dimensions.width * 0.43, fan.dimensions.depth * 0.43)) : Math.max(0.08, Math.min(fan.dimensions.width * 0.4, fan.dimensions.height * 0.22));
    const speed = settings.fanOutletSpeed * (fan.intensity ?? 1);
    // Average the same physical source over each voxel to reduce grid-alignment artifacts.
    const sourceAcceleration = speed ** 2 / Math.max(4 * sourceReach, 1e-6);
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
          const local = inverseRotate(dx, dy, dz, matrix);
          const padding = Math.hypot(grid.dx, grid.dy, grid.dz) / 2;
          if (Math.abs(local.z) > 3 * sourceReach + padding || Math.hypot(local.x, local.y) > 3 * radius + padding) continue;
          let disk = 0;
          for (const ox of [-1, 1]) for (const oy of [-1, 1]) for (const oz of [-1, 1]) {
            const sampleX = x + ox * grid.dx / Math.sqrt(12);
            const sampleY = y + oy * grid.dy / Math.sqrt(12);
            const sampleZ = z + oz * grid.dz / Math.sqrt(12);
            if (!rayIsClear(source, sampleX, sampleY, sampleZ, blockers)) continue;
            const sample = inverseRotate(sampleX - source.x, sampleY - source.y, sampleZ - source.z, matrix);
            disk += Math.exp(-(sample.x ** 2 + sample.y ** 2) / (2 * radius ** 2) - 0.5 * (sample.z / sourceReach) ** 2) / 8;
          }
          const magnitude = sourceAcceleration * disk;
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

function calculateVorticity(u, v, w, grid, solid, workspace) {
  const { x, y, z, magnitude } = workspace;
  for (let j = 0; j < grid.ny; j += 1) {
    for (let k = 0; k < grid.nz; k += 1) {
      for (let i = 0; i < grid.nx; i += 1) {
        const index = indexOf(i, j, k, grid);
        if (solid[index]) {
          x[index] = 0;
          y[index] = 0;
          z[index] = 0;
          magnitude[index] = 0;
          continue;
        }
        const duDy = (neighborValue(u, i, j, k, 0, 1, 0, u[index], grid, solid)
          - neighborValue(u, i, j, k, 0, -1, 0, u[index], grid, solid)) / (2 * grid.dy);
        const duDz = (neighborValue(u, i, j, k, 0, 0, 1, u[index], grid, solid)
          - neighborValue(u, i, j, k, 0, 0, -1, u[index], grid, solid)) / (2 * grid.dz);
        const dvDx = (neighborValue(v, i, j, k, 1, 0, 0, v[index], grid, solid)
          - neighborValue(v, i, j, k, -1, 0, 0, v[index], grid, solid)) / (2 * grid.dx);
        const dvDz = (neighborValue(v, i, j, k, 0, 0, 1, v[index], grid, solid)
          - neighborValue(v, i, j, k, 0, 0, -1, v[index], grid, solid)) / (2 * grid.dz);
        const dwDx = (neighborValue(w, i, j, k, 1, 0, 0, w[index], grid, solid)
          - neighborValue(w, i, j, k, -1, 0, 0, w[index], grid, solid)) / (2 * grid.dx);
        const dwDy = (neighborValue(w, i, j, k, 0, 1, 0, w[index], grid, solid)
          - neighborValue(w, i, j, k, 0, -1, 0, w[index], grid, solid)) / (2 * grid.dy);
        x[index] = dwDy - dvDz;
        y[index] = duDz - dwDx;
        z[index] = dvDx - duDy;
        magnitude[index] = Math.hypot(x[index], y[index], z[index]);
      }
    }
  }
}

function applyVorticityConfinement(u, v, w, grid, solid, workspace, timeStep, strength) {
  if (strength === 0) return;
  const { x: curlX, y: curlY, z: curlZ, magnitude } = workspace;
  const confinementScale = strength * Math.min(grid.dx, grid.dy, grid.dz);
  for (let j = 0; j < grid.ny; j += 1) {
    for (let k = 0; k < grid.nz; k += 1) {
      for (let i = 0; i < grid.nx; i += 1) {
        const index = indexOf(i, j, k, grid);
        if (solid[index]) continue;
        const centerMagnitude = magnitude[index];
        const gradientX = (neighborValue(magnitude, i, j, k, 1, 0, 0, centerMagnitude, grid, solid)
          - neighborValue(magnitude, i, j, k, -1, 0, 0, centerMagnitude, grid, solid)) / (2 * grid.dx);
        const gradientY = (neighborValue(magnitude, i, j, k, 0, 1, 0, centerMagnitude, grid, solid)
          - neighborValue(magnitude, i, j, k, 0, -1, 0, centerMagnitude, grid, solid)) / (2 * grid.dy);
        const gradientZ = (neighborValue(magnitude, i, j, k, 0, 0, 1, centerMagnitude, grid, solid)
          - neighborValue(magnitude, i, j, k, 0, 0, -1, centerMagnitude, grid, solid)) / (2 * grid.dz);
        const gradientLength = Math.hypot(gradientX, gradientY, gradientZ);
        if (gradientLength < 1e-8) continue;
        const normalX = gradientX / gradientLength;
        const normalY = gradientY / gradientLength;
        const normalZ = gradientZ / gradientLength;
        const scale = confinementScale * timeStep;
        u[index] += (normalY * curlZ[index] - normalZ * curlY[index]) * scale;
        v[index] += (normalZ * curlX[index] - normalX * curlZ[index]) * scale;
        w[index] += (normalX * curlY[index] - normalY * curlX[index]) * scale;
      }
    }
  }
}

function buildVorticityWorkspace(count) {
  return {
    x: new Float32Array(count),
    y: new Float32Array(count),
    z: new Float32Array(count),
    magnitude: new Float32Array(count),
  };
}

function projectVelocity(u, v, w, grid, solid, outlets, windowPressure, windowFlow, pressureStencil, workspace, timeStep, iterations) {
  const { pressure } = workspace;
  const { divergence } = workspace;
  const { neighbors, diagonal, weights, boundarySource } = pressureStencil;
  const xWeight = weights[0];
  const yWeight = weights[2];
  const zWeight = weights[4];
  const faces = buildFaceVelocities(u, v, w, grid, solid, outlets, windowFlow, workspace.faces, false);

  for (let j = 0; j < grid.ny; j += 1) {
    for (let k = 0; k < grid.nz; k += 1) {
      for (let i = 0; i < grid.nx; i += 1) {
        const index = indexOf(i, j, k, grid);
        if (solid[index]) continue;
        divergence[index] = faceDivergence(faces, i, j, k, grid);
      }
    }
  }

  workspace.originalFaces ??= Object.fromEntries(Object.entries(faces).map(([name, field]) => [name, new Float32Array(field.length)]));
  for (const name of Object.keys(faces)) workspace.originalFaces[name].set(faces[name]);
  const originalFaces = workspace.originalFaces;
  const relaxation = 1.7;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    for (let color = 0; color < 2; color += 1) {
      for (let j = 0; j < grid.ny; j += 1) {
        for (let k = 0; k < grid.nz; k += 1) {
          const firstI = (color + j + k) & 1;
          for (let i = firstI; i < grid.nx; i += 2) {
            const index = indexOf(i, j, k, grid);
            if (solid[index] || diagonal[index] === 0) continue;
            const base = index * 6;
            let sum = 0;
            let neighbor = neighbors[base];
            if (neighbor >= 0) sum += pressure[neighbor] * xWeight;
            neighbor = neighbors[base + 1];
            if (neighbor >= 0) sum += pressure[neighbor] * xWeight;
            neighbor = neighbors[base + 2];
            if (neighbor >= 0) sum += pressure[neighbor] * yWeight;
            neighbor = neighbors[base + 3];
            if (neighbor >= 0) sum += pressure[neighbor] * yWeight;
            neighbor = neighbors[base + 4];
            if (neighbor >= 0) sum += pressure[neighbor] * zWeight;
            neighbor = neighbors[base + 5];
            if (neighbor >= 0) sum += pressure[neighbor] * zWeight;
            const target = (sum + boundarySource[index] - divergence[index] / timeStep) / diagonal[index];
            pressure[index] += relaxation * (target - pressure[index]);
          }
        }
      }
    }
  }

  for (let j = 0; j < grid.ny; j += 1) {
    for (let k = 0; k < grid.nz; k += 1) {
      for (let i = 0; i < grid.nx; i += 1) {
        const index = indexOf(i, j, k, grid);
        if (solid[index]) continue;
        if (i + 1 < grid.nx) {
          const right = indexOf(i + 1, j, k, grid);
          if (!solid[right]) faces.x[index] -= timeStep * (pressure[right] - pressure[index]) / grid.dx;
        } else if (outlets[index] & 2) {
          faces.x[index] -= 2 * timeStep * (windowPressure[index] - pressure[index]) / grid.dx;
        }
        if (i === 0 && (outlets[index] & 1)) {
          faces.xLow[index] -= 2 * timeStep * (pressure[index] - windowPressure[index]) / grid.dx;
        }
        if (j + 1 < grid.ny) {
          const above = indexOf(i, j + 1, k, grid);
          if (!solid[above]) faces.y[index] -= timeStep * (pressure[above] - pressure[index]) / grid.dy;
        }
        if (k + 1 < grid.nz) {
          const far = indexOf(i, j, k + 1, grid);
          if (!solid[far]) faces.z[index] -= timeStep * (pressure[far] - pressure[index]) / grid.dz;
        } else if (outlets[index] & 32) {
          faces.z[index] -= 2 * timeStep * (windowPressure[index] - pressure[index]) / grid.dz;
        }
        if (k === 0 && (outlets[index] & 16)) {
          faces.zLow[index] -= 2 * timeStep * (pressure[index] - windowPressure[index]) / grid.dz;
        }
      }
    }
  }

  for (let j = 0; j < grid.ny; j += 1) {
    for (let k = 0; k < grid.nz; k += 1) {
      for (let i = 0; i < grid.nx; i += 1) {
        const index = indexOf(i, j, k, grid);
        if (solid[index]) {
          u[index] = 0;
          v[index] = 0;
          w[index] = 0;
          windowFlow[index] = 0;
          workspace.projectedDivergence[index] = 0;
          continue;
        }
        workspace.projectedDivergence[index] = faceDivergence(faces, i, j, k, grid);
        const west = i > 0 ? faces.x[indexOf(i - 1, j, k, grid)] : faces.xLow[index];
        const below = j > 0 ? faces.y[indexOf(i, j - 1, k, grid)] : 0;
        const near = k > 0 ? faces.z[indexOf(i, j, k - 1, grid)] : faces.zLow[index];
        const originalWest = i > 0 ? originalFaces.x[indexOf(i - 1, j, k, grid)] : originalFaces.xLow[index];
        const originalBelow = j > 0 ? originalFaces.y[indexOf(i, j - 1, k, grid)] : 0;
        const originalNear = k > 0 ? originalFaces.z[indexOf(i, j, k - 1, grid)] : originalFaces.zLow[index];
        // Apply the pressure correction without averaging away the input velocity each step.
        u[index] += (faces.x[index] + west - originalFaces.x[index] - originalWest) * 0.5;
        v[index] += (faces.y[index] + below - originalFaces.y[index] - originalBelow) * 0.5;
        w[index] += (faces.z[index] + near - originalFaces.z[index] - originalNear) * 0.5;
        let boundaryVelocityTotal = 0;
        let boundaryFaceCount = 0;
        if (outlets[index] & 1) { boundaryVelocityTotal += faces.xLow[index]; boundaryFaceCount += 1; }
        if (outlets[index] & 2) { boundaryVelocityTotal += faces.x[index]; boundaryFaceCount += 1; }
        if (outlets[index] & 16) { boundaryVelocityTotal += faces.zLow[index]; boundaryFaceCount += 1; }
        if (outlets[index] & 32) { boundaryVelocityTotal += faces.z[index]; boundaryFaceCount += 1; }
        windowFlow[index] = boundaryFaceCount ? boundaryVelocityTotal / boundaryFaceCount : 0;
      }
    }
  }
}

export function buildEnvelopeLoss(grid, uValue) {
  const loss = new Float32Array(grid.nx * grid.ny * grid.nz);
  for (let j = 0; j < grid.ny; j += 1) for (let k = 0; k < grid.nz; k += 1) for (let i = 0; i < grid.nx; i += 1) {
    const areaPerVolume = ((i === 0 ? 1 : 0) + (i === grid.nx - 1 ? 1 : 0)) / grid.dx
      + ((j === 0 ? 1 : 0) + (j === grid.ny - 1 ? 1 : 0)) / grid.dy
      + ((k === 0 ? 1 : 0) + (k === grid.nz - 1 ? 1 : 0)) / grid.dz;
    loss[indexOf(i, j, k, grid)] = uValue * areaPerVolume / (1.204 * 1006);
  }
  return loss;
}

export function buildHeatRate(scene, grid, solid, settings = DEFAULTS) {
  const rate = new Float32Array(solid.length);
  const volume = grid.dx * grid.dy * grid.dz;
  const heatCapacity = 1.204 * 1006;
  for (const heater of scene.objects.filter((object) => ['heater', 'air-conditioner'].includes(object.model) && object.enabled !== false)) {
    const weights = new Float32Array(solid.length);
    let total = 0;
    for (let j = 0; j < grid.ny; j += 1) for (let k = 0; k < grid.nz; k += 1) for (let i = 0; i < grid.nx; i += 1) {
      const id = indexOf(i, j, k, grid);
      if (solid[id]) continue;
      const distanceSquared = ((i + 0.5) * grid.dx - heater.position.x) ** 2
        + ((j + 0.5) * grid.dy - heater.position.y - heater.dimensions.height / 2) ** 2
        + ((k + 0.5) * grid.dz - heater.position.z) ** 2;
      weights[id] = Math.exp(-distanceSquared / (2 * settings.heaterRadius ** 2));
      total += weights[id];
    }
    const watts = (heater.model === 'air-conditioner' ? -(heater.powerWatts ?? 1500) : (heater.powerWatts ?? 750)) * (heater.intensity ?? 1);
    const scale = total ? watts / (heatCapacity * volume * total) : 0;
    for (let id = 0; id < rate.length; id += 1) rate[id] += weights[id] * scale;
  }
  return rate;
}

function calculateStats(u, v, w, temperature, solid, outlets, windowFlow, grid, ambientTemperature, projectedDivergence, faces) {
  let maxSpeed = 0;
  let divergenceSquared = 0;
  let fluidCells = 0;
  let totalTemperature = 0;
  let minTemperature = Infinity;
  let maxTemperature = -Infinity;
  let solidCells = 0;
  let netBoundaryFlow = 0;
  let totalBoundaryFlow = 0;
  let maxClosedWallNormalSpeed = 0;
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
        const divergence = projectedDivergence?.[index] ?? 0;
        divergenceSquared += divergence ** 2;
        totalTemperature += temperature[index];
        minTemperature = Math.min(minTemperature, temperature[index]);
        maxTemperature = Math.max(maxTemperature, temperature[index]);
        fluidCells += 1;
        if (outlets[index] & 1) {
          const flux = -windowFlow[index] * grid.dy * grid.dz;
          netBoundaryFlow += flux;
          totalBoundaryFlow += Math.abs(flux);
        }
        if (outlets[index] & 2) {
          const flux = windowFlow[index] * grid.dy * grid.dz;
          netBoundaryFlow += flux;
          totalBoundaryFlow += Math.abs(flux);
        }
        if (outlets[index] & 16) {
          const flux = -windowFlow[index] * grid.dx * grid.dy;
          netBoundaryFlow += flux;
          totalBoundaryFlow += Math.abs(flux);
        }
        if (outlets[index] & 32) {
          const flux = windowFlow[index] * grid.dx * grid.dy;
          netBoundaryFlow += flux;
          totalBoundaryFlow += Math.abs(flux);
        }
        if (i === 0 && !(outlets[index] & 1)) maxClosedWallNormalSpeed = Math.max(maxClosedWallNormalSpeed, Math.abs(faces.xLow[index]));
        if (i + 1 === grid.nx && !(outlets[index] & 2)) maxClosedWallNormalSpeed = Math.max(maxClosedWallNormalSpeed, Math.abs(faces.x[index]));
        if (j + 1 === grid.ny) maxClosedWallNormalSpeed = Math.max(maxClosedWallNormalSpeed, Math.abs(faces.y[index]));
        if (k === 0 && !(outlets[index] & 16)) maxClosedWallNormalSpeed = Math.max(maxClosedWallNormalSpeed, Math.abs(faces.zLow[index]));
        if (k + 1 === grid.nz && !(outlets[index] & 32)) maxClosedWallNormalSpeed = Math.max(maxClosedWallNormalSpeed, Math.abs(faces.z[index]));
      }
    }
  }
  const rmsDivergence = fluidCells ? Number(Math.sqrt(divergenceSquared / fluidCells).toFixed(8)) : 0;
  return {
    maxSpeed: Number(maxSpeed.toFixed(4)),
    rmsDivergence,
    postProjectionRmsDivergence: rmsDivergence,
    netBoundaryFlowM3s: Number(netBoundaryFlow.toFixed(5)),
    boundaryFlowImbalancePercent: totalBoundaryFlow
      ? Number((Math.abs(netBoundaryFlow) / totalBoundaryFlow * 100).toFixed(2)) : 0,
    maxClosedWallNormalSpeed: Number(maxClosedWallNormalSpeed.toFixed(8)),
    meanTemperature: fluidCells ? Number((totalTemperature / fluidCells).toFixed(2)) : ambientTemperature,
    minTemperature: fluidCells ? Number(minTemperature.toFixed(2)) : ambientTemperature,
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
  const { outlets, pressure: windowPressure } = buildWindowBoundary(scene, grid, settings);
  const count = grid.nx * grid.ny * grid.nz;
  const windowFlow = new Float32Array(count);
  const pressureStencil = buildPressureStencil(grid, solid, outlets, windowPressure);
  const fanAcceleration = buildFanAccelerationField(scene, grid, solid, settings);
  const heatRate = buildHeatRate(scene, grid, solid, settings);
  return {
    scene,
    settings,
    grid,
    solid,
    outlets,
    windowPressure,
    windowFlow,
    pressureStencil,
    pressureWorkspace: buildPressureWorkspace(count),
    vorticityWorkspace: buildVorticityWorkspace(count),
    fanAcceleration, heatRate,
    equilibrium: !fanAcceleration.some(Boolean) && !heatRate.some(Boolean) && !windowPressure.some(Boolean) && (settings.outdoorTemperature === settings.ambientTemperature || settings.envelopeUValue === 0),
    envelopeLoss: buildEnvelopeLoss(grid, settings.envelopeUValue),
    step: 0,
    u: new Float32Array(count),
    v: new Float32Array(count),
    w: new Float32Array(count),
    temperature: new Float32Array(count).fill(settings.ambientTemperature),
    nextU: new Float32Array(count),
    nextV: new Float32Array(count),
    nextW: new Float32Array(count),
    nextTemperature: new Float32Array(count),
  };
}

function advanceSimulation(state) {
  if (state.equilibrium) return;
  const { settings, grid, solid, outlets, windowPressure, windowFlow, pressureStencil, pressureWorkspace, vorticityWorkspace, fanAcceleration, heatRate, envelopeLoss } = state;
  const { u, v, w, temperature, nextU, nextV, nextW, nextTemperature } = state;
  const previousU = u;
  const previousV = v;
  const previousW = w;
  if (settings.vorticityConfinement > 0) {
    calculateVorticity(previousU, previousV, previousW, grid, solid, vorticityWorkspace);
  }
  advectState(state);
  applyFanForces(nextU, nextV, nextW, fanAcceleration, settings.timeStep);
  applyVorticityConfinement(nextU, nextV, nextW, grid, solid, vorticityWorkspace, settings.timeStep, settings.vorticityConfinement);
  applyBuoyancy(nextV, temperature, solid, settings.timeStep, settings.ambientTemperature);

  const damp = Math.exp(-0.08 * settings.timeStep);
  for (let index = 0; index < nextU.length; index += 1) {
    if (solid[index]) continue;
    nextU[index] = clamp(nextU[index] * damp, -LIMITS.maxSpeed, LIMITS.maxSpeed);
    nextV[index] = clamp(nextV[index] * damp, -LIMITS.maxSpeed, LIMITS.maxSpeed);
    nextW[index] = clamp(nextW[index] * damp, -LIMITS.maxSpeed, LIMITS.maxSpeed);
    const speed = Math.hypot(nextU[index], nextV[index], nextW[index]);
    if (speed > LIMITS.maxSpeed) {
      const scale = LIMITS.maxSpeed / speed;
      nextU[index] *= scale;
      nextV[index] *= scale;
      nextW[index] *= scale;
    }
  }
  for (let j = 0; j < grid.ny; j += 1) for (let k = 0; k < grid.nz; k += 1) for (let i = 0; i < grid.nx; i += 1) {
    const id = indexOf(i, j, k, grid);
    if (solid[id]) continue;
    nextU[id] += settings.kinematicViscosity * settings.timeStep * laplacian(u, i, j, k, grid, solid);
    nextV[id] += settings.kinematicViscosity * settings.timeStep * laplacian(v, i, j, k, grid, solid);
    nextW[id] += settings.kinematicViscosity * settings.timeStep * laplacian(w, i, j, k, grid, solid);
    let heat = nextTemperature[id] + settings.effectiveThermalDiffusivity * settings.timeStep * laplacian(temperature, i, j, k, grid, solid)
      + (settings.ambientTemperature - nextTemperature[id]) * settings.coolingRate * settings.timeStep;
    heat += (heatRate[id] + (settings.outdoorTemperature - heat) * envelopeLoss[id]) * settings.timeStep;
    nextTemperature[id] = clamp(heat, -20, LIMITS.maxTemperature);
  }
  u.set(nextU); v.set(nextV); w.set(nextW); temperature.set(nextTemperature);
  projectVelocity(u, v, w, grid, solid, outlets, windowPressure, windowFlow,
    pressureStencil, pressureWorkspace, settings.timeStep, settings.pressureIterations);
  for (let id = 0; id < temperature.length; id += 1) {
    if (solid[id]) { temperature[id] = settings.ambientTemperature; continue; }
    if (outlets[id]) {
      const isInlet = outlets[id] & 1 ? windowFlow[id] > 0
        : outlets[id] & 2 ? windowFlow[id] < 0
          : outlets[id] & 16 ? windowFlow[id] > 0 : windowFlow[id] < 0;
      if (isInlet) temperature[id] = settings.outdoorTemperature;
    }
  }
}

function finishSimulation(state) {
  const { settings, grid, solid, outlets, windowPressure, windowFlow, u, v, w, temperature } = state;
  const stats = calculateStats(u, v, w, temperature, solid, outlets, windowFlow, grid,
    settings.ambientTemperature, state.pressureWorkspace.projectedDivergence, state.pressureWorkspace.faces);
  return {
    grid: { ...grid },
    fields: { u, v, w, temperature, solid, outlets, windowPressure, windowFlow },
    backend: 'cpu-preview',
    ambientTemperature: settings.ambientTemperature,
    outdoorTemperature: settings.outdoorTemperature,
    durationSeconds: state.step * settings.timeStep,
    assumptions: Object.freeze({
      ...FIELD_ASSUMPTIONS,
      pressureSolver: `warm-started ${settings.pressureIterations} red/black over-relaxation sweeps per step; no residual-convergence stop`,
    }),
    stats,
  };
}

export function simulateRoomFields(scene, options = {}) {
  const state = createSimulationState(scene, options);
  for (; state.step < state.settings.steps; state.step += 1) advanceSimulation(state);
  return finishSimulation(state);
}

export async function simulateRoomFieldsAsync(scene, options = {}, { isCancelled = () => false, yieldEvery = 2 } = {}) {
  const state = createSimulationState(scene, options);
  for (let step = 0; step < state.settings.steps; step += 1) {
    if (isCancelled()) return null;
    advanceSimulation(state);
    state.step += 1;
    if ((step + 1) % yieldEvery === 0) await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return isCancelled() ? null : finishSimulation(state);
}

export function createRoomFieldsSession(scene, options = {}) {
  const state = createSimulationState(scene, options);
  return {
    get timeSeconds() { return state.step * state.settings.timeStep; },
    async advanceTo(seconds, { isCancelled = () => false } = {}) {
      if (!Number.isFinite(seconds) || seconds < 0 || seconds > 120) throw new RangeError('Elapsed time must be between 0 and 120 seconds.');
      const target = Math.round(seconds / state.settings.timeStep);
      if (target < state.step) throw new RangeError('A simulation session can only advance forward.');
      let lastYield = performance.now();
      while (state.step < target) {
        if (isCancelled()) return null;
        advanceSimulation(state);
        state.step += 1;
        if (performance.now() - lastYield >= 16) {
          await new Promise((resolve) => setTimeout(resolve, 0));
          lastYield = performance.now();
        }
      }
      const result = finishSimulation(state);
      result.fields = Object.fromEntries(Object.entries(result.fields).map(([name, field]) => [name, field.slice()]));
      return isCancelled() ? null : result;
    },
    dispose() {},
  };
}
