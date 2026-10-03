import { solarPosition, dayEvents, SITE, DEFAULT_DATE, formatClock } from './sun-position.js';
import { isOpeningObject } from '../model/openings.js';

// Daylight state for the light preview, driven by the real solar position at a
// fixed site (Hong Kong by default).
//
// Everything here is a geometric and artistic model of daylight. It knows where
// the sun is and what colour the light looks like, but it is not a photometric
// calculation: intensities are hand-tuned curves chosen to read well, not
// measured illuminance. The room is treated as a rectangular box with flat
// walls, and the sun patches are parallelograms projected from the window
// apertures onto the floor, with no occlusion by furniture.

const RAD = Math.PI / 180;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const mix = (a, b, t) => a + (b - a) * t;

export const WALLS = Object.freeze(['back', 'front', 'left', 'right']);
export const DEFAULT_LAMP_POWER = 4500;
// Mid-afternoon opens the preview with clear sun patches; lamp state is controlled
// independently on each lamp.
export const DEFAULT_TIME_MINUTES = 13 * 60 + 30;

// Compass convention for the scene's coordinates. The room runs x from 0 to
// width and z from 0 to depth, so -z is treated as north and +x as east. Nothing
// in the scene model previously implied an orientation, so this is declared here
// rather than left implicit.
export const COMPASS = Object.freeze({ north: Object.freeze({ x: 0, z: -1 }), east: Object.freeze({ x: 1, z: 0 }) });

function smoothstep(edge0, edge1, value) {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Unit vector from the room toward the sun. */
export function sunDirection(altitudeDegrees, azimuthDegrees) {
  const altitude = altitudeDegrees * RAD;
  const azimuth = azimuthDegrees * RAD;
  const horizontal = Math.cos(altitude);
  return {
    x: horizontal * Math.sin(azimuth) * COMPASS.east.x + horizontal * Math.cos(azimuth) * COMPASS.north.x,
    y: Math.sin(altitude),
    z: horizontal * Math.sin(azimuth) * COMPASS.east.z + horizontal * Math.cos(azimuth) * COMPASS.north.z,
  };
}

/** Inward normal of a wall, pointing into the room. */
export function wallInwardNormal(wall) {
  switch (wall) {
    case 'back': return { x: 0, z: -1 };
    case 'front': return { x: 0, z: 1 };
    case 'left': return { x: 1, z: 0 };
    case 'right': return { x: -1, z: 0 };
    default: throw new RangeError(`Unsupported window wall: ${wall}`);
  }
}

/** Outward compass label for a wall, used in the UI. */
export function wallCompassLabel(wall) {
  return { back: 'south', front: 'north', left: 'west', right: 'east' }[wall] ?? wall;
}

/** The four corners of a window aperture in world space, sill first. */
export function windowCorners(window, room) {
  const { width, height } = window.dimensions;
  const { x, y, z } = window.position;
  const half = width / 2;
  const alongX = window.wall === 'back' || window.wall === 'front';
  const low = alongX ? x - half : z - half;
  const high = alongX ? x + half : z + half;
  const sill = y;
  const head = y + height;
  const toPoint = (across, heightValue) => (alongX
    ? { x: across, y: heightValue, z }
    : { x, y: heightValue, z: across });
  return [toPoint(low, sill), toPoint(high, sill), toPoint(high, head), toPoint(low, head)];
}

/** Sutherland-Hodgman clip of a 2D polygon against an axis-aligned rectangle. */
export function clipPolygonToRectangle(polygon, { minX, maxX, minY, maxY }) {
  const edges = [
    (p) => p.x >= minX,
    (p) => p.x <= maxX,
    (p) => p.y >= minY,
    (p) => p.y <= maxY,
  ];
  const intersects = [
    (a, b) => ({ x: minX, y: a.y + ((b.y - a.y) * (minX - a.x)) / (b.x - a.x) }),
    (a, b) => ({ x: maxX, y: a.y + ((b.y - a.y) * (maxX - a.x)) / (b.x - a.x) }),
    (a, b) => ({ x: a.x + ((b.x - a.x) * (minY - a.y)) / (b.y - a.y), y: minY }),
    (a, b) => ({ x: a.x + ((b.x - a.x) * (maxY - a.y)) / (b.y - a.y), y: maxY }),
  ];

  let output = polygon;
  for (let edge = 0; edge < edges.length; edge += 1) {
    if (!output.length) return [];
    const input = output;
    output = [];
    const inside = edges[edge];
    const intersect = intersects[edge];
    for (let index = 0; index < input.length; index += 1) {
      const current = input[index];
      const previous = input[(index + input.length - 1) % input.length];
      const currentInside = inside(current);
      const previousInside = inside(previous);
      if (currentInside) {
        if (!previousInside) output.push(intersect(previous, current));
        output.push(current);
      } else if (previousInside) {
        output.push(intersect(previous, current));
      }
    }
  }
  return output;
}

/** Area of a 2D polygon, used to drop patches that degenerate to slivers. */
export function polygonArea(polygon) {
  let total = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const a = polygon[index];
    const b = polygon[(index + 1) % polygon.length];
    total += a.x * b.y - b.x * a.y;
  }
  return Math.abs(total) / 2;
}

/**
 * Sunlit floor patches cast through the room's windows.
 *
 * Each aperture is projected along the sun direction onto the floor plane, which
 * for parallel rays turns the window rectangle into a parallelogram. Patches are
 * clipped to the floor, and skipped when the sun is on the wrong side of the
 * wall, below the horizon, or the window is shut.
 */
export function sunPatches(scene, { direction, daylight }) {
  if (direction.y <= 1e-4 || daylight <= 0) return [];
  const patches = [];
  const floor = { minX: 0, maxX: scene.room.width, minY: 0, maxY: scene.room.depth };

  for (const object of scene.objects) {
    if (!isOpeningObject(object) || object.open !== true) continue;
    const normal = wallInwardNormal(object.wall);
    // The sun must be shining onto the outward face of this wall.
    const incidence = -(direction.x * normal.x + direction.z * normal.z);
    if (incidence <= 0.02) continue;

    const projected = windowCorners(object, scene.room).map((corner) => {
      const travel = corner.y / direction.y;
      // Clip in (x, y) space, then report the floor back as (x, z).
      return { x: corner.x - direction.x * travel, y: corner.z - direction.z * travel };
    });
    const clipped = clipPolygonToRectangle(projected, floor);
    const area = polygonArea(clipped);
    if (area < 0.01) continue;

    patches.push({
      windowId: object.id,
      wall: object.wall,
      polygon: clipped.map((point) => ({ x: point.x, z: point.y })),
      area,
      // Grazing light spreads the same energy over more floor, so the patch
      // reads as dimmer the further the sun is from the wall's normal.
      intensity: daylight * incidence,
    });
  }
  return patches;
}

// Hand-tuned colour and intensity curves. These are chosen so the preview reads
// as daylight on screen; they are not lux values and are not derived from any
// irradiance model.
const NIGHT_SKY = { r: 0.055, g: 0.075, b: 0.14 };
const DAY_SKY = { r: 0.52, g: 0.62, b: 0.78 };
const HORIZON_SUN = { r: 1.0, g: 0.42, b: 0.16 };
const MIDDAY_SUN = { r: 1.0, g: 0.97, b: 0.9 };
const NIGHT_BACKGROUND = { r: 0.055, g: 0.065, b: 0.095 };
const DAY_BACKGROUND = { r: 0.95, g: 0.955, b: 0.95 };

function mixColour(a, b, t) {
  return { r: mix(a.r, b.r, t), g: mix(a.g, b.g, t), b: mix(a.b, b.b, t) };
}

/**
 * Full lighting state for a clock time. Pure: it reads the scene and returns
 * numbers, and knows nothing about three.js.
 */
export function describeDaylight({
  scene,
  timeMinutes = 720,
  date = DEFAULT_DATE,
  ...rest
} = {}) {
  if (!scene?.room || !Array.isArray(scene.objects)) {
    throw new TypeError('A room scene with a room and object list is required.');
  }
  if (!Number.isFinite(timeMinutes)) throw new RangeError('Time must be a finite number of minutes.');
  if (scene.objects.some((object) => object.wall && !WALLS.includes(object.wall))) {
    throw new RangeError('Scene contains a window on an unsupported wall.');
  }

  const sun = solarPosition({ date, timeMinutes, ...rest });
  const direction = sunDirection(sun.altitude, sun.azimuth);

  // Daylight ramps in around the horizon rather than switching at it, so dawn
  // and dusk pass through a warm low-sun phase.
  const daylight = smoothstep(-4, 8, sun.altitude);
  const warmth = 1 - smoothstep(2, 26, sun.altitude);
  const sunColour = mixColour(MIDDAY_SUN, HORIZON_SUN, warmth);

  const skyColour = mixColour(NIGHT_SKY, DAY_SKY, daylight);
  const background = mixColour(NIGHT_BACKGROUND, DAY_BACKGROUND, daylight);

  return {
    timeMinutes,
    clock: formatClock(timeMinutes),
    sun: {
      altitude: sun.altitude,
      azimuth: sun.azimuth,
      direction,
      daylight,
      warmth,
      colour: sunColour,
      intensity: 2.2 * daylight,
    },
    sky: { colour: skyColour, intensity: mix(0.3, 0.78, daylight) },
    background,
    exposure: mix(1.05, 0.98, daylight),
    patches: sunPatches(scene, { direction, daylight }),
    site: { name: SITE.name, ...rest },
    events: dayEvents({ date, ...rest }),
  };
}
