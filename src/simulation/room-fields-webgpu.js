import {
  validateScene,
  buildWindowBoundary,
  buildSolidMask,
  buildFanAccelerationField,
  FIELD_PHYSICS_DEFAULTS,
  FIELD_ASSUMPTIONS,
  buildGrid,
  buildHeatRate,
  buildEnvelopeLoss,
  validateOptions,
} from './room-fields-3d.js';


const SETTINGS = Object.freeze({
  ...FIELD_PHYSICS_DEFAULTS,
  cellSize: 0.15,
  steps: 240,
  timeStep: 0.05,
  pressureIterations: 20,
  maximumSpeed: 2.5,
});

const CONFIG_BYTES = 96;
const WORKGROUP_SIZE = 128;
const devicePromises = new WeakMap();
const pipelinePromises = new WeakMap();

export function prepareWebGpuInputs(scene, grid, settings = {}) {
  const physics = {
    ...SETTINGS,
    ...settings,
    outdoorTemperature: settings.outdoorTemperature ?? scene.room.outdoorTemperature ?? SETTINGS.outdoorTemperature,
  };
  const mask = buildSolidMask(scene, grid);
  const solid = Uint32Array.from(mask);
  const boundary = buildWindowBoundary(scene, grid, physics);
  const outlets = Uint32Array.from(boundary.outlets);
  const fanForces = buildFanAccelerationField(scene, grid, solid, physics);
  const rates = buildHeatRate(scene, grid, solid, physics);
  const losses = buildEnvelopeLoss(grid, physics.envelopeUValue);
  const sources = new Float32Array(solid.length * 2);
  for (let id = 0; id < solid.length; id += 1) { sources[id * 2] = rates[id]; sources[id * 2 + 1] = losses[id]; }

  return { sources, solid, outlets, windowPressure: boundary.pressure, fanForces };
}

const COMMON_CONFIG = `
struct Config {
  dims: vec4<u32>,
  counts: vec4<u32>,
  spacing: vec4<f32>,
  physics: vec4<f32>,
  limits: vec4<f32>,
  turbulence: vec4<f32>,
};
@group(0) @binding(0) var<uniform> cfg: Config;

fn indexOf(i: u32, j: u32, k: u32) -> u32 {
  return (j * cfg.dims.z + k) * cfg.dims.x + i;
}
fn inside(i: i32, j: i32, k: i32) -> bool {
  return i >= 0 && j >= 0 && k >= 0
    && i < i32(cfg.dims.x) && j < i32(cfg.dims.y) && k < i32(cfg.dims.z);
}
`;

const PHYSICS_SHADER = `${COMMON_CONFIG}

@group(0) @binding(1) var<storage, read> stateIn: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> solid: array<u32>;
@group(0) @binding(3) var<storage, read> fanForce: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read> heatSources: array<vec2<f32>>;
@group(0) @binding(5) var<storage, read_write> stateOut: array<vec4<f32>>;
@group(0) @binding(6) var<storage, read> vorticity: array<vec4<f32>>;

fn fieldValue(i: i32, j: i32, k: i32, component: u32, fallback: f32) -> f32 {
  if (!inside(i, j, k)) { return fallback; }
  let id = indexOf(u32(i), u32(j), u32(k));
  if (solid[id] != 0u) { return fallback; }
  return stateIn[id][component];
}
fn sampleField(component: u32, point: vec3<f32>, fallback: f32, skipSolid: bool) -> f32 {
  if (any(point < vec3<f32>(0.0)) || any(point > vec3<f32>(cfg.dims.xyz) * cfg.spacing.xyz)) { return fallback; }
  let cell = clamp(point / cfg.spacing.xyz - vec3<f32>(0.5), vec3<f32>(0.0), vec3<f32>(cfg.dims.xyz - vec3<u32>(1u)));
  let low = vec3<u32>(floor(cell));
  let high = min(low + vec3<u32>(1u), cfg.dims.xyz - vec3<u32>(1u));
  let blend = cell - vec3<f32>(low);
  var value = 0.0;
  var weightTotal = 0.0;
  for (var y = 0u; y < 2u; y += 1u) {
    for (var z = 0u; z < 2u; z += 1u) {
      for (var x = 0u; x < 2u; x += 1u) {
        let c = vec3<u32>(select(low.x, high.x, x == 1u), select(low.y, high.y, y == 1u), select(low.z, high.z, z == 1u));
        let weight = select(1.0 - blend.x, blend.x, x == 1u)
          * select(1.0 - blend.y, blend.y, y == 1u)
          * select(1.0 - blend.z, blend.z, z == 1u);
        let id = indexOf(c.x, c.y, c.z);
        if (skipSolid && solid[id] != 0u) { continue; }
        value += fieldValue(i32(c.x), i32(c.y), i32(c.z), component, fallback) * weight;
        weightTotal += weight;
      }
    }
  }
  if (skipSolid) { return select(fallback, value / max(weightTotal, 1e-8), weightTotal > 1e-8); }
  return value;
}
fn clipBacktrace(start: vec3<f32>, end: vec3<f32>) -> vec3<f32> {
  let delta = end - start;
  let stepLength = 0.5 * min(cfg.spacing.x, min(cfg.spacing.y, cfg.spacing.z));
  let steps = max(1u, u32(ceil(length(delta) / stepLength)));
  let roomSize = vec3<f32>(cfg.dims.xyz) * cfg.spacing.xyz;
  var lastFluidPoint = start;
  for (var step = 1u; step <= steps; step += 1u) {
    let point = start + delta * (f32(step) / f32(steps));
    if (any(point < vec3<f32>(0.0)) || any(point > roomSize)) { continue; }
    let cell = clamp(vec3<i32>(floor(point / cfg.spacing.xyz)), vec3<i32>(0), vec3<i32>(cfg.dims.xyz) - vec3<i32>(1));
    if (solid[indexOf(u32(cell.x), u32(cell.y), u32(cell.z))] != 0u) { return lastFluidPoint; }
    lastFluidPoint = point;
  }
  return end;
}
fn neighbor(i: i32, j: i32, k: i32, component: u32, center: f32) -> f32 {
  return fieldValue(i, j, k, component, center);
}
fn laplacian(i: i32, j: i32, k: i32, component: u32, center: f32) -> f32 {
  let x0 = neighbor(i - 1, j, k, component, center);
  let x1 = neighbor(i + 1, j, k, component, center);
  let y0 = neighbor(i, j - 1, k, component, center);
  let y1 = neighbor(i, j + 1, k, component, center);
  let z0 = neighbor(i, j, k - 1, component, center);
  let z1 = neighbor(i, j, k + 1, component, center);
  return (x0 - 2.0 * center + x1) / (cfg.spacing.x * cfg.spacing.x)
    + (y0 - 2.0 * center + y1) / (cfg.spacing.y * cfg.spacing.y)
    + (z0 - 2.0 * center + z1) / (cfg.spacing.z * cfg.spacing.z);
}
fn omegaMagnitude(i: i32, j: i32, k: i32, fallback: f32) -> f32 {
  if (!inside(i, j, k)) { return fallback; }
  let id = indexOf(u32(i), u32(j), u32(k));
  if (solid[id] != 0u) { return fallback; }
  return vorticity[id].w;
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn integrate(@builtin(global_invocation_id) invocation: vec3<u32>) {
  let id = invocation.x;
  let count = cfg.dims.x * cfg.dims.y * cfg.dims.z;
  if (id >= count) { return; }
  if (solid[id] != 0u) {
    stateOut[id] = vec4<f32>(0.0, 0.0, 0.0, cfg.physics.x);
    return;
  }
  let i = id % cfg.dims.x;
  let k = (id / cfg.dims.x) % cfg.dims.z;
  let j = id / (cfg.dims.x * cfg.dims.z);
  let current = stateIn[id];
  let centerOmega = vorticity[id].w;
  let omegaGradient = vec3<f32>(
    (omegaMagnitude(i32(i) + 1, i32(j), i32(k), centerOmega) - omegaMagnitude(i32(i) - 1, i32(j), i32(k), centerOmega)) / (2.0 * cfg.spacing.x),
    (omegaMagnitude(i32(i), i32(j) + 1, i32(k), centerOmega) - omegaMagnitude(i32(i), i32(j) - 1, i32(k), centerOmega)) / (2.0 * cfg.spacing.y),
    (omegaMagnitude(i32(i), i32(j), i32(k) + 1, centerOmega) - omegaMagnitude(i32(i), i32(j), i32(k) - 1, centerOmega)) / (2.0 * cfg.spacing.z));
  let omegaGradientLength = length(omegaGradient);
  var confinement = vec3<f32>(0.0);
  if (omegaGradientLength > 1e-8) {
    confinement = cross(omegaGradient / omegaGradientLength, vorticity[id].xyz)
      * cfg.turbulence.x * min(cfg.spacing.x, min(cfg.spacing.y, cfg.spacing.z));
  }
  let position = (vec3<f32>(f32(i), f32(j), f32(k)) + vec3<f32>(0.5)) * cfg.spacing.xyz;
  let back = clipBacktrace(position, position - current.xyz * cfg.spacing.w);
  let advected = vec4<f32>(
    sampleField(0u, back, 0.0, true), sampleField(1u, back, 0.0, true),
    sampleField(2u, back, 0.0, true), sampleField(3u, back, cfg.physics.x, true));
  let velocityDiffusion = vec3<f32>(
    laplacian(i32(i), i32(j), i32(k), 0u, current.x),
    laplacian(i32(i), i32(j), i32(k), 1u, current.y),
    laplacian(i32(i), i32(j), i32(k), 2u, current.z));
  let temperatureDiffusion = laplacian(i32(i), i32(j), i32(k), 3u, current.w);
  let force = fanForce[id].xyz + confinement;
  var velocity = advected.xyz + force * cfg.spacing.w;
  velocity.y += (current.w - cfg.physics.x) * cfg.limits.y * cfg.spacing.w;
  velocity = velocity * exp(-0.08 * cfg.spacing.w);
  velocity = clamp(velocity, vec3<f32>(-cfg.limits.x), vec3<f32>(cfg.limits.x));
  let speed = length(velocity);
  if (speed > cfg.limits.x) { velocity *= cfg.limits.x / speed; }
  velocity += cfg.physics.y * cfg.spacing.w * velocityDiffusion;
  var temperature = advected.w + cfg.physics.z * cfg.spacing.w * temperatureDiffusion
    + (cfg.physics.x - advected.w) * cfg.physics.w * cfg.spacing.w;
  temperature += (heatSources[id].x + heatSources[id].y * (cfg.limits.z - temperature)) * cfg.spacing.w;
  temperature = clamp(temperature, -20.0, 60.0);
  stateOut[id] = vec4<f32>(velocity, temperature);
}
`;

const VORTICITY_SHADER = `${COMMON_CONFIG}
@group(0) @binding(1) var<storage, read> stateIn: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> solid: array<u32>;
@group(0) @binding(3) var<storage, read_write> vorticityOut: array<vec4<f32>>;
fn velocityAt(i: i32, j: i32, k: i32, fallback: vec3<f32>) -> vec3<f32> {
  if (!inside(i, j, k)) { return fallback; }
  let id = indexOf(u32(i), u32(j), u32(k));
  if (solid[id] != 0u) { return fallback; }
  return stateIn[id].xyz;
}
fn curlAt(i: i32, j: i32, k: i32) -> vec3<f32> {
  let center = stateIn[indexOf(u32(i), u32(j), u32(k))].xyz;
  let left = velocityAt(i - 1, j, k, center);
  let right = velocityAt(i + 1, j, k, center);
  let below = velocityAt(i, j - 1, k, center);
  let above = velocityAt(i, j + 1, k, center);
  let near = velocityAt(i, j, k - 1, center);
  let far = velocityAt(i, j, k + 1, center);
  return vec3<f32>(
    (above.z - below.z) / (2.0 * cfg.spacing.y) - (far.y - near.y) / (2.0 * cfg.spacing.z),
    (far.x - near.x) / (2.0 * cfg.spacing.z) - (right.z - left.z) / (2.0 * cfg.spacing.x),
    (right.y - left.y) / (2.0 * cfg.spacing.x) - (above.x - below.x) / (2.0 * cfg.spacing.y));
}
@compute @workgroup_size(${WORKGROUP_SIZE})
fn calculateVorticity(@builtin(global_invocation_id) invocation: vec3<u32>) {
  let id = invocation.x;
  let count = cfg.dims.x * cfg.dims.y * cfg.dims.z;
  if (id >= count) { return; }
  if (solid[id] != 0u) { vorticityOut[id] = vec4<f32>(0.0); return; }
  let i = id % cfg.dims.x;
  let k = (id / cfg.dims.x) % cfg.dims.z;
  let j = id / (cfg.dims.x * cfg.dims.z);
  let curl = curlAt(i32(i), i32(j), i32(k));
  vorticityOut[id] = vec4<f32>(curl, length(curl));
}
`;

const DIVERGENCE_SHADER = `${COMMON_CONFIG}
@group(0) @binding(1) var<storage, read> state: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> solid: array<u32>;
@group(0) @binding(3) var<storage, read_write> divergence: array<f32>;
@group(0) @binding(4) var<storage, read> outletMask: array<u32>;
fn xEast(i: i32, j: i32, k: i32) -> f32 {
  let id = indexOf(u32(i), u32(j), u32(k));
  if (i + 1 >= i32(cfg.dims.x)) { return select(0.0, state[id].x, (outletMask[id] & 2u) != 0u); }
  let next = indexOf(u32(i + 1), u32(j), u32(k));
  if (solid[id] != 0u || solid[next] != 0u) { return 0.0; }
  return 0.5 * (state[id].x + state[next].x);
}
fn xWest(i: i32, j: i32, k: i32) -> f32 {
  if (i == 0) {
    let id = indexOf(0u, u32(j), u32(k));
    return select(0.0, state[id].x, (outletMask[id] & 1u) != 0u);
  }
  return xEast(i - 1, j, k);
}
fn yNorth(i: i32, j: i32, k: i32) -> f32 {
  if (j + 1 >= i32(cfg.dims.y)) { return 0.0; }
  let id = indexOf(u32(i), u32(j), u32(k));
  let next = indexOf(u32(i), u32(j + 1), u32(k));
  if (solid[id] != 0u || solid[next] != 0u) { return 0.0; }
  return 0.5 * (state[id].y + state[next].y);
}
fn ySouth(i: i32, j: i32, k: i32) -> f32 {
  if (j == 0) { return 0.0; }
  return yNorth(i, j - 1, k);
}
fn zFar(i: i32, j: i32, k: i32) -> f32 {
  let id = indexOf(u32(i), u32(j), u32(k));
  if (k + 1 >= i32(cfg.dims.z)) { return select(0.0, state[id].z, (outletMask[id] & 32u) != 0u); }
  let next = indexOf(u32(i), u32(j), u32(k + 1));
  if (solid[id] != 0u || solid[next] != 0u) { return 0.0; }
  return 0.5 * (state[id].z + state[next].z);
}
fn zNear(i: i32, j: i32, k: i32) -> f32 {
  if (k == 0) {
    let id = indexOf(u32(i), u32(j), 0u);
    return select(0.0, state[id].z, (outletMask[id] & 16u) != 0u);
  }
  return zFar(i, j, k - 1);
}
@compute @workgroup_size(${WORKGROUP_SIZE})
fn calculate(@builtin(global_invocation_id) invocation: vec3<u32>) {
  let id = invocation.x;
  if (id >= cfg.dims.x * cfg.dims.y * cfg.dims.z) { return; }
  if (solid[id] != 0u) { divergence[id] = 0.0; return; }
  let i = i32(id % cfg.dims.x);
  let k = i32((id / cfg.dims.x) % cfg.dims.z);
  let j = i32(id / (cfg.dims.x * cfg.dims.z));
  divergence[id] = (xEast(i, j, k) - xWest(i, j, k)) / cfg.spacing.x
    + (yNorth(i, j, k) - ySouth(i, j, k)) / cfg.spacing.y
    + (zFar(i, j, k) - zNear(i, j, k)) / cfg.spacing.z;
}
`;

const RESET_PRESSURE_SHADER = `${COMMON_CONFIG}
@group(0) @binding(1) var<storage, read_write> pressure: array<f32>;
@compute @workgroup_size(${WORKGROUP_SIZE})
fn clear(@builtin(global_invocation_id) invocation: vec3<u32>) {
  if (invocation.x < cfg.dims.x * cfg.dims.y * cfg.dims.z) { pressure[invocation.x] = 0.0; }
}
`;

const PRESSURE_SHADER = `${COMMON_CONFIG}
@group(0) @binding(1) var<storage, read> divergence: array<f32>;
@group(0) @binding(2) var<storage, read> solid: array<u32>;
@group(0) @binding(3) var<storage, read_write> pressure: array<f32>;
@group(0) @binding(4) var<storage, read> outletMask: array<u32>;
@group(0) @binding(5) var<storage, read> windowPressure: array<f32>;
fn neighborPressure(i: i32, j: i32, k: i32, center: f32) -> f32 {
  if (!inside(i, j, k)) { return center; }
  let id = indexOf(u32(i), u32(j), u32(k));
  return select(pressure[id], center, solid[id] != 0u);
}
fn fluidNeighbor(i: i32, j: i32, k: i32) -> bool {
  if (!inside(i, j, k)) { return false; }
  return solid[indexOf(u32(i), u32(j), u32(k))] == 0u;
}
fn solveColor(invocation: vec3<u32>, color: u32) {
  let id = invocation.x;
  if (id >= cfg.dims.x * cfg.dims.y * cfg.dims.z) { return; }
  if (solid[id] != 0u) { return; }
  let i = i32(id % cfg.dims.x);
  let k = i32((id / cfg.dims.x) % cfg.dims.z);
  let j = i32(id / (cfg.dims.x * cfg.dims.z));
  if ((u32(i + j + k) & 1u) != color) { return; }
  let ix = 1.0 / (cfg.spacing.x * cfg.spacing.x);
  let iy = 1.0 / (cfg.spacing.y * cfg.spacing.y);
  let iz = 1.0 / (cfg.spacing.z * cfg.spacing.z);
  var diagonal = 0.0;
  var sum = 0.0;
  if (fluidNeighbor(i - 1, j, k)) { diagonal += ix; sum += ix * neighborPressure(i - 1, j, k, 0.0); }
  if (fluidNeighbor(i + 1, j, k)) { diagonal += ix; sum += ix * neighborPressure(i + 1, j, k, 0.0); }
  if (fluidNeighbor(i, j - 1, k)) { diagonal += iy; sum += iy * neighborPressure(i, j - 1, k, 0.0); }
  if (fluidNeighbor(i, j + 1, k)) { diagonal += iy; sum += iy * neighborPressure(i, j + 1, k, 0.0); }
  if (fluidNeighbor(i, j, k - 1)) { diagonal += iz; sum += iz * neighborPressure(i, j, k - 1, 0.0); }
  if (fluidNeighbor(i, j, k + 1)) { diagonal += iz; sum += iz * neighborPressure(i, j, k + 1, 0.0); }
  if (i == 0 && (outletMask[id] & 1u) != 0u) { diagonal += 2.0 * ix; sum += 2.0 * ix * windowPressure[id]; }
  if (i + 1 == i32(cfg.dims.x) && (outletMask[id] & 2u) != 0u) { diagonal += 2.0 * ix; sum += 2.0 * ix * windowPressure[id]; }
  if (k == 0 && (outletMask[id] & 16u) != 0u) { diagonal += 2.0 * iz; sum += 2.0 * iz * windowPressure[id]; }
  if (k + 1 == i32(cfg.dims.z) && (outletMask[id] & 32u) != 0u) { diagonal += 2.0 * iz; sum += 2.0 * iz * windowPressure[id]; }
  if (diagonal == 0.0) { return; }
  let relaxedPressure = (sum - divergence[id] / cfg.spacing.w) / diagonal;
  pressure[id] += 1.7 * (relaxedPressure - pressure[id]);
}
@compute @workgroup_size(${WORKGROUP_SIZE})
fn solveRed(@builtin(global_invocation_id) invocation: vec3<u32>) {
  solveColor(invocation, 0u);
}
@compute @workgroup_size(${WORKGROUP_SIZE})
fn solveBlack(@builtin(global_invocation_id) invocation: vec3<u32>) {
  solveColor(invocation, 1u);
}
`;

const PROJECT_SHADER = `${COMMON_CONFIG}
@group(0) @binding(1) var<storage, read> candidate: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> solid: array<u32>;
@group(0) @binding(3) var<storage, read> pressure: array<f32>;
@group(0) @binding(4) var<storage, read_write> stateOut: array<vec4<f32>>;
@group(0) @binding(5) var<storage, read> outletMask: array<u32>;
@group(0) @binding(6) var<storage, read> windowPressure: array<f32>;
@group(0) @binding(7) var<storage, read_write> windowFlowOut: array<f32>;
@group(0) @binding(8) var<storage, read_write> projectedDivergenceOut: array<f32>;
fn initialFace(i: i32, j: i32, k: i32, di: i32, dj: i32, dk: i32, component: u32, bit: u32) -> f32 {
  let id = indexOf(u32(i), u32(j), u32(k));
  if (!inside(i + di, j + dj, k + dk)) { return select(0.0, candidate[id][component], (outletMask[id] & bit) != 0u); }
  let other = indexOf(u32(i + di), u32(j + dj), u32(k + dk));
  if (solid[other] != 0u) { return 0.0; }
  return 0.5 * (candidate[id][component] + candidate[other][component]);
}
fn xEast(i: i32, j: i32, k: i32) -> f32 {
  let id = indexOf(u32(i), u32(j), u32(k));
  if (i + 1 >= i32(cfg.dims.x)) {
    if ((outletMask[id] & 2u) == 0u) { return 0.0; }
    return candidate[id].x - 2.0 * cfg.spacing.w * (windowPressure[id] - pressure[id]) / cfg.spacing.x;
  }
  let next = indexOf(u32(i + 1), u32(j), u32(k));
  if (solid[id] != 0u || solid[next] != 0u) { return 0.0; }
  return 0.5 * (candidate[id].x + candidate[next].x) - cfg.spacing.w * (pressure[next] - pressure[id]) / cfg.spacing.x;
}
fn xWest(i: i32, j: i32, k: i32) -> f32 {
  if (i == 0) {
    let id = indexOf(0u, u32(j), u32(k));
    if ((outletMask[id] & 1u) == 0u) { return 0.0; }
    return candidate[id].x - 2.0 * cfg.spacing.w * (pressure[id] - windowPressure[id]) / cfg.spacing.x;
  }
  return xEast(i - 1, j, k);
}
fn yNorth(i: i32, j: i32, k: i32) -> f32 {
  if (j + 1 >= i32(cfg.dims.y)) { return 0.0; }
  let id = indexOf(u32(i), u32(j), u32(k));
  let next = indexOf(u32(i), u32(j + 1), u32(k));
  if (solid[id] != 0u || solid[next] != 0u) { return 0.0; }
  return 0.5 * (candidate[id].y + candidate[next].y) - cfg.spacing.w * (pressure[next] - pressure[id]) / cfg.spacing.y;
}
fn ySouth(i: i32, j: i32, k: i32) -> f32 {
  if (j == 0) { return 0.0; }
  return yNorth(i, j - 1, k);
}
fn zFar(i: i32, j: i32, k: i32) -> f32 {
  let id = indexOf(u32(i), u32(j), u32(k));
  if (k + 1 >= i32(cfg.dims.z)) {
    if ((outletMask[id] & 32u) == 0u) { return 0.0; }
    return candidate[id].z - 2.0 * cfg.spacing.w * (windowPressure[id] - pressure[id]) / cfg.spacing.z;
  }
  let next = indexOf(u32(i), u32(j), u32(k + 1));
  if (solid[id] != 0u || solid[next] != 0u) { return 0.0; }
  return 0.5 * (candidate[id].z + candidate[next].z) - cfg.spacing.w * (pressure[next] - pressure[id]) / cfg.spacing.z;
}
fn zNear(i: i32, j: i32, k: i32) -> f32 {
  if (k == 0) {
    let id = indexOf(u32(i), u32(j), 0u);
    if ((outletMask[id] & 16u) == 0u) { return 0.0; }
    return candidate[id].z - 2.0 * cfg.spacing.w * (pressure[id] - windowPressure[id]) / cfg.spacing.z;
  }
  return zFar(i, j, k - 1);
}
@compute @workgroup_size(${WORKGROUP_SIZE})
fn project(@builtin(global_invocation_id) invocation: vec3<u32>) {
  let id = invocation.x;
  if (id >= cfg.dims.x * cfg.dims.y * cfg.dims.z) { return; }
  if (solid[id] != 0u) {
    stateOut[id] = vec4<f32>(0.0, 0.0, 0.0, candidate[id].w);
    windowFlowOut[id] = 0.0;
    projectedDivergenceOut[id] = 0.0;
    return;
  }
  let i = i32(id % cfg.dims.x);
  let k = i32((id / cfg.dims.x) % cfg.dims.z);
  let j = i32(id / (cfg.dims.x * cfg.dims.z));
  let west = xWest(i, j, k);
  let east = xEast(i, j, k);
  let south = ySouth(i, j, k);
  let north = yNorth(i, j, k);
  let near = zNear(i, j, k);
  let far = zFar(i, j, k);
  projectedDivergenceOut[id] = (east - west) / cfg.spacing.x
    + (north - south) / cfg.spacing.y + (far - near) / cfg.spacing.z;
  let velocity = candidate[id].xyz + 0.5 * vec3<f32>(
    west + east - initialFace(i, j, k, -1, 0, 0, 0u, 1u) - initialFace(i, j, k, 1, 0, 0, 0u, 2u),
    south + north - initialFace(i, j, k, 0, -1, 0, 1u, 0u) - initialFace(i, j, k, 0, 1, 0, 1u, 0u),
    near + far - initialFace(i, j, k, 0, 0, -1, 2u, 16u) - initialFace(i, j, k, 0, 0, 1, 2u, 32u));
  var temperature = candidate[id].w;
  let mask = outletMask[id];
  if ((mask & 1u) != 0u && west > 0.0) { temperature = cfg.limits.z; }
  if ((mask & 2u) != 0u && east < 0.0) { temperature = cfg.limits.z; }
  if ((mask & 16u) != 0u && near > 0.0) { temperature = cfg.limits.z; }
  if ((mask & 32u) != 0u && far < 0.0) { temperature = cfg.limits.z; }
  var boundaryVelocity = 0.0;
  var boundaryFaceCount = 0u;
  if ((mask & 1u) != 0u) { boundaryVelocity += west; boundaryFaceCount += 1u; }
  if ((mask & 2u) != 0u) { boundaryVelocity += east; boundaryFaceCount += 1u; }
  if ((mask & 16u) != 0u) { boundaryVelocity += near; boundaryFaceCount += 1u; }
  if ((mask & 32u) != 0u) { boundaryVelocity += far; boundaryFaceCount += 1u; }
  windowFlowOut[id] = 0.0;
  if (boundaryFaceCount > 0u) { windowFlowOut[id] = boundaryVelocity / f32(boundaryFaceCount); }
  stateOut[id] = vec4<f32>(velocity, temperature);
}
`;

function makeConfig(grid, settings, heaterCount) {
  const bytes = new ArrayBuffer(CONFIG_BYTES);
  const view = new DataView(bytes);
  [grid.nx, grid.ny, grid.nz, 0, heaterCount, 0, 0, 0].forEach((value, index) => {
    view.setUint32(index * 4, value, true);
  });
  [grid.dx, grid.dy, grid.dz, settings.timeStep,
    settings.ambientTemperature, settings.kinematicViscosity,
    settings.effectiveThermalDiffusivity, settings.coolingRate,
    settings.maximumSpeed, 9.81 / (settings.ambientTemperature + 273.15), settings.outdoorTemperature, 0].forEach((value, index) => {
    view.setFloat32(32 + index * 4, value, true);
  });
  [settings.vorticityConfinement, 0, 0, 0].forEach((value, index) => {
    view.setFloat32(80 + index * 4, value, true);
  });
  return bytes;
}

function makeBuffer(device, size, usage) {
  return device.createBuffer({ size: Math.max(4, size), usage });
}

async function createPipeline(device, code, entryPoint) {
  const module = device.createShaderModule({ code });
  const compilation = await module.getCompilationInfo();
  const errors = compilation.messages.filter((message) => message.type === 'error');
  if (errors.length) throw new Error(`WebGPU shader error: ${errors.map((message) => message.message).join('; ')}`);
  return device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint } });
}

async function getDevice(gpu) {
  let promise = devicePromises.get(gpu);
  if (!promise) {
    promise = (async () => {
      const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (!adapter) {
        devicePromises.delete(gpu);
        return null;
      }
      const device = await adapter.requestDevice();
      device.lost?.then(() => {
        devicePromises.delete(gpu);
        pipelinePromises.delete(device);
      });
      return device;
    })();
    devicePromises.set(gpu, promise);
  }
  try {
    return await promise;
  } catch (error) {
    devicePromises.delete(gpu);
    throw error;
  }
}

async function getPipelines(device) {
  let promise = pipelinePromises.get(device);
  if (!promise) {
    promise = Promise.all([
      createPipeline(device, VORTICITY_SHADER, 'calculateVorticity'),
      createPipeline(device, PHYSICS_SHADER, 'integrate'),
      createPipeline(device, DIVERGENCE_SHADER, 'calculate'),
      createPipeline(device, RESET_PRESSURE_SHADER, 'clear'),
      createPipeline(device, PRESSURE_SHADER, 'solveRed'),
      createPipeline(device, PRESSURE_SHADER, 'solveBlack'),
      createPipeline(device, PROJECT_SHADER, 'project'),
    ]);
    pipelinePromises.set(device, promise);
  }
  try {
    return await promise;
  } catch (error) {
    pipelinePromises.delete(device);
    throw error;
  }
}

function bind(device, pipeline, buffers) {
  return device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: buffers.map((buffer, binding) => ({ binding, resource: { buffer } })),
  });
}

function dispatch(pass, pipeline, group, workgroups) {
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, group);
  pass.dispatchWorkgroups(workgroups);
}

function calculateStats(state, solid, outlets, windowFlow, projectedDivergence, grid, ambientTemperature) {
  let maxSpeed = 0;
  let divergenceSquared = 0;
  let fluidCells = 0;
  let totalTemperature = 0;
  let minTemperature = Infinity;
  let maxTemperature = -Infinity;
  let solidCells = 0;
  let netBoundaryFlow = 0;
  let totalBoundaryFlow = 0;
  const index = (i, j, k) => (j * grid.nz + k) * grid.nx + i;
  const addBoundaryFlux = (id, side, sign, area) => {
    if (!(outlets[id] & side)) return;
    const flux = sign * windowFlow[id] * area;
    netBoundaryFlow += flux;
    totalBoundaryFlow += Math.abs(flux);
  };

  for (let j = 0; j < grid.ny; j += 1) {
    for (let k = 0; k < grid.nz; k += 1) {
      for (let i = 0; i < grid.nx; i += 1) {
        const id = index(i, j, k);
        if (solid[id]) { solidCells += 1; continue; }
        const offset = id * 4;
        maxSpeed = Math.max(maxSpeed, Math.hypot(state[offset], state[offset + 1], state[offset + 2]));
        const cellDivergence = projectedDivergence[id];
        divergenceSquared += cellDivergence * cellDivergence;
        totalTemperature += state[offset + 3];
        minTemperature = Math.min(minTemperature, state[offset + 3]);
        maxTemperature = Math.max(maxTemperature, state[offset + 3]);
        fluidCells += 1;
        addBoundaryFlux(id, 1, -1, grid.dy * grid.dz);
        addBoundaryFlux(id, 2, 1, grid.dy * grid.dz);
        addBoundaryFlux(id, 16, -1, grid.dx * grid.dy);
        addBoundaryFlux(id, 32, 1, grid.dx * grid.dy);
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
    maxClosedWallNormalSpeed: 0,
    meanTemperature: fluidCells ? Number((totalTemperature / fluidCells).toFixed(2)) : ambientTemperature,
    minTemperature: fluidCells ? Number(minTemperature.toFixed(2)) : ambientTemperature,
    maxTemperature: fluidCells ? Number(maxTemperature.toFixed(2)) : ambientTemperature,
    solidCells,
    fluidCells,
  };
}

function readback(device, source, target, byteLength) {
  const encoder = device.createCommandEncoder();
  encoder.copyBufferToBuffer(source, 0, target, 0, byteLength);
  device.queue.submit([encoder.finish()]);
  return target.mapAsync(GPUMapMode.READ).then(() => {
    const copy = target.getMappedRange().slice(0);
    target.unmap();
    return copy;
  });
}

export async function createWebGpuSession(scene, options = {}, gpu = globalThis.navigator?.gpu) {
  validateScene(scene);
  const settings = validateOptions({
    ...SETTINGS, ...options,
    timeStep: options.timeStep ?? ((options.cellSize ?? SETTINGS.cellSize) < 0.15 ? 0.02 : SETTINGS.timeStep),
    ambientTemperature: options.ambientTemperature ?? scene.room.initialTemperature ?? SETTINGS.ambientTemperature,
    envelopeUValue: options.envelopeUValue ?? scene.room.envelopeUValue ?? SETTINGS.envelopeUValue,
    outdoorTemperature: options.outdoorTemperature ?? scene.room.outdoorTemperature ?? SETTINGS.outdoorTemperature,
  }, scene.room);
  if (!gpu) return null;
  const device = await getDevice(gpu);
  if (!device) return null;
  const grid = buildGrid(scene.room, settings.cellSize);
  const count = grid.nx * grid.ny * grid.nz;
  const byteLength = count * 16;
  const inputs = prepareWebGpuInputs(scene, grid, settings);
  const usage = GPUBufferUsage;
  const resources = [];
  const allocate = (size, flags) => {
    const resource = makeBuffer(device, size, flags);
    resources.push(resource);
    return resource;
  };

  let retained = false;
  const dispose = () => resources.forEach((resource) => resource.destroy());
  try {
    const config = allocate(CONFIG_BYTES, usage.UNIFORM | usage.COPY_DST);
    const state = allocate(byteLength, usage.STORAGE | usage.COPY_DST | usage.COPY_SRC);
    const scratch = allocate(byteLength, usage.STORAGE | usage.COPY_DST | usage.COPY_SRC);
    const solid = allocate(count * 4, usage.STORAGE | usage.COPY_DST);
    const outlets = allocate(count * 4, usage.STORAGE | usage.COPY_DST);
    const windowPressure = allocate(count * 4, usage.STORAGE | usage.COPY_DST);
    const windowFlow = allocate(count * 4, usage.STORAGE | usage.COPY_SRC);
    const fanForces = allocate(inputs.fanForces.byteLength, usage.STORAGE | usage.COPY_DST);
    const heatRate = allocate(inputs.sources.byteLength, usage.STORAGE | usage.COPY_DST);
    const pressureA = allocate(count * 4, usage.STORAGE | usage.COPY_DST);
    const divergence = allocate(count * 4, usage.STORAGE | usage.COPY_DST);
    const projectedDivergence = allocate(count * 4, usage.STORAGE | usage.COPY_SRC);
    const readBuffer = allocate(byteLength, usage.COPY_DST | usage.MAP_READ);
    const windowFlowReadBuffer = allocate(count * 4, usage.COPY_DST | usage.MAP_READ);
    const projectedDivergenceReadBuffer = allocate(count * 4, usage.COPY_DST | usage.MAP_READ);
    const packedState = new Float32Array(count * 4);
    for (let id = 0; id < count; id += 1) packedState[id * 4 + 3] = settings.ambientTemperature;
    device.queue.writeBuffer(config, 0, makeConfig(grid, settings, 0));
    device.queue.writeBuffer(state, 0, packedState);
    device.queue.writeBuffer(solid, 0, inputs.solid);
    device.queue.writeBuffer(outlets, 0, inputs.outlets);
    device.queue.writeBuffer(windowPressure, 0, inputs.windowPressure);
    device.queue.writeBuffer(fanForces, 0, inputs.fanForces);
    device.queue.writeBuffer(heatRate, 0, inputs.sources);

    const vorticity = allocate(byteLength, usage.STORAGE);
    const [calculateVorticity, integrate, calculate, clear, solveRed, solveBlack, project] = await getPipelines(device);
    const vorticityGroup = bind(device, calculateVorticity, [config, state, solid, vorticity]);
    const integrateGroup = bind(device, integrate, [config, state, solid, fanForces, heatRate, scratch, vorticity]);
    const divergenceGroup = bind(device, calculate, [config, scratch, solid, divergence, outlets]);
    const clearAGroup = bind(device, clear, [config, pressureA]);
    const solveRedGroup = bind(device, solveRed, [config, divergence, solid, pressureA, outlets, windowPressure]);
    const solveBlackGroup = bind(device, solveBlack, [config, divergence, solid, pressureA, outlets, windowPressure]);
    const projectGroup = bind(device, project, [config, scratch, solid, pressureA, state, outlets, windowPressure, windowFlow, projectedDivergence]);
    const workgroups = Math.ceil(count / WORKGROUP_SIZE);
    const batchSize = 8;
    let currentStep = 0;
    const advanceTo = async (seconds, { isCancelled = () => false } = {}) => {
      if (!Number.isFinite(seconds) || seconds < 0 || seconds > 120) throw new RangeError('Elapsed time must be between 0 and 120 seconds.');
      const target = Math.round(seconds / settings.timeStep);
      if (target < currentStep) throw new RangeError('A simulation session can only advance forward.');
      for (; currentStep < target;) {
        if (isCancelled()) return null;
        const end = Math.min(target, currentStep + batchSize);
        const encoder = device.createCommandEncoder();
        for (; currentStep < end; currentStep += 1) {
          let pass = encoder.beginComputePass();
          dispatch(pass, calculateVorticity, vorticityGroup, workgroups);
          pass.end();
          pass = encoder.beginComputePass();
          dispatch(pass, integrate, integrateGroup, workgroups);
          pass.end();
          pass = encoder.beginComputePass();
          dispatch(pass, calculate, divergenceGroup, workgroups);
          if (currentStep === 0) dispatch(pass, clear, clearAGroup, workgroups);
          for (let iteration = 0; iteration < settings.pressureIterations; iteration += 1) {
            dispatch(pass, solveRed, solveRedGroup, workgroups);
            dispatch(pass, solveBlack, solveBlackGroup, workgroups);
          }
          dispatch(pass, project, projectGroup, workgroups);
          pass.end();
        }
        device.queue.submit([encoder.finish()]);
        await device.queue.onSubmittedWorkDone();
      }
      if (isCancelled()) return null;
      const [packedBytes, windowFlowBytes, projectedDivergenceBytes] = await Promise.all([
        readback(device, state, readBuffer, byteLength),
        readback(device, windowFlow, windowFlowReadBuffer, count * 4),
        readback(device, projectedDivergence, projectedDivergenceReadBuffer, count * 4),
      ]);
      const packed = new Float32Array(packedBytes);
      const fields = {
        u: new Float32Array(count),
        v: new Float32Array(count),
        w: new Float32Array(count),
        temperature: new Float32Array(count),
        solid: Uint8Array.from(inputs.solid),
        outlets: Uint8Array.from(inputs.outlets),
        windowPressure: Float32Array.from(inputs.windowPressure),
        windowFlow: new Float32Array(windowFlowBytes),
      };
      for (let id = 0; id < count; id += 1) {
        const offset = id * 4;
        fields.u[id] = packed[offset];
        fields.v[id] = packed[offset + 1];
        fields.w[id] = packed[offset + 2];
        fields.temperature[id] = packed[offset + 3];
      }
      return {
        grid,
        fields,
        backend: 'webgpu',
        ambientTemperature: settings.ambientTemperature,
        outdoorTemperature: settings.outdoorTemperature,
        durationSeconds: currentStep * settings.timeStep,
        assumptions: Object.freeze({
          ...FIELD_ASSUMPTIONS,
          units: 'velocity in estimated m/s; temperature in estimated °C',
          pressureSolver: `${settings.pressureIterations} red/black over-relaxation sweeps per step; no residual-convergence stop`,
        }),
        stats: calculateStats(packed, fields.solid, fields.outlets, fields.windowFlow,
          new Float32Array(projectedDivergenceBytes), grid, settings.ambientTemperature),
      };
    };
    retained = true;
    return { timeStep: settings.timeStep, get timeSeconds() { return currentStep * settings.timeStep; }, advanceTo, dispose };
  } finally {
    if (!retained) dispose();
  }
}

export async function simulateRoomFieldsWebGpu(scene, options = {}, gpu = globalThis.navigator?.gpu) {
  const session = await createWebGpuSession(scene, options, gpu);
  if (!session) return null;
  try {
    return await session.advanceTo((options.steps ?? SETTINGS.steps) * session.timeStep, options);
  } finally { session.dispose(); }
}
