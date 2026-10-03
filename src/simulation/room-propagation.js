import { MODEL_PRESETS, floorContains, insidePartition, isWallItem, objectMaterial, objectProps, openArea, partitionsCrossed, rotationMatrixXYZ, windowCovering } from '../model/room-scene.js';
import { bearingToRoomVector, sunPosition } from '../model/environment.js';
import { MATERIALS, SURFACE_MATERIALS, sceneSurfaces } from '../model/materials.js';

// Fast, closed-form estimates that run on the main thread so they can follow a drag live.
// WiFi: log-distance path loss plus per-object material attenuation along the direct ray.
// Sound: direct field with barrier loss plus a Sabine diffuse (reverberant) field.

export const WIFI_BANDS = Object.freeze([
  { min: -50, label: 'Excellent', hint: '4K streaming, gaming' },
  { min: -60, label: 'Very good', hint: 'video calls' },
  { min: -67, label: 'Good', hint: 'reliable browsing and calls' },
  { min: -75, label: 'Fair', hint: 'slow, may drop' },
  { min: -Infinity, label: 'Weak', hint: 'expect drop-outs' },
]);

export const SOUND_BANDS = Object.freeze([
  { min: 85, label: 'Loud', hint: 'hearing fatigue with long exposure' },
  { min: 70, label: 'Lively', hint: 'music, raised voices' },
  { min: 55, label: 'Conversation', hint: 'normal speech' },
  { min: 40, label: 'Quiet', hint: 'library, background' },
  { min: -Infinity, label: 'Very quiet', hint: 'bedroom at night' },
]);

export const LIGHT_BANDS = Object.freeze([
  { min: 2000, label: 'Bright daylight', hint: 'direct sun — glare on screens' },
  { min: 500, label: 'Desk work', hint: 'reading, drawing, detailed tasks' },
  { min: 300, label: 'Reading', hint: 'comfortable for most tasks' },
  { min: 100, label: 'Living', hint: 'relaxing, walking around' },
  { min: -Infinity, label: 'Dim', hint: 'too dark to read' },
]);

export const bandFor = (bands, value) => bands.find((band) => value >= band.min);

// ─── Light (lux) ──────────────────────────────────────────────────────────
// Direct light from lamps (isotropic point sources, inverse-square, cosine law,
// blocked by opaque objects), direct sun through window openings, diffuse sky
// light through windows, plus the standard inter-reflected component
// E = Φ·ρ / (A·(1 − ρ)) from the room's average surface reflectance.
export const LAMP_LUMENS = Object.freeze({ lamp: 800, deskLamp: 450, ceilingLight: 1600 });

function windowRect(window, room) {
  const halfWidth = window.dimensions.width / 2;
  const bottom = window.position.y;
  const top = bottom + window.dimensions.height;
  const alongX = window.wall === 'back' || window.wall === 'front';
  const plane = window.wall === 'front' ? 0 : window.wall === 'back' ? room.depth : window.wall === 'left' ? 0 : room.width;
  const center = alongX ? window.position.x : window.position.z;
  return { alongX, plane, lo: center - halfWidth, hi: center + halfWidth, bottom, top };
}

// Does the ray from `point` along `direction` leave the room through this window?
function rayThroughWindow(point, direction, rect) {
  const along = rect.alongX ? direction.z : direction.x;
  if (Math.abs(along) < 1e-6) return false;
  const t = ((rect.plane) - (rect.alongX ? point.z : point.x)) / along;
  if (t <= 0) return false;
  const y = point.y + direction.y * t;
  const s = (rect.alongX ? point.x + direction.x * t : point.z + direction.z * t);
  return y >= rect.bottom && y <= rect.top && s >= rect.lo && s <= rect.hi;
}

function opaqueBoxes(scene) {
  return obstacleBoxes(scene, null).filter((box) => !LAMP_LUMENS[box.object.model] && objectMaterial(box.object) !== 'glass');
}

const UP = Object.freeze({ x: 0, y: 1, z: 0 });
const GLASS = 0.7;
// Glass passes 70%; the open part of the frame passes everything.
const windowTransmission = (window) => {
  const frame = window.dimensions.width * window.dimensions.height;
  const free = Math.min(1, openArea(window) / frame);
  return (window.model === 'door' ? free : GLASS + (1 - GLASS) * free) * windowCovering(window).light;
};

function lampBulb(lamp) {
  return lamp.model === 'ceilingLight'
    ? { x: lamp.position.x, y: lamp.position.y - 0.02, z: lamp.position.z }
    : { x: lamp.position.x, y: lamp.position.y + lamp.dimensions.height * 0.72, z: lamp.position.z };
}

// Direct light only (lamps, sun through glass, sky through windows) on a surface
// with the given normal.
function directLux(context, point, normal) {
  const { scene, lamps, windows, toSun, boxes } = context;
  let lux = 0;
  for (const lamp of lamps) {
    const bulb = lampBulb(lamp);
    const dx = bulb.x - point.x;
    const dy = bulb.y - point.y;
    const dz = bulb.z - point.z;
    const distanceSquared = Math.max(0.04, dx * dx + dy * dy + dz * dz);
    const distance = Math.sqrt(distanceSquared);
    const cosine = (dx * normal.x + dy * normal.y + dz * normal.z) / distance;
    if (cosine <= 0) continue;
    if (boxes.some((box) => box.object.id !== lamp.id && segmentHitsBox(point, bulb, box))) continue;
    if (partitionsCrossed(scene, point, bulb).length) continue;
    const intensity = (objectProps(lamp).lumens ?? LAMP_LUMENS[lamp.model]) / (4 * Math.PI) * (lamp.model === 'ceilingLight' ? 1.6 : 1);
    lux += intensity * cosine / distanceSquared;
  }
  for (const window of windows) {
    const rect = windowRect(window, scene.room);
    const transmit = windowTransmission(window);
    if (transmit <= 0) continue;
    // Direct sun through the opening
    if (toSun && toSun.y > 0 && rayThroughWindow(point, toSun, rect)) {
      const cosine = toSun.x * normal.x + toSun.y * normal.y + toSun.z * normal.z;
      const far = { x: point.x + toSun.x * 20, y: point.y + toSun.y * 20, z: point.z + toSun.z * 20 };
      if (cosine > 0 && !boxes.some((box) => segmentHitsBox(point, far, box)) && !partitionsCrossed(scene, point, far).length) lux += context.directNormal * cosine * transmit;
    }
    // Sky seen through the window: the window as a diffuse emitter (form factor).
    const center = rect.alongX
      ? { x: window.position.x, y: (rect.bottom + rect.top) / 2, z: rect.plane }
      : { x: rect.plane, y: (rect.bottom + rect.top) / 2, z: window.position.z };
    const vx = center.x - point.x;
    const vy = center.y - point.y;
    const vz = center.z - point.z;
    const distanceSquared = Math.max(0.25, vx * vx + vy * vy + vz * vz);
    const distance = Math.sqrt(distanceSquared);
    const atWindow = Math.abs(rect.alongX ? vz : vx) / distance;
    const atPoint = (vx * normal.x + vy * normal.y + vz * normal.z) / distance;
    if (atPoint <= 0 || boxes.some((box) => segmentHitsBox(point, center, box)) || partitionsCrossed(scene, point, center).length) continue;
    // The sky's luminance is highest overhead: a window seen from below looks brighter.
    const skyLuminance = context.skyLuminance * (0.6 + 0.4 * Math.max(0, vy / distance + 0.3));
    lux += skyLuminance * transmit * window.dimensions.width * window.dimensions.height * atWindow * atPoint / distanceSquared;
  }
  return lux;
}

// Radiosity patches on the floor, ceiling and four walls (~0.45 m). Each gets its
// direct light, then re-emits ρ·E as a diffuse (Lambertian) surface.
function buildPatches(context, size = 0.45) {
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
        if (!floorContains(context.scene.room, point.x, point.z, -0.01)) continue;
        // Nudge off the surface so the patch sees the room, not itself.
        const probe = { x: point.x + normal.x * 0.02, y: point.y + normal.y * 0.02, z: point.z + normal.z * 0.02 };
        patches.push({ point: probe, normal, area, reflectance, exitance: 0 });
      }
    }
  };
  add({ x: 0, y: 0, z: 0 }, { x: width, y: 0, z: 0 }, { x: 0, y: 0, z: depth }, UP, context.floorReflectance);
  add({ x: 0, y: height, z: 0 }, { x: width, y: 0, z: 0 }, { x: 0, y: 0, z: depth }, { x: 0, y: -1, z: 0 }, 0.8);
  add({ x: 0, y: 0, z: 0 }, { x: width, y: 0, z: 0 }, { x: 0, y: height, z: 0 }, { x: 0, y: 0, z: 1 }, context.wallReflectance);
  add({ x: 0, y: 0, z: depth }, { x: width, y: 0, z: 0 }, { x: 0, y: height, z: 0 }, { x: 0, y: 0, z: -1 }, context.wallReflectance);
  add({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: depth }, { x: 0, y: height, z: 0 }, { x: 1, y: 0, z: 0 }, context.wallReflectance);
  add({ x: width, y: 0, z: 0 }, { x: 0, y: 0, z: depth }, { x: 0, y: height, z: 0 }, { x: -1, y: 0, z: 0 }, context.wallReflectance);
  for (const patch of patches) patch.exitance = patch.reflectance * directLux(context, patch.point, patch.normal);
  return patches;
}

// First bounce gathered from every patch (point-to-patch form factor), scaled by
// the geometric series 1 / (1 − ρ̄) for the bounces after it.
function bounceLux(context, point, normal) {
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

export function lightContext(scene, environment, cloudCover = 20) {
  const surfaces = sceneSurfaces(scene);
  const floor = SURFACE_MATERIALS.floor[surfaces.floor] ?? SURFACE_MATERIALS.floor.wood;
  const walls = SURFACE_MATERIALS.walls[surfaces.walls] ?? SURFACE_MATERIALS.walls.paint;
  const { width, depth, height } = scene.room;
  const floorArea = width * depth;
  const wallArea = 2 * (width + depth) * height;
  const area = 2 * floorArea + wallArea;
  const reflectance = (floorArea * floor.reflectance + floorArea * 0.8 + wallArea * walls.reflectance) / area;
  const lamps = scene.objects.filter((object) => LAMP_LUMENS[object.model] && object.props?.on !== 0);
  const windows = scene.objects.filter((object) => object.model === 'window' || (object.model === 'door' && object.open));
  const sun = environment ? sunPosition(environment) : { altitude: -10, azimuth: 0 };
  const clear = 1 - Math.min(1, Math.max(0, cloudCover / 100)) * 0.75;
  const toSun = environment ? bearingToRoomVector(sun.azimuth, environment.backWallBearing, sun.altitude) : null;
  const sunAltitude = Math.max(0, Math.sin(sun.altitude * Math.PI / 180));
  // Clear-sky direct normal ≈ 90 klx; diffuse sky horizontal ≈ 5–20 klx, i.e. a
  // sky luminance of E/π.
  const directNormal = sun.altitude > 0 ? 90000 * clear * Math.min(1, sunAltitude * 3) : 0;
  const skyHorizontal = sun.altitude > -3 ? (4000 + 14000 * sunAltitude) * (0.6 + 0.4 * (1 - clear)) : 0;
  const context = {
    scene, lamps, windows, toSun, directNormal, skyHorizontal, sun,
    skyLuminance: skyHorizontal / Math.PI,
    boxes: opaqueBoxes(scene),
    reflectance,
    floorReflectance: floor.reflectance,
    wallReflectance: walls.reflectance,
  };
  context.patches = buildPatches(context);
  // Headline number for the UI: bounce light on the floor at the room's centre.
  context.indirect = bounceLux(context, { x: width / 2, y: 0.75, z: depth / 2 }, UP);
  return context;
}

// Total illuminance (lux) on a surface at `point` facing `normal` (default: a
// horizontal work plane): direct light plus radiosity bounce.
export function luxAt(context, point, normal = UP) {
  return directLux(context, point, normal) + bounceLux(context, point, normal);
}

// ITU-R P.1238 indoor site-general model: L = 20·log10(f) + N·log10(d) + Lf − 28,
// with f in MHz, d in metres and N the distance power-loss coefficient
// (residential ≈ 28 at 2.4 GHz, ≈ 30 at 5 GHz). Obstacle penetration losses are
// added along the direct path; 5 GHz penetrates materials ~1.3× worse.
export const WIFI_BANDS_GHZ = Object.freeze({
  2.4: { frequency: 2437, coefficient: 28, materialFactor: 1 },
  5: { frequency: 5200, coefficient: 30, materialFactor: 1.3 },
});
const ANTENNA_GAIN_DBI = 2;
export function itu1238Loss(distance, band = 5) {
  const spec = WIFI_BANDS_GHZ[band] ?? WIFI_BANDS_GHZ[5];
  return 20 * Math.log10(spec.frequency) + spec.coefficient * Math.log10(Math.max(1, distance)) - 28;
}

function obstacleBoxes(scene, excludeId) {
  return scene.objects
    .filter((object) => object.id !== excludeId && !isWallItem(object))
    .map((object) => ({
      object,
      material: MATERIALS[objectMaterial(object)] ?? MATERIALS.wood,
      center: { x: object.position.x, y: object.position.y + object.dimensions.height / 2, z: object.position.z },
      half: { x: object.dimensions.width / 2, y: object.dimensions.height / 2, z: object.dimensions.depth / 2 },
      matrix: rotationMatrixXYZ(object.rotation),
    }));
}

// Slab test in the box's local frame; returns true when the segment a→b crosses the box.
function segmentHitsBox(a, b, box) {
  const toLocal = (point) => {
    const x = point.x - box.center.x;
    const y = point.y - box.center.y;
    const z = point.z - box.center.z;
    const m = box.matrix;
    return [m[0][0] * x + m[1][0] * y + m[2][0] * z, m[0][1] * x + m[1][1] * y + m[2][1] * z, m[0][2] * x + m[1][2] * y + m[2][2] * z];
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

function emitterPoint(object, heightFraction = 0.8) {
  return { x: object.position.x, y: object.position.y + object.dimensions.height * heightFraction, z: object.position.z };
}

function buildPlane(room, height, cellSize) {
  const nx = Math.max(2, Math.round(room.width / cellSize));
  const nz = Math.max(2, Math.round(room.depth / cellSize));
  return { nx, nz, dx: room.width / nx, dz: room.depth / nz, height: Math.min(height, room.height - 0.05) };
}

function blockingLoss(source, target, boxes, key, scene = null) {
  let loss = 0;
  for (const box of boxes) if (segmentHitsBox(source, target, box)) loss += box.material[key];
  if (scene) for (const wall of partitionsCrossed(scene, source, target)) loss += wall[key] ?? 0;
  return loss;
}

export function wifiAt(scene, point, boxes = null) {
  const routers = scene.objects.filter((object) => object.model === 'router');
  if (!routers.length) return null;
  let best = -Infinity;
  for (const router of routers) {
    const source = emitterPoint(router, 0.9);
    const distance = Math.hypot(point.x - source.x, point.y - source.y, point.z - source.z);
    const { power, band = 5 } = objectProps(router);
    // Within 1 m the model is flat by definition; blend in free-space falloff so the
    // map still peaks at the router.
    const near = distance < 1 ? 20 * Math.log10(Math.max(0.25, distance)) : 0;
    const loss = itu1238Loss(distance, band) + near
      + blockingLoss(source, point, boxes ?? obstacleBoxes(scene, router.id).filter((box) => box.object.id !== router.id), 'wifiLossDb', scene) * (WIFI_BANDS_GHZ[band]?.materialFactor ?? 1);
    best = Math.max(best, power + ANTENNA_GAIN_DBI - loss);
  }
  return best;
}

export function roomAcoustics(scene) {
  const { width, depth, height } = scene.room;
  const surfaces = sceneSurfaces(scene);
  const floor = SURFACE_MATERIALS.floor[surfaces.floor] ?? SURFACE_MATERIALS.floor.wood;
  const walls = SURFACE_MATERIALS.walls[surfaces.walls] ?? SURFACE_MATERIALS.walls.paint;
  const wallArea = 2 * (width + depth) * height;
  let openingArea = 0;
  let absorption = width * depth * (floor.absorption + 0.03); // floor + plaster ceiling
  for (const object of scene.objects) {
    const { width: w, height: h, depth: d } = object.dimensions;
    if (isWallItem(object)) {
      const area = w * h;
      openingArea += area;
      // An open area absorbs everything (the sound leaves); glass and doors reflect.
      const free = openArea(object);
      absorption += free + (area - free) * Math.min(1, (object.model === 'window' ? 0.04 : 0.1) + windowCovering(object).absorption);
      continue;
    }
    const exposed = w * d + 2 * (w * h + d * h); // top + sides; the base sits on the floor
    absorption += exposed * (MATERIALS[objectMaterial(object)] ?? MATERIALS.wood).absorption;
  }
  absorption += Math.max(0, wallArea - openingArea) * walls.absorption;
  const volume = width * depth * height;
  const totalArea = 2 * (width * depth + width * height + depth * height);
  const meanAbsorption = Math.min(0.95, absorption / totalArea);
  // Eyring's formula; it reduces to Sabine's for small ᾱ and stays accurate in
  // well-furnished rooms where Sabine overestimates the echo.
  const eyringArea = -totalArea * Math.log(1 - meanAbsorption);
  return {
    volume,
    absorption,
    meanAbsorption,
    rt60: 0.161 * volume / Math.max(0.1, eyringArea),
    rt60Sabine: 0.161 * volume / Math.max(0.1, absorption),
    formula: 'Eyring',
    roomConstant: absorption / (1 - meanAbsorption),
  };
}

// First-order image sources (Allen & Berkley): the speaker mirrored in each of
// the six room surfaces. Each reflection arrives with (1 − α) of the energy.
export function imageSources(scene, source) {
  const { width, depth, height } = scene.room;
  const surfaces = sceneSurfaces(scene);
  const floor = SURFACE_MATERIALS.floor[surfaces.floor] ?? SURFACE_MATERIALS.floor.wood;
  const walls = SURFACE_MATERIALS.walls[surfaces.walls] ?? SURFACE_MATERIALS.walls.paint;
  return [
    { x: -source.x, y: source.y, z: source.z, reflect: 1 - walls.absorption },
    { x: 2 * width - source.x, y: source.y, z: source.z, reflect: 1 - walls.absorption },
    { x: source.x, y: source.y, z: -source.z, reflect: 1 - walls.absorption },
    { x: source.x, y: source.y, z: 2 * depth - source.z, reflect: 1 - walls.absorption },
    { x: source.x, y: -source.y, z: source.z, reflect: 1 - floor.absorption },
    { x: source.x, y: 2 * height - source.y, z: source.z, reflect: 0.97 },
  ];
}

export function soundAt(scene, point, acoustics = roomAcoustics(scene), boxes = null) {
  const speakers = scene.objects.filter((object) => object.model === 'speaker');
  if (!speakers.length) return null;
  let energy = 0;
  for (const speaker of speakers) {
    const source = emitterPoint(speaker, 0.6);
    const distance = Math.max(0.15, Math.hypot(point.x - source.x, point.y - source.y, point.z - source.z));
    // Level is the SPL 1 m in front; Q = 2 for a speaker standing on a surface.
    const powerLevel = objectProps(speaker).level + 8;
    const barrier = blockingLoss(source, point, boxes ?? obstacleBoxes(scene, speaker.id), 'soundBlockDb', scene);
    const direct = (2 / (4 * Math.PI * distance * distance)) * 10 ** (-barrier / 10);
    // Early reflections off walls, floor and ceiling, then the diffuse tail.
    let early = 0;
    for (const image of imageSources(scene, source)) {
      const reflected = Math.max(0.3, Math.hypot(point.x - image.x, point.y - image.y, point.z - image.z));
      early += image.reflect * 2 / (4 * Math.PI * reflected * reflected);
    }
    const reverberant = 4 / acoustics.roomConstant;
    energy += 10 ** (powerLevel / 10) * (direct + early + reverberant * 0.85);
  }
  return 10 * Math.log10(energy);
}

const PLANE_HEIGHTS = Object.freeze({ wifi: 1.0, sound: 1.2, light: 0.75 });
const SOURCE_MODELS = Object.freeze({ wifi: ['router'], sound: ['speaker'], light: null });

export function computePlaneField(scene, mode, { height = PLANE_HEIGHTS[mode], cellSize = 0.08, environment = null, cloudCover } = {}) {
  const plane = buildPlane(scene.room, height, cellSize);
  const values = new Float32Array(plane.nx * plane.nz);
  const acoustics = mode === 'sound' ? roomAcoustics(scene) : null;
  const sources = SOURCE_MODELS[mode]
    ? scene.objects.filter((object) => SOURCE_MODELS[mode].includes(object.model))
    : scene.objects.filter((object) => LAMP_LUMENS[object.model] || object.model === 'window');
  // Light always has a context (a room with no lamps or windows is simply dark).
  if (!sources.length && mode !== 'light') return { ...plane, mode, values: null, acoustics, empty: true, sources: [] };
  const sourceIds = new Set(sources.map((object) => object.id));
  const boxes = obstacleBoxes(scene, null).filter((box) => !sourceIds.has(box.object.id));
  const light = mode === 'light' ? lightContext(scene, environment, cloudCover) : null;
  let min = Infinity;
  let max = -Infinity;
  for (let k = 0; k < plane.nz; k += 1) {
    for (let i = 0; i < plane.nx; i += 1) {
      const point = { x: (i + 0.5) * plane.dx, y: plane.height, z: (k + 0.5) * plane.dz };
      if (!floorContains(scene.room, point.x, point.z)) {
        values[k * plane.nx + i] = Number.NaN;
        continue;
      }
      const value = mode === 'wifi' ? wifiAt(scene, point, boxes)
        : mode === 'sound' ? soundAt(scene, point, acoustics, boxes)
          : luxAt(light, point);
      values[k * plane.nx + i] = value;
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
  }
  // Colours stretch over this room's range so the falloff is visible; the legend
  // and probe give absolute values and what they mean.
  return {
    ...plane, mode, values, min, max, acoustics, light,
    logScale: mode === 'light',
    unit: mode === 'wifi' ? 'dBm' : mode === 'sound' ? 'dB' : 'lux',
    sources: sources.filter((object) => !isWallItem(object)).map((object) => ({ x: object.position.x, z: object.position.z })),
  };
}

export function sampleListeningSpots(scene, mode, light = null) {
  const spots = scene.objects.filter((object) => ['bed', 'desk', 'sofa', 'chair', 'table'].includes(object.model));
  const acoustics = mode === 'sound' ? roomAcoustics(scene) : null;
  return spots.map((object) => {
    const y = mode === 'light' ? Math.min(scene.room.height - 0.1, object.position.y + object.dimensions.height + 0.01) : PLANE_HEIGHTS[mode];
    const point = { x: object.position.x, y, z: object.position.z };
    const value = mode === 'wifi' ? wifiAt(scene, point) : mode === 'sound' ? soundAt(scene, point, acoustics) : luxAt(light, point);
    return { object, value, label: MODEL_PRESETS[object.model].label };
  }).filter((spot) => spot.value !== null);
}

// 3D version for the volumetric view: every cell gets the WiFi or sound level,
// normalised over the room, with obstacles and out-of-floor cells marked solid.
export function computeVolumeField(scene, mode, { cellSize = 0.12 } = {}) {
  const { width, depth, height } = scene.room;
  const nx = Math.max(2, Math.round(width / cellSize));
  const ny = Math.max(2, Math.round(height / cellSize));
  const nz = Math.max(2, Math.round(depth / cellSize));
  const grid = { nx, ny, nz, dx: width / nx, dy: height / ny, dz: depth / nz, width, height, depth, cellSize };
  const sourceModel = mode === 'wifi' ? 'router' : 'speaker';
  const sources = scene.objects.filter((object) => object.model === sourceModel);
  if (!sources.length) return null;
  const sourceIds = new Set(sources.map((object) => object.id));
  const boxes = obstacleBoxes(scene, null).filter((box) => !sourceIds.has(box.object.id));
  const acoustics = mode === 'sound' ? roomAcoustics(scene) : null;
  const count = nx * ny * nz;
  const raw = new Float32Array(count);
  const solid = new Uint8Array(count);
  let min = Infinity;
  let max = -Infinity;
  const inside = (box, point) => {
    const x = point.x - box.center.x;
    const y = point.y - box.center.y;
    const z = point.z - box.center.z;
    const m = box.matrix;
    return Math.abs(m[0][0] * x + m[1][0] * y + m[2][0] * z) <= box.half.x
      && Math.abs(m[0][1] * x + m[1][1] * y + m[2][1] * z) <= box.half.y
      && Math.abs(m[0][2] * x + m[1][2] * y + m[2][2] * z) <= box.half.z;
  };
  for (let j = 0; j < ny; j += 1) {
    for (let k = 0; k < nz; k += 1) {
      for (let i = 0; i < nx; i += 1) {
        const index = (j * nz + k) * nx + i;
        const point = { x: (i + 0.5) * grid.dx, y: (j + 0.5) * grid.dy, z: (k + 0.5) * grid.dz };
        if (!floorContains(scene.room, point.x, point.z) || insidePartition(scene, point.x, point.z, point.y) || boxes.some((box) => inside(box, point))) {
          solid[index] = 1;
          continue;
        }
        const value = mode === 'wifi' ? wifiAt(scene, point, boxes) : soundAt(scene, point, acoustics, boxes);
        raw[index] = value;
        if (value < min) min = value;
        if (value > max) max = value;
      }
    }
  }
  const signal = new Float32Array(count);
  const span = Math.max(1e-6, max - min);
  for (let index = 0; index < count; index += 1) signal[index] = solid[index] ? 0 : (raw[index] - min) / span;
  return {
    grid,
    fields: { signal, raw, solid },
    mode,
    min,
    max,
    unit: mode === 'wifi' ? 'dBm' : 'dB',
    backend: 'analytic',
    stats: { maxSpeed: 0, maxLevel: max },
    // Sound also draws its wall reflections as image sources, so the waves bounce.
    sources: sources.flatMap((object) => {
      const point = emitterPoint(object, mode === 'wifi' ? 0.9 : 0.6);
      if (mode !== 'sound') return [{ ...point, gain: 1 }];
      return [{ ...point, gain: 1 }, ...imageSources(scene, point).filter((image) => image.y > 0).slice(0, 5).map((image) => ({ x: image.x, y: image.y, z: image.z, gain: image.reflect * 0.6 }))];
    }).slice(0, 8),
  };
}

// 3D illuminance field for the Light lens volume. Values are lux; the signal is
// log-scaled (10 lux → 0, the room's brightest point → 1) because the eye and
// the lighting standards both work on ratios.
export function computeLightVolume(scene, environment, { cellSize = 0.15, cloudCover = 20 } = {}) {
  const { width, depth, height } = scene.room;
  const nx = Math.max(2, Math.round(width / cellSize));
  const ny = Math.max(2, Math.round(height / cellSize));
  const nz = Math.max(2, Math.round(depth / cellSize));
  const grid = { nx, ny, nz, dx: width / nx, dy: height / ny, dz: depth / nz, width, height, depth, cellSize };
  const context = lightContext(scene, environment, cloudCover);
  const count = nx * ny * nz;
  const raw = new Float32Array(count);
  const solid = new Uint8Array(count);
  const inside = (box, point) => {
    const x = point.x - box.center.x;
    const y = point.y - box.center.y;
    const z = point.z - box.center.z;
    const m = box.matrix;
    return Math.abs(m[0][0] * x + m[1][0] * y + m[2][0] * z) <= box.half.x
      && Math.abs(m[0][1] * x + m[1][1] * y + m[2][1] * z) <= box.half.y
      && Math.abs(m[0][2] * x + m[1][2] * y + m[2][2] * z) <= box.half.z;
  };
  let max = 10;
  for (let j = 0; j < ny; j += 1) {
    for (let k = 0; k < nz; k += 1) {
      for (let i = 0; i < nx; i += 1) {
        const index = (j * nz + k) * nx + i;
        const point = { x: (i + 0.5) * grid.dx, y: (j + 0.5) * grid.dy, z: (k + 0.5) * grid.dz };
        if (!floorContains(scene.room, point.x, point.z) || context.boxes.some((box) => inside(box, point))) {
          solid[index] = 1;
          continue;
        }
        const value = luxAt(context, point);
        raw[index] = value;
        if (value > max) max = value;
      }
    }
  }
  // Contrast over this room's own range (5th–99th percentile, log scale), so a
  // sunny afternoon still shows where the light pools and where it falls off.
  const lit = [];
  for (let index = 0; index < count; index += 7) if (!solid[index]) lit.push(Math.log10(Math.max(1, raw[index])));
  lit.sort((a, b) => a - b);
  const low = lit[Math.floor(lit.length * 0.05)] ?? 1;
  const high = Math.max(low + 0.3, lit[Math.floor(lit.length * 0.99)] ?? Math.log10(max));
  const signal = new Float32Array(count);
  for (let index = 0; index < count; index += 1) {
    signal[index] = solid[index] ? 0 : Math.min(1, Math.max(0, (Math.log10(Math.max(1, raw[index])) - low) / (high - low)));
  }
  return {
    grid, fields: { signal, raw, solid }, mode: 'lux', min: 10 ** low, max: 10 ** high, unit: 'lux', backend: 'analytic', stats: { maxSpeed: 0, maxLevel: max }, sources: [], light: context,
  };
}

// Level along the straight line from a source to a point: shows the falloff and
// the dips behind furniture. `sample(point)` returns the field value.
export function profileAlong(from, to, sample, steps = 48) {
  const values = [];
  const length = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    const point = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, z: from.z + (to.z - from.z) * t };
    values.push({ distance: length * t, value: sample(point) });
  }
  return { length, values };
}
