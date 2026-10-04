import { rotationMatrixXYZ } from '../model/room-scene.js';
import { isOpeningObject } from '../model/openings.js';
import { createSimulationGrid, DEFAULT_CELL_SIZE, MAX_SIMULATION_CELLS } from './room-grid.js';
import { buildSolidMask } from './room-fields-3d.js';
import { describeDaylight, DEFAULT_TIME_MINUTES } from './daylight.js';

// Radiosity light model.
//
// The room is treated as a closed box of diffuse surfaces. Each surface first
// collects direct light — lamps as point emitters (inverse-square, cosine law,
// blocked by opaque objects), direct sun through each open aperture, and the sky
// seen through each aperture as a small diffuse emitter — and then re-emits
// reflectance × illuminance as a Lambertian patch. A first-bounce gather over
// those patches, extended by the geometric series 1 / (1 − ρ̄) for the later
// bounces, gives the inter-reflected component. This is what makes the room
// read as lit from its windows: even with no direct sun, the sky through an
// opening is a source, and every lit surface feeds the surfaces around it.
//
// It is still an estimate, not calibrated photometry: reflectances and the
// clear-sky constants are typical textbook figures, the patches are coarse, and
// furniture is treated as opaque boxes rather than shaped geometry.

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export const LAMP_LUMENS = Object.freeze({ lamp: 1200, ceilingLight: 1600, deskLamp: 450 });
const OBJECT_REFLECTANCE = Object.freeze({
  fan: 0.5, sofa: 0.35, bed: 0.35, desk: 0.4, table: 0.4,
  lamp: 0.5, heater: 0.6, box: 0.5,
});
const FLOOR_REFLECTANCE = 0.35;
const WALL_REFLECTANCE = 0.8;
const CEILING_REFLECTANCE = 0.8;
// A closed window still passes diffuse sky (glass ~34%); a closed door does not.
const CLOSED_WINDOW_TRANSMISSION = 0.34;
const UP = Object.freeze({ x: 0, y: 1, z: 0 });

const reflectanceFor = (model) => OBJECT_REFLECTANCE[model] ?? 0.5;

function lampLumens(object) {
  const base = LAMP_LUMENS[object.model] ?? LAMP_LUMENS.lamp;
  return base * (object.enabled === false ? 0 : (object.intensity ?? 1));
}

function boxFor(object) {
  return {
    object,
    center: {
      x: object.position.x,
      y: object.position.y + object.dimensions.height / 2,
      z: object.position.z,
    },
    half: {
      x: object.dimensions.width / 2,
      y: object.dimensions.height / 2,
      z: object.dimensions.depth / 2,
    },
    matrix: rotationMatrixXYZ(object.rotation ?? { x: 0, y: 0, z: 0 }),
  };
}

// Slab test in the box's local frame; true when the segment a→b crosses the box.
function segmentHitsBox(a, b, box) {
  const toLocal = (point) => {
    const x = point.x - box.center.x;
    const y = point.y - box.center.y;
    const z = point.z - box.center.z;
    const m = box.matrix;
    return [
      m[0][0] * x + m[1][0] * y + m[2][0] * z,
      m[0][1] * x + m[1][1] * y + m[2][1] * z,
      m[0][2] * x + m[1][2] * y + m[2][2] * z,
    ];
  };
  const p = toLocal(a);
  const q = toLocal(b);
  const half = [box.half.x, box.half.y, box.half.z];
  let t0 = 0;
  let t1 = 1;
  for (let axis = 0; axis < 3; axis += 1) {
    const d = q[axis] - p[axis];
    if (Math.abs(d) < 1e-9) {
      if (Math.abs(p[axis]) > half[axis]) return false;
      continue;
    }
    let near = (-half[axis] - p[axis]) / d;
    let far = (half[axis] - p[axis]) / d;
    if (near > far) [near, far] = [far, near];
    t0 = Math.max(t0, near);
    t1 = Math.min(t1, far);
    if (t0 > t1) return false;
  }
  return true;
}

// Openings are apertures, not solids, so they never occlude the light they let in.
const opaqueBoxes = (scene) => scene.objects
  .filter((object) => !isOpeningObject(object))
  .map(boxFor);

function windowRect(opening, room) {
  const { width: roomWidth, depth: roomDepth } = room;
  const half = opening.dimensions.width / 2;
  const bottom = opening.position.y;
  const top = bottom + opening.dimensions.height;
  switch (opening.wall) {
    case 'back':
      return { alongX: true, plane: roomDepth, lo: opening.position.x - half, hi: opening.position.x + half, bottom, top, inward: [0, -1] };
    case 'front':
      return { alongX: true, plane: 0, lo: opening.position.x - half, hi: opening.position.x + half, bottom, top, inward: [0, 1] };
    case 'left':
      return { alongX: false, plane: 0, lo: opening.position.z - half, hi: opening.position.z + half, bottom, top, inward: [1, 0] };
    case 'right':
      return { alongX: false, plane: roomWidth, lo: opening.position.z - half, hi: opening.position.z + half, bottom, top, inward: [-1, 0] };
    default:
      return null;
  }
}

// Does the ray from `point` along `direction` leave the room through this window?
function rayThroughWindow(point, direction, rect) {
  const along = rect.alongX ? direction.z : direction.x;
  if (Math.abs(along) < 1e-6) return false;
  const t = (rect.plane - (rect.alongX ? point.z : point.x)) / along;
  if (t <= 0) return false;
  const y = point.y + direction.y * t;
  const s = rect.alongX ? point.x + direction.x * t : point.z + direction.z * t;
  return y >= rect.bottom && y <= rect.top && s >= rect.lo && s <= rect.hi;
}

function windowData(opening, room) {
  const rect = windowRect(opening, room);
  if (!rect) return null;
  const transmit = opening.open === false
    ? (opening.model === 'window' ? CLOSED_WINDOW_TRANSMISSION : 0)
    : 1;
  if (transmit <= 0) return null;
  const centre = rect.alongX
    ? { x: opening.position.x, y: (rect.bottom + rect.top) / 2, z: rect.plane }
    : { x: rect.plane, y: (rect.bottom + rect.top) / 2, z: opening.position.z };
  return {
    object: opening,
    rect,
    transmit,
    area: opening.dimensions.width * opening.dimensions.height,
    centre,
  };
}

function lampBulb(lamp) {
  const matrix = rotationMatrixXYZ(lamp.rotation ?? { x: 0, y: 0, z: 0 });
  const localY = lamp.dimensions.height * 0.22;
  return {
    position: {
      x: lamp.position.x + matrix[0][1] * localY,
      y: lamp.position.y + lamp.dimensions.height / 2 + matrix[1][1] * localY,
      z: lamp.position.z + matrix[2][1] * localY,
    },
    // The lamp aims along its local -Y, so lamps with a shade push light one way.
    direction: [-matrix[0][1], -matrix[1][1], -matrix[2][1]],
  };
}

function blocked(context, from, to, skipId = null) {
  for (const box of context.boxes) {
    if (skipId && box.object.id === skipId) continue;
    if (segmentHitsBox(from, to, box)) return true;
  }
  return false;
}

// Light from the lamps at their bulb positions: inverse-square with the cosine
// law at the surface, weighted by how well the point lines up with the shade.
function lampLux(context, point, normal) {
  let lux = 0;
  for (const lamp of context.lamps) {
    const { position, direction } = lamp.bulb;
    const dx = point.x - position.x;
    const dy = point.y - position.y;
    const dz = point.z - position.z;
    const distanceSquared = Math.max(0.04, dx * dx + dy * dy + dz * dz);
    const distance = Math.sqrt(distanceSquared);
    const aim = (dx * direction[0] + dy * direction[1] + dz * direction[2]) / distance;
    if (aim <= 0) continue;
    const cosine = -(dx * normal.x + dy * normal.y + dz * normal.z) / distance;
    if (cosine <= 0) continue;
    if (blocked(context, position, point, lamp.object.id)) continue;
    const intensity = lamp.lumens / (4 * Math.PI);
    lux += intensity * aim * cosine / distanceSquared;
  }
  return lux;
}

// Direct sun reaching a point through an open aperture.
function sunLux(context, point, normal) {
  const { toSun, directNormal, windows } = context;
  if (!toSun || toSun.y <= 0) return 0;
  let lux = 0;
  for (const window of windows) {
    const { rect, transmit } = window;
    if (!rayThroughWindow(point, toSun, rect)) continue;
    const cosine = toSun.x * normal.x + toSun.y * normal.y + toSun.z * normal.z;
    if (cosine <= 0) continue;
    const far = { x: point.x + toSun.x * 20, y: point.y + toSun.y * 20, z: point.z + toSun.z * 20 };
    if (!blocked(context, point, far)) lux += directNormal * cosine * transmit;
  }
  return lux;
}

// The sky seen through each aperture is a diffuse emitter, so it lights the room
// by the window's solid angle (the same form factor a real daylight model uses).
// This is the term that keeps the room lit when the sun is too high to reach a
// vertical opening, and it is what the preview's window fill is built from.
export function skyLux(context, point, normal = UP) {
  const { skyLuminance, windows } = context;
  let lux = 0;
  for (const window of windows) {
    const { rect, centre, transmit, area } = window;
    const vx = centre.x - point.x;
    const vy = centre.y - point.y;
    const vz = centre.z - point.z;
    const distanceSquared = Math.max(0.25, vx * vx + vy * vy + vz * vz);
    const distance = Math.sqrt(distanceSquared);
    const atWindow = Math.abs(rect.alongX ? vz : vx) / distance;
    const atPoint = (vx * normal.x + vy * normal.y + vz * normal.z) / distance;
    if (atPoint <= 0 || blocked(context, point, centre)) continue;
    // The sky is brighter overhead, so a window seen from below looks dimmer.
    const luminance = skyLuminance * (0.6 + 0.4 * Math.max(0, vy / distance + 0.3));
    lux += luminance * transmit * area * atWindow * atPoint / distanceSquared;
  }
  return lux;
}

/**
 * Diffuse radiance leaving an aperture, for the preview's window area lights.
 * Only the sky term: direct sun is rendered separately by the shadow-casting key
 * light, so folding it in here would count that light twice.
 */
export function windowRadiance(context, window) {
  return context.skyLuminance * window.transmit;
}

// Direct light only (lamps, direct sun and diffuse sky through apertures).
export function directLux(context, point, normal = UP) {
  return lampLux(context, point, normal) + sunLux(context, point, normal) + skyLux(context, point, normal);
}

// Radiosity patches on the six room surfaces. Each re-emits reflectance × its
// own direct illuminance.
function buildPatches(context, size) {
  const { width, depth, height } = context.scene.room;
  const patches = [];
  const add = (origin, u, v, normal, reflectance) => {
    const nu = Math.max(1, Math.round(Math.hypot(u.x, u.y, u.z) / size));
    const nv = Math.max(1, Math.round(Math.hypot(v.x, v.y, v.z) / size));
    const area = Math.hypot(u.x, u.y, u.z) * Math.hypot(v.x, v.y, v.z) / (nu * nv);
    for (let i = 0; i < nu; i += 1) {
      for (let j = 0; j < nv; j += 1) {
        const point = {
          x: origin.x + u.x * (i + 0.5) / nu + v.x * (j + 0.5) / nv,
          y: origin.y + u.y * (i + 0.5) / nu + v.y * (j + 0.5) / nv,
          z: origin.z + u.z * (i + 0.5) / nu + v.z * (j + 0.5) / nv,
        };
        // Nudge off the surface so a patch sees the room, not itself.
        const probe = { x: point.x + normal.x * 0.02, y: point.y + normal.y * 0.02, z: point.z + normal.z * 0.02 };
        patches.push({ point: probe, normal, area, reflectance, exitance: 0 });
      }
    }
  };
  add({ x: 0, y: 0, z: 0 }, { x: width, y: 0, z: 0 }, { x: 0, y: 0, z: depth }, UP, FLOOR_REFLECTANCE);
  add({ x: 0, y: height, z: 0 }, { x: width, y: 0, z: 0 }, { x: 0, y: 0, z: depth }, { x: 0, y: -1, z: 0 }, CEILING_REFLECTANCE);
  add({ x: 0, y: 0, z: 0 }, { x: width, y: 0, z: 0 }, { x: 0, y: height, z: 0 }, { x: 0, y: 0, z: 1 }, WALL_REFLECTANCE);
  add({ x: 0, y: 0, z: depth }, { x: width, y: 0, z: 0 }, { x: 0, y: height, z: 0 }, { x: 0, y: 0, z: -1 }, WALL_REFLECTANCE);
  add({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: depth }, { x: 0, y: height, z: 0 }, { x: 1, y: 0, z: 0 }, WALL_REFLECTANCE);
  add({ x: width, y: 0, z: 0 }, { x: 0, y: 0, z: depth }, { x: 0, y: height, z: 0 }, { x: -1, y: 0, z: 0 }, WALL_REFLECTANCE);

  for (const patch of patches) patch.exitance = patch.reflectance * directLux(context, patch.point, patch.normal);
  // Drop the dark patches: with a single lamp most of the six surfaces are unlit,
  // and skipping them keeps the per-cell gather cheap enough for a live preview.
  return patches.filter((patch) => patch.exitance > 1e-6);
}

// First bounce gathered from every lit patch, scaled by the geometric series
// 1 / (1 − ρ̄) for the bounces after it.
export function indirectLux(context, point, normal = UP) {
  let lux = 0;
  for (const patch of context.patches) {
    const dx = patch.point.x - point.x;
    const dy = patch.point.y - point.y;
    const dz = patch.point.z - point.z;
    const distanceSquared = Math.max(0.09, dx * dx + dy * dy + dz * dz);
    const distance = Math.sqrt(distanceSquared);
    const atPoint = (dx * normal.x + dy * normal.y + dz * normal.z) / distance;
    const atPatch = -(dx * patch.normal.x + dy * patch.normal.y + dz * patch.normal.z) / distance;
    if (atPoint <= 0 || atPatch <= 0) continue;
    lux += patch.exitance * patch.area * atPoint * atPatch / (Math.PI * distanceSquared);
  }
  return lux / (1 - context.reflectance * 0.6);
}

/** Total illuminance (lux) at a point facing `normal` (default: a horizontal plane). */
export function luxAt(context, point, normal = UP) {
  return directLux(context, point, normal) + indirectLux(context, point, normal);
}

/**
 * Build the radiosity context for a scene and a daylight state. Exported so the
 * real-time preview can drive its window lights and sky fill from the same
 * model the estimator uses.
 */
export function lightContext(scene, daylight, { patchSize = 0.8 } = {}) {
  if (!scene?.room || !Array.isArray(scene.objects)) {
    throw new TypeError('A room scene with a room and object list is required.');
  }
  const lamps = scene.objects
    .filter((object) => LAMP_LUMENS[object.model] && object.enabled !== false)
    .map((object) => ({ object, lumens: lampLumens(object), bulb: lampBulb(object) }));

  const windows = scene.objects
    .filter(isOpeningObject)
    .map((object) => windowData(object, scene.room))
    .filter(Boolean);

  const sun = daylight?.sun ?? { direction: { x: 0, y: -1, z: 0 }, altitude: -10, daylight: 0 };
  const toSun = sun.direction ? { ...sun.direction } : null;
  const altitude = sun.altitude ?? -10;
  const sinAltitude = Math.max(0, Math.sin((altitude * Math.PI) / 180));
  // Clear-sky direct normal ≈ 90 klx, diffuse horizontal ≈ 4–18 klx; the sky
  // luminance that lights a window is that divided by π.
  const directNormal = altitude > 0 ? 90000 * Math.min(1, sinAltitude * 3) : 0;
  const skyHorizontal = altitude > -3 ? 4000 + 14000 * sinAltitude : 0;
  const skyLuminance = skyHorizontal / Math.PI;

  const context = {
    scene,
    lamps,
    windows,
    toSun,
    directNormal,
    skyLuminance,
    boxes: opaqueBoxes(scene),
    reflectance: (FLOOR_REFLECTANCE * scene.room.width * scene.room.depth * 2
      + WALL_REFLECTANCE * 2 * (scene.room.width + scene.room.depth) * scene.room.height)
      / (2 * scene.room.width * scene.room.depth + 2 * (scene.room.width + scene.room.depth) * scene.room.height),
    patches: [],
  };
  context.patches = buildPatches(context, patchSize);
  return context;
}

// ─── Field estimate (retained grid interface) ─────────────────────────────
// Light mode's field layer still asks for a normalized 0–1 volume. The values
// now come from radiosity lux sampled at each cell centre on a horizontal work
// plane, normalized against the strongest cell so the volume keeps its shape.

const DEFAULTS = Object.freeze({ cellSize: DEFAULT_CELL_SIZE, ambientLevel: 0.06, patchSize: 0.8 });

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
  const lamps = scene.objects.filter((object) => LAMP_LUMENS[object.model]);
  if (lamps.length > 64) throw new RangeError('A room can contain at most 64 simulated light sources.');
  return settings;
}

function createLightState(scene, options) {
  const settings = validate(scene, options);
  const grid = createSimulationGrid(scene.room, settings.cellSize);
  const light = new Float32Array(grid.nx * grid.ny * grid.nz).fill(settings.ambientLevel);
  const daylight = options.daylight ?? describeDaylight({
    scene,
    timeMinutes: options.timeMinutes ?? DEFAULT_TIME_MINUTES,
  });
  const context = lightContext(scene, daylight, { patchSize: settings.patchSize });
  return {
    scene,
    settings,
    grid,
    light,
    context,
    maximum: 0,
    total: 0,
  };
}

function calculateLightCell(state, index) {
  const { grid, light, context } = state;
  const plane = grid.nx * grid.nz;
  const j = Math.floor(index / plane);
  const k = Math.floor(index / grid.nx) % grid.nz;
  const i = index % grid.nx;
  const point = { x: (i + 0.5) * grid.dx, y: (j + 0.5) * grid.dy, z: (k + 0.5) * grid.dz };
  const lux = luxAt(context, point, UP);
  light[index] = lux;
  state.total += lux;
  state.maximum = Math.max(state.maximum, lux);
}

// Normalize the lux volume to 0–1 above an ambient floor, preserving the old
// field-layer contract. An unlit room keeps every cell at the ambient level.
function normalize(state) {
  const { light, settings, maximum, total } = state;
  const span = 1 - settings.ambientLevel;
  if (maximum > 1e-6) {
    for (let index = 0; index < light.length; index += 1) {
      light[index] = settings.ambientLevel + span * (light[index] / maximum);
    }
  } else {
    light.fill(settings.ambientLevel);
  }
  return {
    meanLevel: maximum > 1e-6
      ? settings.ambientLevel + span * (total / light.length / maximum)
      : settings.ambientLevel,
    maxLevel: maximum > 1e-6 ? 1 : settings.ambientLevel,
  };
}

function finishLightEstimate(state, stats) {
  const { scene, settings, grid, light } = state;
  return {
    grid,
    fields: { light, solid: buildSolidMask(scene, grid) },
    backend: 'cpu-light',
    ambientLevel: settings.ambientLevel,
    assumptions: Object.freeze({
      model: 'radiosity: direct lamps, sun/sky through apertures, plus inter-reflection',
      units: 'normalized 0–1 intensity derived from relative lux; not calibrated photometry',
      sources: 'point lamps (inverse-square, cosine law), direct sun and diffuse sky through openings',
      occlusion: 'opaque box shadows from room objects; openings are not occluders',
      maximumGridCells: MAX_SIMULATION_CELLS,
    }),
    stats: {
      sourceCount: state.context.lamps.length,
      meanLevel: Number(stats.meanLevel.toFixed(3)),
      maxLevel: Number(stats.maxLevel.toFixed(3)),
    },
  };
}

export function estimateRoomLight(scene, options = {}) {
  const state = createLightState(scene, options);
  for (let index = 0; index < state.light.length; index += 1) calculateLightCell(state, index);
  return finishLightEstimate(state, normalize(state));
}

export async function estimateRoomLightAsync(scene, options = {}, { isCancelled = () => false, chunkSize = 2048 } = {}) {
  const state = createLightState(scene, options);
  for (let start = 0; start < state.light.length; start += chunkSize) {
    if (isCancelled()) return null;
    const end = Math.min(start + chunkSize, state.light.length);
    for (let index = start; index < end; index += 1) calculateLightCell(state, index);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return isCancelled() ? null : finishLightEstimate(state, normalize(state));
}
