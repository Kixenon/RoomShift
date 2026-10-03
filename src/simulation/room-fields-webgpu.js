import { rotationMatrixXYZ } from '../model/room-scene.js';
import { validateScene, buildOutletMask, buildSolidMask } from './room-fields-3d.js';
import { createSimulationGrid, DEFAULT_CELL_SIZE } from './room-grid.js';

const SETTINGS = Object.freeze({
  cellSize: DEFAULT_CELL_SIZE,
  steps: 240,
  timeStep: 0.01,
  pressureIterations: 20,
  ambientTemperature: 20,
  kinematicViscosity: 0.018,
  effectiveThermalDiffusivity: 0.012,
  coolingRate: 0.035,
  fanAcceleration: 4.5,
  fanRange: 1.8,
  heaterRate: 8,
  heaterRadius: 0.36,
  maximumSpeed: 2.5,
});

const CONFIG_BYTES = 80;
const WORKGROUP_SIZE = 128;

export function prepareWebGpuInputs(scene, grid, settings = SETTINGS) {
  const mask = buildSolidMask(scene, grid);
  const solid = Uint32Array.from(mask);
  const outlets = Uint32Array.from(buildOutletMask(scene, grid));
  const fans = scene.objects.filter((object) => object.model === 'fan');
  const heaters = scene.objects.filter((object) => object.model === 'heater');
  const fanData = new Float32Array(Math.max(1, fans.length) * 12);
  const heaterData = new Float32Array(Math.max(1, heaters.length) * 8);

  fans.forEach((fan, index) => {
    const matrix = rotationMatrixXYZ(fan.rotation);
    const local = { x: 0, y: fan.dimensions.height * 0.24, z: fan.dimensions.depth * 0.1 };
    const offset = index * 12;
    fanData.set([
      fan.position.x + matrix[0][0] * local.x + matrix[0][1] * local.y + matrix[0][2] * local.z,
      fan.position.y + fan.dimensions.height / 2 + matrix[1][0] * local.x + matrix[1][1] * local.y + matrix[1][2] * local.z,
      fan.position.z + matrix[2][0] * local.x + matrix[2][1] * local.y + matrix[2][2] * local.z,
      settings.fanRange,
      matrix[0][2], matrix[1][2], matrix[2][2], settings.fanAcceleration,
      1.25 * Math.hypot(grid.dx * matrix[0][2], grid.dy * matrix[1][2], grid.dz * matrix[2][2]),
      0.12, 0.2, 0,
    ], offset);
  });

  heaters.forEach((heater, index) => {
    const offset = index * 8;
    heaterData.set([
      heater.position.x,
      heater.position.y + heater.dimensions.height / 2,
      heater.position.z,
      settings.heaterRadius,
      settings.heaterRate, 0, 0, 0,
    ], offset);
  });

  return { solid, outlets, fans: fanData, heaters: heaterData, fanCount: fans.length, heaterCount: heaters.length };
}

const COMMON_CONFIG = `
struct Config {
  dims: vec4<u32>,
  counts: vec4<u32>,
  spacing: vec4<f32>,
  physics: vec4<f32>,
  limits: vec4<f32>,
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
struct Fan { source: vec4<f32>, direction: vec4<f32>, shape: vec4<f32> };
struct Heater { centerRadius: vec4<f32>, source: vec4<f32> };
@group(0) @binding(1) var<storage, read> stateIn: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> solid: array<u32>;
@group(0) @binding(3) var<storage, read> fans: array<Fan>;
@group(0) @binding(4) var<storage, read> heaters: array<Heater>;
@group(0) @binding(5) var<storage, read_write> stateOut: array<vec4<f32>>;
@group(0) @binding(6) var<storage, read> outletMask: array<u32>;

fn fieldValue(i: i32, j: i32, k: i32, component: u32, fallback: f32) -> f32 {
  if (!inside(i, j, k)) { return fallback; }
  let id = indexOf(u32(i), u32(j), u32(k));
  if (solid[id] != 0u) { return fallback; }
  return stateIn[id][component];
}
fn sampleField(component: u32, point: vec3<f32>, fallback: f32) -> f32 {
  if (any(point < vec3<f32>(0.0)) || any(point > vec3<f32>(cfg.dims.xyz) * cfg.spacing.xyz)) { return fallback; }
  let cell = clamp(point / cfg.spacing.xyz - vec3<f32>(0.5), vec3<f32>(0.0), vec3<f32>(cfg.dims.xyz - vec3<u32>(1u)));
  let low = vec3<u32>(floor(cell));
  let high = min(low + vec3<u32>(1u), cfg.dims.xyz - vec3<u32>(1u));
  let blend = cell - vec3<f32>(low);
  var value = 0.0;
  for (var y = 0u; y < 2u; y += 1u) {
    for (var z = 0u; z < 2u; z += 1u) {
      for (var x = 0u; x < 2u; x += 1u) {
        let c = vec3<u32>(select(low.x, high.x, x == 1u), select(low.y, high.y, y == 1u), select(low.z, high.z, z == 1u));
        let weight = select(1.0 - blend.x, blend.x, x == 1u)
          * select(1.0 - blend.y, blend.y, y == 1u)
          * select(1.0 - blend.z, blend.z, z == 1u);
        value += fieldValue(i32(c.x), i32(c.y), i32(c.z), component, fallback) * weight;
      }
    }
  }
  return value;
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
  let position = (vec3<f32>(f32(i), f32(j), f32(k)) + vec3<f32>(0.5)) * cfg.spacing.xyz;
  let back = position - current.xyz * cfg.spacing.w;
  let advected = vec4<f32>(
    sampleField(0u, back, 0.0), sampleField(1u, back, 0.0),
    sampleField(2u, back, 0.0), sampleField(3u, back, cfg.physics.x));
  let velocityDiffusion = vec3<f32>(
    laplacian(i32(i), i32(j), i32(k), 0u, current.x),
    laplacian(i32(i), i32(j), i32(k), 1u, current.y),
    laplacian(i32(i), i32(j), i32(k), 2u, current.z));
  let temperatureDiffusion = laplacian(i32(i), i32(j), i32(k), 3u, current.w);
  var force = vec3<f32>(0.0);
  for (var fanIndex = 0u; fanIndex < cfg.dims.w; fanIndex += 1u) {
    let fan = fans[fanIndex];
    let offset = position - fan.source.xyz;
    let forward = dot(offset, fan.direction.xyz);
    if (forward < -fan.shape.x || forward > fan.source.w) { continue; }
    let lateralSquared = max(0.0, dot(offset, offset) - forward * forward);
    let spread = fan.shape.y + max(0.0, forward) * fan.shape.z;
    let upstreamFade = exp(-0.5 * pow(min(0.0, forward) / fan.shape.x, 2.0));
    let beam = exp(-lateralSquared / (2.0 * spread * spread))
      * exp(-max(0.0, forward) / fan.source.w) * upstreamFade;
    force += fan.direction.xyz * fan.direction.w * beam;
  }
  var velocity = (advected.xyz + cfg.physics.y * cfg.spacing.w * velocityDiffusion + force * cfg.spacing.w) * exp(-0.08 * cfg.spacing.w);
  velocity.y += max(0.0, advected.w - cfg.physics.x) * cfg.limits.y * cfg.spacing.w;
  velocity = clamp(velocity, vec3<f32>(-cfg.limits.x), vec3<f32>(cfg.limits.x));
  let speed = length(velocity);
  if (speed > cfg.limits.x) { velocity *= cfg.limits.x / speed; }
  var temperature = advected.w + cfg.physics.z * cfg.spacing.w * temperatureDiffusion
    + (cfg.physics.x - advected.w) * cfg.physics.w * cfg.spacing.w;
  for (var heaterIndex = 0u; heaterIndex < cfg.counts.x; heaterIndex += 1u) {
    let heater = heaters[heaterIndex];
    let distanceSquared = dot(position - heater.centerRadius.xyz, position - heater.centerRadius.xyz);
    temperature += heater.source.x * exp(-distanceSquared / (2.0 * heater.centerRadius.w * heater.centerRadius.w)) * cfg.spacing.w;
  }
  temperature = clamp(temperature, 0.0, 60.0);
  if (outletMask[id] != 0u) { temperature += (cfg.physics.x - temperature) * min(1.0, cfg.spacing.w * 8.0); }
  if (i == 0u) { velocity.x = select(0.0, min(velocity.x, -0.18), (outletMask[id] & 1u) != 0u); }
  if (i + 1u == cfg.dims.x) { velocity.x = select(0.0, max(velocity.x, 0.18), (outletMask[id] & 2u) != 0u); }
  if (j == 0u || j + 1u == cfg.dims.y) { velocity.y = 0.0; }
  if (k == 0u) { velocity.z = select(0.0, min(velocity.z, -0.18), (outletMask[id] & 16u) != 0u); }
  if (k + 1u == cfg.dims.z) { velocity.z = select(0.0, max(velocity.z, 0.18), (outletMask[id] & 32u) != 0u); }
  if ((i > 0u && solid[indexOf(i - 1u, j, k)] != 0u && velocity.x < 0.0)
    || (i + 1u < cfg.dims.x && solid[indexOf(i + 1u, j, k)] != 0u && velocity.x > 0.0)) { velocity.x = 0.0; }
  if ((j > 0u && solid[indexOf(i, j - 1u, k)] != 0u && velocity.y < 0.0)
    || (j + 1u < cfg.dims.y && solid[indexOf(i, j + 1u, k)] != 0u && velocity.y > 0.0)) { velocity.y = 0.0; }
  if ((k > 0u && solid[indexOf(i, j, k - 1u)] != 0u && velocity.z < 0.0)
    || (k + 1u < cfg.dims.z && solid[indexOf(i, j, k + 1u)] != 0u && velocity.z > 0.0)) { velocity.z = 0.0; }
  stateOut[id] = vec4<f32>(velocity, temperature);
}
`;

const DIVERGENCE_SHADER = `${COMMON_CONFIG}
@group(0) @binding(1) var<storage, read> state: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> solid: array<u32>;
@group(0) @binding(3) var<storage, read_write> divergence: array<f32>;
fn velocity(i: i32, j: i32, k: i32, component: u32) -> f32 {
  if (!inside(i, j, k)) { return 0.0; }
  let id = indexOf(u32(i), u32(j), u32(k));
  return select(state[id][component], 0.0, solid[id] != 0u);
}
@compute @workgroup_size(${WORKGROUP_SIZE})
fn calculate(@builtin(global_invocation_id) invocation: vec3<u32>) {
  let id = invocation.x;
  if (id >= cfg.dims.x * cfg.dims.y * cfg.dims.z) { return; }
  if (solid[id] != 0u) { divergence[id] = 0.0; return; }
  let i = i32(id % cfg.dims.x);
  let k = i32((id / cfg.dims.x) % cfg.dims.z);
  let j = i32(id / (cfg.dims.x * cfg.dims.z));
  divergence[id] = (velocity(i + 1, j, k, 0u) - velocity(i - 1, j, k, 0u)) / (2.0 * cfg.spacing.x)
    + (velocity(i, j + 1, k, 1u) - velocity(i, j - 1, k, 1u)) / (2.0 * cfg.spacing.y)
    + (velocity(i, j, k + 1, 2u) - velocity(i, j, k - 1, 2u)) / (2.0 * cfg.spacing.z);
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
@group(0) @binding(3) var<storage, read> pressureIn: array<f32>;
@group(0) @binding(4) var<storage, read_write> pressureOut: array<f32>;
fn neighborPressure(i: i32, j: i32, k: i32, center: f32) -> f32 {
  if (!inside(i, j, k)) { return center; }
  let id = indexOf(u32(i), u32(j), u32(k));
  return select(pressureIn[id], center, solid[id] != 0u);
}
@compute @workgroup_size(${WORKGROUP_SIZE})
fn solve(@builtin(global_invocation_id) invocation: vec3<u32>) {
  let id = invocation.x;
  if (id >= cfg.dims.x * cfg.dims.y * cfg.dims.z) { return; }
  if (solid[id] != 0u) { pressureOut[id] = 0.0; return; }
  let i = i32(id % cfg.dims.x);
  let k = i32((id / cfg.dims.x) % cfg.dims.z);
  let j = i32(id / (cfg.dims.x * cfg.dims.z));
  let center = pressureIn[id];
  let ix = 1.0 / (cfg.spacing.x * cfg.spacing.x);
  let iy = 1.0 / (cfg.spacing.y * cfg.spacing.y);
  let iz = 1.0 / (cfg.spacing.z * cfg.spacing.z);
  let numerator = ix * (neighborPressure(i - 1, j, k, center) + neighborPressure(i + 1, j, k, center))
    + iy * (neighborPressure(i, j - 1, k, center) + neighborPressure(i, j + 1, k, center))
    + iz * (neighborPressure(i, j, k - 1, center) + neighborPressure(i, j, k + 1, center))
    - divergence[id];
  pressureOut[id] = numerator / (2.0 * (ix + iy + iz));
}
`;

const PROJECT_SHADER = `${COMMON_CONFIG}
@group(0) @binding(1) var<storage, read> candidate: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> solid: array<u32>;
@group(0) @binding(3) var<storage, read> pressure: array<f32>;
@group(0) @binding(4) var<storage, read_write> stateOut: array<vec4<f32>>;
@group(0) @binding(5) var<storage, read> outletMask: array<u32>;
fn pressureAt(i: i32, j: i32, k: i32, center: f32) -> f32 {
  if (!inside(i, j, k)) { return center; }
  let id = indexOf(u32(i), u32(j), u32(k));
  return select(pressure[id], center, solid[id] != 0u);
}
@compute @workgroup_size(${WORKGROUP_SIZE})
fn project(@builtin(global_invocation_id) invocation: vec3<u32>) {
  let id = invocation.x;
  if (id >= cfg.dims.x * cfg.dims.y * cfg.dims.z) { return; }
  if (solid[id] != 0u) { stateOut[id] = vec4<f32>(0.0, 0.0, 0.0, candidate[id].w); return; }
  let i = i32(id % cfg.dims.x);
  let k = i32((id / cfg.dims.x) % cfg.dims.z);
  let j = i32(id / (cfg.dims.x * cfg.dims.z));
  let center = pressure[id];
  var velocity = candidate[id].xyz - vec3<f32>(
    (pressureAt(i + 1, j, k, center) - pressureAt(i - 1, j, k, center)) / (2.0 * cfg.spacing.x),
    (pressureAt(i, j + 1, k, center) - pressureAt(i, j - 1, k, center)) / (2.0 * cfg.spacing.y),
    (pressureAt(i, j, k + 1, center) - pressureAt(i, j, k - 1, center)) / (2.0 * cfg.spacing.z));
  velocity = clamp(velocity, vec3<f32>(-cfg.limits.x), vec3<f32>(cfg.limits.x));
  let speed = length(velocity);
  if (speed > cfg.limits.x) { velocity *= cfg.limits.x / speed; }
  if (i == 0) { velocity.x = select(0.0, min(velocity.x, -0.18), (outletMask[id] & 1u) != 0u); }
  if (i + 1 == i32(cfg.dims.x)) { velocity.x = select(0.0, max(velocity.x, 0.18), (outletMask[id] & 2u) != 0u); }
  if (j == 0 || j + 1 == i32(cfg.dims.y)) { velocity.y = 0.0; }
  if (k == 0) { velocity.z = select(0.0, min(velocity.z, -0.18), (outletMask[id] & 16u) != 0u); }
  if (k + 1 == i32(cfg.dims.z)) { velocity.z = select(0.0, max(velocity.z, 0.18), (outletMask[id] & 32u) != 0u); }
  if ((i > 0 && solid[indexOf(u32(i - 1), u32(j), u32(k))] != 0u && velocity.x < 0.0)
    || (i + 1 < i32(cfg.dims.x) && solid[indexOf(u32(i + 1), u32(j), u32(k))] != 0u && velocity.x > 0.0)) { velocity.x = 0.0; }
  if ((j > 0 && solid[indexOf(u32(i), u32(j - 1), u32(k))] != 0u && velocity.y < 0.0)
    || (j + 1 < i32(cfg.dims.y) && solid[indexOf(u32(i), u32(j + 1), u32(k))] != 0u && velocity.y > 0.0)) { velocity.y = 0.0; }
  if ((k > 0 && solid[indexOf(u32(i), u32(j), u32(k - 1))] != 0u && velocity.z < 0.0)
    || (k + 1 < i32(cfg.dims.z) && solid[indexOf(u32(i), u32(j), u32(k + 1))] != 0u && velocity.z > 0.0)) { velocity.z = 0.0; }
  stateOut[id] = vec4<f32>(velocity, candidate[id].w);
}
`;

function makeConfig(grid, settings, fanCount, heaterCount) {
  const bytes = new ArrayBuffer(CONFIG_BYTES);
  const view = new DataView(bytes);
  [grid.nx, grid.ny, grid.nz, fanCount, heaterCount, 0, 0, 0].forEach((value, index) => {
    view.setUint32(index * 4, value, true);
  });
  [grid.dx, grid.dy, grid.dz, settings.timeStep,
    settings.ambientTemperature, settings.kinematicViscosity,
    settings.effectiveThermalDiffusivity, settings.coolingRate,
    settings.maximumSpeed, 9.81 / (settings.ambientTemperature + 273.15), 0, 0].forEach((value, index) => {
    view.setFloat32(32 + index * 4, value, true);
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

function calculateStats(state, solid, grid, ambientTemperature) {
  let maxSpeed = 0;
  let divergenceSquared = 0;
  let fluidCells = 0;
  let totalTemperature = 0;
  let maxTemperature = -Infinity;
  let solidCells = 0;
  const index = (i, j, k) => (j * grid.nz + k) * grid.nx + i;
  const velocity = (i, j, k, axis) => {
    if (i < 0 || i >= grid.nx || j < 0 || j >= grid.ny || k < 0 || k >= grid.nz) return 0;
    const id = index(i, j, k);
    return solid[id] ? 0 : state[id * 4 + axis];
  };

  for (let j = 0; j < grid.ny; j += 1) {
    for (let k = 0; k < grid.nz; k += 1) {
      for (let i = 0; i < grid.nx; i += 1) {
        const id = index(i, j, k);
        if (solid[id]) { solidCells += 1; continue; }
        const offset = id * 4;
        maxSpeed = Math.max(maxSpeed, Math.hypot(state[offset], state[offset + 1], state[offset + 2]));
        const divergence = (velocity(i + 1, j, k, 0) - velocity(i - 1, j, k, 0)) / (2 * grid.dx)
          + (velocity(i, j + 1, k, 1) - velocity(i, j - 1, k, 1)) / (2 * grid.dy)
          + (velocity(i, j, k + 1, 2) - velocity(i, j, k - 1, 2)) / (2 * grid.dz);
        divergenceSquared += divergence * divergence;
        totalTemperature += state[offset + 3];
        maxTemperature = Math.max(maxTemperature, state[offset + 3]);
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

export async function simulateRoomFieldsWebGpu(scene, options = {}, gpu = globalThis.navigator?.gpu) {
  validateScene(scene);
  const settings = { ...SETTINGS, ...options };
  if (!gpu) return null;
  const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) return null;
  const device = await adapter.requestDevice();
  const grid = createSimulationGrid(scene.room, settings.cellSize);
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

  try {
    const config = allocate(CONFIG_BYTES, usage.UNIFORM | usage.COPY_DST);
    const state = allocate(byteLength, usage.STORAGE | usage.COPY_DST | usage.COPY_SRC);
    const scratch = allocate(byteLength, usage.STORAGE | usage.COPY_DST | usage.COPY_SRC);
    const solid = allocate(count * 4, usage.STORAGE | usage.COPY_DST);
    const outlets = allocate(count * 4, usage.STORAGE | usage.COPY_DST);
    const fans = allocate(inputs.fans.byteLength, usage.STORAGE | usage.COPY_DST);
    const heaters = allocate(inputs.heaters.byteLength, usage.STORAGE | usage.COPY_DST);
    const pressureA = allocate(count * 4, usage.STORAGE | usage.COPY_DST);
    const pressureB = allocate(count * 4, usage.STORAGE | usage.COPY_DST);
    const divergence = allocate(count * 4, usage.STORAGE | usage.COPY_DST);
    const readBuffer = allocate(byteLength, usage.COPY_DST | usage.MAP_READ);
    const packedState = new Float32Array(count * 4);
    for (let id = 0; id < count; id += 1) packedState[id * 4 + 3] = settings.ambientTemperature;
    device.queue.writeBuffer(config, 0, makeConfig(grid, settings, inputs.fanCount, inputs.heaterCount));
    device.queue.writeBuffer(state, 0, packedState);
    device.queue.writeBuffer(solid, 0, inputs.solid);
    device.queue.writeBuffer(outlets, 0, inputs.outlets);
    device.queue.writeBuffer(fans, 0, inputs.fans);
    device.queue.writeBuffer(heaters, 0, inputs.heaters);

    const [integrate, calculate, clear, solve, project] = await Promise.all([
      createPipeline(device, PHYSICS_SHADER, 'integrate'),
      createPipeline(device, DIVERGENCE_SHADER, 'calculate'),
      createPipeline(device, RESET_PRESSURE_SHADER, 'clear'),
      createPipeline(device, PRESSURE_SHADER, 'solve'),
      createPipeline(device, PROJECT_SHADER, 'project'),
    ]);
    const integrateGroup = bind(device, integrate, [config, state, solid, fans, heaters, scratch, outlets]);
    const divergenceGroup = bind(device, calculate, [config, scratch, solid, divergence]);
    const clearAGroup = bind(device, clear, [config, pressureA]);
    const clearBGroup = bind(device, clear, [config, pressureB]);
    const solveABGroup = bind(device, solve, [config, divergence, solid, pressureA, pressureB]);
    const solveBAGroup = bind(device, solve, [config, divergence, solid, pressureB, pressureA]);
    const projectAGroup = bind(device, project, [config, scratch, solid, pressureA, state, outlets]);
    const projectBGroup = bind(device, project, [config, scratch, solid, pressureB, state, outlets]);
    const workgroups = Math.ceil(count / WORKGROUP_SIZE);

    for (let step = 0; step < settings.steps; step += 1) {
      if (options.isCancelled?.()) return null;
      const encoder = device.createCommandEncoder();
      let pass = encoder.beginComputePass();
      dispatch(pass, integrate, integrateGroup, workgroups);
      pass.end();
      pass = encoder.beginComputePass();
      dispatch(pass, calculate, divergenceGroup, workgroups);
      dispatch(pass, clear, clearAGroup, workgroups);
      let pressureOnA = true;
      for (let iteration = 0; iteration < settings.pressureIterations; iteration += 1) {
        dispatch(pass, solve, pressureOnA ? solveABGroup : solveBAGroup, workgroups);
        pressureOnA = !pressureOnA;
      }
      dispatch(pass, project, pressureOnA ? projectAGroup : projectBGroup, workgroups);
      pass.end();
      device.queue.submit([encoder.finish()]);
      await device.queue.onSubmittedWorkDone();
    }
    if (options.isCancelled?.()) return null;
    const packed = new Float32Array(await readback(device, state, readBuffer, byteLength));
    const fields = {
      u: new Float32Array(count),
      v: new Float32Array(count),
      w: new Float32Array(count),
      temperature: new Float32Array(count),
      solid: Uint8Array.from(inputs.solid),
      outlets: Uint8Array.from(inputs.outlets),
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
      durationSeconds: settings.steps * settings.timeStep,
      assumptions: Object.freeze({
        model: 'GPU accelerated 3D incompressible transient room-field estimate',
        units: 'velocity in m/s; temperature in estimated °C',
        boundaries: 'closed room walls with one-way atmospheric window outlets when opened',
        thermalDiffusivity: 'effective mixing coefficient; not molecular air diffusivity',
        maximumGridCells: 1_500_000,
      }),
      stats: calculateStats(packed, fields.solid, grid, settings.ambientTemperature),
    };
  } finally {
    for (const resource of resources) resource.destroy();
    device.destroy();
  }
}
