import { floorContains, insidePartition, partitionsOf, rotatedHalfExtents, rotationMatrixXYZ, sourceScale } from '../model/room-scene.js';

const LIMITS = Object.freeze({
  roomMin: 2,
  roomMax: 20,
  heightMin: 2,
  heightMax: 6,
  minCellSize: 0.15,
  maxCellSize: 0.75,
  minSteps: 1,
  maxSteps: 40,
  minPressureIterations: 4,
  maxPressureIterations: 20,
  maxGridX: 40,
  maxGridY: 24,
  maxGridZ: 40,
  maxSpeed: 2.5,
  maxTemperature: 60,
});

const DEFAULTS = Object.freeze({
  cellSize: 0.15,
  steps: 40,
  timeStep: 0.05,
  pressureIterations: 12,
  ambientTemperature: 20,
  kinematicViscosity: 0.018,
  effectiveThermalDiffusivity: 0.012,
  coolingRate: 0.035,
  fanAcceleration: 4.5,
  fanRange: 1.8,
  heaterRate: 8,
  heaterRadius: 0.36,
});
const FAN_SOURCE_GRID_CELLS = 1.25;

export const FIELD_ASSUMPTIONS = Object.freeze({
  model: '3D incompressible transient room-field estimate',
  defaultCellSizeMeters: DEFAULTS.cellSize,
  defaultDurationSeconds: DEFAULTS.steps * DEFAULTS.timeStep,
  maximumGridDimensions: Object.freeze([LIMITS.maxGridX, LIMITS.maxGridY, LIMITS.maxGridZ]),
  maximumGridCells: LIMITS.maxGridX * LIMITS.maxGridY * LIMITS.maxGridZ,
  maximumSteps: LIMITS.maxSteps,
  maximumPressureIterations: LIMITS.maxPressureIterations,
  maximumSpeedMetersPerSecond: LIMITS.maxSpeed,
  thermalSourceUnits: 'estimated degrees Celsius per second',
  thermalDiffusivity: 'effective mixing coefficient; not molecular air diffusivity',
  boundaries: 'closed walls with one-way atmospheric window outlets when opened',
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

  for (const object of scene.objects) {
    if (![object?.position?.x, object?.position?.y, object?.position?.z,
      object?.dimensions?.width, object?.dimensions?.height, object?.dimensions?.depth,
      object?.rotation?.x, object?.rotation?.y, object?.rotation?.z].every(Number.isFinite)
      || object.dimensions.width <= 0 || object.dimensions.height <= 0 || object.dimensions.depth <= 0) {
      throw new TypeError(`Object ${object?.id ?? '(unknown)'} has invalid geometry.`);
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
}

function validateOptions(options, room) {
  const values = { ...DEFAULTS, ...options };
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
  // Cells outside an L-shaped or rounded floor are solid wall.
  if (scene.room.shape && scene.room.shape.type !== 'rect') {
    for (let k = 0; k < grid.nz; k += 1) {
      for (let i = 0; i < grid.nx; i += 1) {
        if (floorContains(scene.room, (i + 0.5) * grid.dx, (k + 0.5) * grid.dz)) continue;
        for (let j = 0; j < grid.ny; j += 1) solid[indexOf(i, j, k, grid)] = 1;
      }
    }
  }
  // Interior walls are solid, except their doorways below door height.
  if (partitionsOf(scene).length) {
    for (let j = 0; j < grid.ny; j += 1) {
      const y = (j + 0.5) * grid.dy;
      for (let k = 0; k < grid.nz; k += 1) {
        for (let i = 0; i < grid.nx; i += 1) {
          if (insidePartition(scene, (i + 0.5) * grid.dx, (k + 0.5) * grid.dz, y, Math.max(grid.dx, grid.dz) * 0.35)) solid[indexOf(i, j, k, grid)] = 1;
        }
      }
    }
  }
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

export function buildOutletMask(scene, grid) {
  const outlets = new Uint8Array(grid.nx * grid.ny * grid.nz);
  for (const window of scene.objects) {
    if (window.model !== 'window' || !window.open) continue;
    const alongX = window.wall === 'back' || window.wall === 'front';
    const sideBit = window.wall === 'left' ? 1
      : window.wall === 'right' ? 2
        : window.wall === 'front' ? 16 : 32;
    for (let j = 0; j < grid.ny; j += 1) {
      const y = (j + 0.5) * grid.dy;
      if (y < window.position.y || y > window.position.y + window.dimensions.height) continue;
      for (let k = 0; k < grid.nz; k += 1) {
        for (let i = 0; i < grid.nx; i += 1) {
          if (alongX) {
            const x = (i + 0.5) * grid.dx;
            if (Math.abs(x - window.position.x) > window.dimensions.width / 2) continue;
            if (window.wall === 'back' && k === grid.nz - 1) outlets[indexOf(i, j, k, grid)] |= sideBit;
            if (window.wall === 'front' && k === 0) outlets[indexOf(i, j, k, grid)] |= sideBit;
          } else {
            const z = (k + 0.5) * grid.dz;
            if (Math.abs(z - window.position.z) > window.dimensions.width / 2) continue;
            if (window.wall === 'left' && i === 0) outlets[indexOf(i, j, k, grid)] |= sideBit;
            if (window.wall === 'right' && i === grid.nx - 1) outlets[indexOf(i, j, k, grid)] |= sideBit;
          }
        }
      }
    }
  }
  return outlets;
}

function sampleField(field, x, y, z, grid, solid, fallback) {
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

  for (let oy = 0; oy <= 1; oy += 1) {
    for (let oz = 0; oz <= 1; oz += 1) {
      for (let ox = 0; ox <= 1; ox += 1) {
        const i = ox ? x1 : x0;
        const j = oy ? y1 : y0;
        const k = oz ? z1 : z0;
        const weight = (ox ? tx : 1 - tx) * (oy ? ty : 1 - ty) * (oz ? tz : 1 - tz);
        const index = indexOf(i, j, k, grid);
        value += (solid[index] ? fallback : field[index]) * weight;
      }
    }
  }
  return value;
}

function advect(field, u, v, w, grid, solid, timeStep, fallback) {
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
        next[index] = sampleField(
          field,
          position.x - u[index] * timeStep,
          position.y - v[index] * timeStep,
          position.z - w[index] * timeStep,
          grid,
          solid,
          fallback,
        );
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

function applyVelocityBoundaries(u, v, w, grid, solid, outlets) {
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
        if (i === 0) u[index] = outlets[index] & 1 ? Math.min(u[index], -0.18) : 0;
        if (i === grid.nx - 1) u[index] = outlets[index] & 2 ? Math.max(u[index], 0.18) : 0;
        if (j === 0 || j === grid.ny - 1) v[index] = 0;
        if (k === 0) w[index] = outlets[index] & 16 ? Math.min(w[index], -0.18) : 0;
        if (k === grid.nz - 1) w[index] = outlets[index] & 32 ? Math.max(w[index], 0.18) : 0;
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

function applyFanForces(u, v, w, fans, grid, solid, timeStep, settings) {
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
          const position = cellPosition(i, j, k, grid);
          const dx = position.x - source.x;
          const dy = position.y - source.y;
          const dz = position.z - source.z;
          const forward = dx * direction[0] + dy * direction[1] + dz * direction[2];
          if (forward < -sourceReach || forward > settings.fanRange) continue;
          const lateralSquared = Math.max(0, dx ** 2 + dy ** 2 + dz ** 2 - forward ** 2);
          const spread = 0.12 + Math.max(0, forward) * 0.2;
          const upstreamFade = Math.exp(-0.5 * (Math.min(0, forward) / sourceReach) ** 2);
          const beam = Math.exp(-lateralSquared / (2 * spread ** 2))
            * Math.exp(-Math.max(0, forward) / settings.fanRange)
            * upstreamFade;
          const magnitude = settings.fanAcceleration * sourceScale(fan) * beam * timeStep;
          u[index] += direction[0] * magnitude;
          v[index] += direction[1] * magnitude;
          w[index] += direction[2] * magnitude;
        }
      }
    }
  }
}

function applyBuoyancy(v, temperature, solid, timeStep, ambientTemperature) {
  const accelerationPerDegree = 9.81 / (ambientTemperature + 273.15);
  for (let index = 0; index < v.length; index += 1) {
    if (!solid[index]) {
      v[index] += Math.max(0, temperature[index] - ambientTemperature) * accelerationPerDegree * timeStep;
    }
  }
}

function projectVelocity(u, v, w, grid, solid, outlets, iterations) {
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
  applyVelocityBoundaries(u, v, w, grid, solid, outlets);
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
          temperature[index] += settings.heaterRate * sourceScale(heater) * Math.exp(-distanceSquared / radiusSquared) * timeStep;
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

export function simulateRoomFields(scene, options = {}) {
  validateScene(scene);
  const settings = validateOptions(options, scene.room);
  const grid = buildGrid(scene.room, settings.cellSize);
  const solid = buildSolidMask(scene, grid);
  const outlets = buildOutletMask(scene, grid);
  const fans = scene.objects.filter((object) => object.model === 'fan');
  const heaters = scene.objects.filter((object) => object.model === 'heater');
  let u = new Float32Array(grid.nx * grid.ny * grid.nz);
  let v = new Float32Array(u.length);
  let w = new Float32Array(u.length);
  let temperature = new Float32Array(u.length).fill(settings.ambientTemperature);

  for (let step = 0; step < settings.steps; step += 1) {
    const previousU = u;
    const previousV = v;
    const previousW = w;
    u = advect(previousU, previousU, previousV, previousW, grid, solid, settings.timeStep, 0);
    v = advect(previousV, previousU, previousV, previousW, grid, solid, settings.timeStep, 0);
    w = advect(previousW, previousU, previousV, previousW, grid, solid, settings.timeStep, 0);
    applyFanForces(u, v, w, fans, grid, solid, settings.timeStep, settings);
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
    projectVelocity(u, v, w, grid, solid, outlets, settings.pressureIterations);
    for (let index = 0; index < u.length; index += 1) {
      const speed = Math.hypot(u[index], v[index], w[index]);
      if (speed > LIMITS.maxSpeed) {
        const scale = LIMITS.maxSpeed / speed;
        u[index] *= scale;
        v[index] *= scale;
        w[index] *= scale;
      }
    }

    temperature = advect(temperature, u, v, w, grid, solid, settings.timeStep, settings.ambientTemperature);
    temperature = diffuse(temperature, settings.effectiveThermalDiffusivity, settings.timeStep, grid, solid, 0, LIMITS.maxTemperature);
    for (let index = 0; index < temperature.length; index += 1) {
      if (solid[index]) {
        temperature[index] = settings.ambientTemperature;
        continue;
      }
      if (outlets[index]) temperature[index] += (settings.ambientTemperature - temperature[index]) * Math.min(1, settings.timeStep * 8);
      temperature[index] = clamp(
        temperature[index] + (settings.ambientTemperature - temperature[index]) * settings.coolingRate * settings.timeStep,
        0,
        LIMITS.maxTemperature,
      );
    }
    addHeatSources(temperature, heaters, grid, solid, settings, settings.timeStep);
    for (let index = 0; index < temperature.length; index += 1) {
      temperature[index] = clamp(temperature[index], 0, LIMITS.maxTemperature);
    }
  }

  const stats = calculateStats(u, v, w, temperature, solid, grid, settings.ambientTemperature);
  return {
    grid: { ...grid, cellSize: settings.cellSize },
    fields: { u, v, w, temperature, solid, outlets },
    backend: 'cpu-preview',
    ambientTemperature: settings.ambientTemperature,
    durationSeconds: settings.steps * settings.timeStep,
    assumptions: FIELD_ASSUMPTIONS,
    stats,
  };
}
