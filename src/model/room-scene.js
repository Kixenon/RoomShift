import { assertPlacementClear, findObjectCollision } from './room-collision.js';
import { rotationMatrixXYZ } from './room-transform.js';
import { isOpeningObject } from './openings.js';

export { rotationMatrixXYZ } from './room-transform.js';

export const DEFAULT_ROOM = Object.freeze({ width: 5.2, depth: 4, height: 2.7, outdoorTemperature: 10 });

export const DEFAULT_BOX_DIMENSIONS = Object.freeze({ width: 1, height: 1, depth: 1 });
export const SOURCE_MODELS = Object.freeze(['fan', 'heater', 'lamp']);
export const SOURCE_INTENSITY_LIMITS = Object.freeze({ min: 0, max: 2 });

const preset = (label, icon, dimensions) => Object.freeze({
  label,
  icon,
  dimensions: Object.freeze(dimensions),
});

export const MODEL_PRESETS = Object.freeze({
  box: preset('Box', '□', DEFAULT_BOX_DIMENSIONS),
  fan: preset('Fan', '✳', { width: 0.42, height: 1.35, depth: 0.42 }),
  sofa: preset('Sofa', '▰', { width: 1.55, height: 0.78, depth: 0.84 }),
  bed: preset('Bed', '▰', { width: 1.6, height: 0.55, depth: 2 }),
  desk: preset('Desk', '▤', { width: 1.18, height: 0.74, depth: 0.62 }),
  table: preset('Table', '▱', { width: 0.92, height: 0.38, depth: 0.62 }),
  lamp: preset('Lamp', '◉', { width: 0.32, height: 1.55, depth: 0.32 }),
  heater: preset('Heater', '▥', { width: 0.9, height: 0.56, depth: 0.18 }),
  window: preset('Window', '▣', { width: 1.4, height: 1, depth: 0.06 }),
  door: preset('Door', '▯', { width: 0.9, height: 2.1, depth: 0.06 }),
});

const INITIAL_OBJECTS = Object.freeze([
  { id: 'fan-1', primitive: 'box', model: 'fan', name: 'Pedestal fan', enabled: true, intensity: 1, position: { x: 0.82, y: 0, z: 3.15 }, rotation: { x: 0, y: 180, z: 0 }, dimensions: { width: 0.42, height: 1.35, depth: 0.42 } },
  { id: 'sofa-2', primitive: 'box', model: 'sofa', name: 'Sofa', position: { x: 4.18, y: 0, z: 3.04 }, rotation: { x: 0, y: 0, z: 0 }, dimensions: { width: 1.55, height: 0.78, depth: 0.84 } },
  { id: 'desk-3', primitive: 'box', model: 'desk', name: 'Desk', position: { x: 4.18, y: 0, z: 0.86 }, rotation: { x: 0, y: 0, z: 0 }, dimensions: { width: 1.18, height: 0.74, depth: 0.62 } },
  { id: 'table-4', primitive: 'box', model: 'table', name: 'Coffee table', position: { x: 2.62, y: 0, z: 2.12 }, rotation: { x: 0, y: 0, z: 0 }, dimensions: { width: 0.92, height: 0.38, depth: 0.62 } },
  { id: 'lamp-1', primitive: 'box', model: 'lamp', name: 'Floor lamp', intensity: 1, position: { x: 1.2, y: 0, z: 0.9 }, rotation: { x: 0, y: 0, z: 0 }, dimensions: { width: 0.32, height: 1.55, depth: 0.32 } },
  { id: 'heater-1', primitive: 'box', model: 'heater', name: 'Panel heater', intensity: 1, position: { x: 0.55, y: 0, z: 1.9 }, rotation: { x: 0, y: 0, z: 0 }, dimensions: { width: 0.9, height: 0.56, depth: 0.18 } },
]);

export function createRoomScene() {
  return {
    room: { ...DEFAULT_ROOM },
    objects: INITIAL_OBJECTS.map((object) => structuredClone(object)),
    nextObjectId: 5,
    nextWindowId: 1,
    nextDoorId: 1,
  };
}

function anchoredOpeningPosition(object, position, room) {
  const wall = object.wall ?? 'back';
  const isDoor = object.model === 'door';
  const alongX = wall === 'back' || wall === 'front';
  const span = alongX ? room.width : room.depth;
  const dimensions = {
    ...object.dimensions,
    width: Math.min(object.dimensions.width, span - 0.2),
    height: Math.min(object.dimensions.height, room.height - (isDoor ? 0 : 0.2)),
  };
  const halfWidth = dimensions.width / 2;
  const depthOffset = dimensions.depth / 2;
  const wallPosition = alongX ? position.x ?? object.position.x : position.z ?? object.position.z;
  const wallInset = alongX ? 0 : depthOffset;
  const alongWall = clampAndRound(wallPosition, halfWidth + wallInset, span - halfWidth - wallInset);
  return {
    ...object,
    dimensions,
    position: {
      x: alongX
        ? alongWall
        : wall === 'left' ? depthOffset : room.width - depthOffset,
      y: isDoor ? 0 : clampAndRound(position.y ?? object.position.y, 0.1, room.height - dimensions.height - 0.1),
      z: alongX
        ? wall === 'front' ? depthOffset : room.depth - depthOffset
        : alongWall,
    },
    rotation: { x: 0, y: wall === 'left' ? 90 : wall === 'right' ? -90 : wall === 'back' ? 180 : 0, z: 0 },
  };
}

function addOpening(scene, model, wall) {
  if (!['back', 'front', 'left', 'right'].includes(wall)) throw new RangeError(`Unsupported opening wall: ${wall}`);
  const idKey = model === 'door' ? 'nextDoorId' : 'nextWindowId';
  const idNumber = scene[idKey] ?? 1;
  const dimensions = { ...MODEL_PRESETS[model].dimensions };
  const label = MODEL_PRESETS[model].label;
  const template = {
    id: `${model}-${idNumber}`,
    primitive: 'opening',
    model,
    name: `${label} ${idNumber}`,
    wall,
    open: false,
    flowDirection: 'exchange',
    flowRate: 0.35,
    dimensions,
    position: { x: scene.room.width / 2, y: model === 'door' ? 0 : 0.9, z: scene.room.depth / 2 },
    rotation: { x: 0, y: 0, z: 0 },
  };
  const alongX = wall === 'back' || wall === 'front';
  const span = alongX ? scene.room.width : scene.room.depth;
  const alongAxis = alongX ? 'x' : 'z';
  const center = span / 2;
  let object;
  for (let step = 0; step <= Math.ceil(span / 0.1); step += 1) {
    for (const sign of step === 0 ? [0] : [-1, 1]) {
      const position = anchoredOpeningPosition(template, { [alongAxis]: center + step * 0.1 * sign }, scene.room);
      if (!findObjectCollision(scene.objects, position)) {
        object = position;
        break;
      }
    }
    if (object) break;
  }
  if (!object) throw new RangeError(`No clear space remains for a ${label.toLowerCase()} on the ${wall} wall.`);
  return {
    object,
    scene: { ...scene, [idKey]: idNumber + 1, objects: [...scene.objects, object] },
  };
}

export function addWindow(scene, wall = 'back') {
  return addOpening(scene, 'window', wall);
}

export function addDoor(scene, wall = 'back') {
  return addOpening(scene, 'door', wall);
}

export function setWindowOpen(scene, objectId, open) {
  const existing = scene.objects.find((object) => object.id === objectId);
  if (!isOpeningObject(existing)) throw new RangeError(`Unknown opening: ${objectId}`);
  const updated = { ...existing, open: Boolean(open) };
  return {
    object: updated,
    scene: { ...scene, objects: scene.objects.map((object) => object.id === objectId ? updated : object) },
  };
}

export function setWindowFlow(scene, objectId, flowDirection, flowRate) {
  const existing = scene.objects.find((object) => object.id === objectId);
  if (!isOpeningObject(existing)) throw new RangeError(`Unknown opening: ${objectId}`);
  if (!['exchange', 'inlet', 'outlet'].includes(flowDirection)) throw new RangeError(`Unsupported opening flow direction: ${flowDirection}`);
  if (!Number.isFinite(flowRate) || flowRate < 0 || flowRate > 1.5) {
    throw new RangeError('Exterior wind speed must be between 0 and 1.5 m/s.');
  }
  const updated = { ...existing, flowDirection, flowRate: round(flowRate) };
  return {
    object: updated,
    scene: { ...scene, objects: scene.objects.map((object) => object.id === objectId ? updated : object) },
  };
}

export function setWindowWall(scene, objectId, wall) {
  const existing = scene.objects.find((object) => object.id === objectId);
  if (!isOpeningObject(existing)) throw new RangeError(`Unknown opening: ${objectId}`);
  if (!['back', 'front', 'left', 'right'].includes(wall)) throw new RangeError(`Unsupported opening wall: ${wall}`);
  const wasAlongX = existing.wall === 'back' || existing.wall === 'front';
  const isAlongX = wall === 'back' || wall === 'front';
  const position = wasAlongX === isAlongX ? existing.position : {
    ...existing.position,
    x: scene.room.width / 2,
    z: scene.room.depth / 2,
  };
  const updated = anchoredOpeningPosition({ ...existing, wall }, position, scene.room);
  assertPlacementClear(scene.objects, updated, objectId);
  return {
    object: updated,
    scene: { ...scene, objects: scene.objects.map((object) => object.id === objectId ? updated : object) },
  };
}

export function addObject(scene, options = {}) {
  const { model = 'box', name, dimensions = DEFAULT_BOX_DIMENSIONS } = options;
  if (!MODEL_PRESETS[model]) throw new RangeError(`Unsupported object model: ${model}`);
  if (isOpeningObject({ model })) throw new RangeError('Use the opening tools to place a window or door on a room wall.');

  const idNumber = scene.nextObjectId;
  const boxDimensions = { ...dimensions };
  if (!['width', 'height', 'depth'].every((axis) => Number.isFinite(boxDimensions[axis]) && boxDimensions[axis] > 0)) {
    throw new RangeError('Object dimensions must be positive finite values.');
  }
  if (boxDimensions.width > scene.room.width || boxDimensions.height > scene.room.height
    || boxDimensions.depth > scene.room.depth) {
    throw new RangeError('Object does not fit inside the room.');
  }
  const template = {
    id: `box-${idNumber}`,
    primitive: 'box',
    model,
    name: normalizeObjectName(name ?? `Box ${idNumber}`),
    ...(SOURCE_MODELS.includes(model) ? { intensity: 1 } : {}),
    dimensions: boxDimensions,
    position: { x: scene.room.width / 2, y: 0, z: scene.room.depth / 2 },
    rotation: { x: 0, y: 0, z: 0 },
  };
  let object = null;
  const step = 0.25;
  const xCount = Math.floor(scene.room.width / step);
  const zCount = Math.floor(scene.room.depth / step);
  const candidates = [];
  for (let xi = 0; xi <= xCount; xi += 1) {
    for (let zi = 0; zi <= zCount; zi += 1) {
      const x = clampAndRound(xi * step, boxDimensions.width / 2, scene.room.width - boxDimensions.width / 2);
      const z = clampAndRound(zi * step, boxDimensions.depth / 2, scene.room.depth - boxDimensions.depth / 2);
      candidates.push({ x, z, distance: (x - scene.room.width / 2) ** 2 + (z - scene.room.depth / 2) ** 2 });
    }
  }
  candidates.sort((a, b) => a.distance - b.distance);
  for (const candidate of candidates) {
    const attempt = { ...template, position: { x: candidate.x, y: 0, z: candidate.z } };
    if (!findObjectCollision(scene.objects, attempt)) {
      object = attempt;
      break;
    }
  }
  if (!object) throw new RangeError('No clear floor space remains for this object.');
  return { object, scene: { ...scene, nextObjectId: idNumber + 1, objects: [...scene.objects, object] } };
}

export function setObjectModel(scene, objectId, model) {
  const existing = scene.objects.find((object) => object.id === objectId);
  if (!existing) throw new RangeError(`Unknown object: ${objectId}`);
  if (!MODEL_PRESETS[model]) throw new RangeError(`Unsupported object model: ${model}`);
  if (isOpeningObject({ model })) throw new RangeError('Use the opening tools to place a window or door on a room wall.');
  const updated = { ...existing, primitive: 'box', model };
  if (SOURCE_MODELS.includes(model)) updated.intensity = existing.intensity ?? 1;
  else delete updated.intensity;
  if (model === 'fan') updated.enabled = existing.model === 'fan' ? existing.enabled !== false : true;
  else delete updated.enabled;
  const objects = scene.objects.map((object) => object.id === objectId ? updated : object);
  return { scene: { ...scene, objects }, object: updated };
}

export function setFanEnabled(scene, objectId, enabled) {
  const existing = scene.objects.find((object) => object.id === objectId);
  if (!existing || existing.model !== 'fan') throw new RangeError(`Unknown fan: ${objectId}`);
  const updated = { ...existing, enabled: Boolean(enabled) };
  return {
    object: updated,
    scene: { ...scene, objects: scene.objects.map((object) => object.id === objectId ? updated : object) },
  };
}

export function setObjectIntensity(scene, objectId, intensity) {
  const existing = scene.objects.find((object) => object.id === objectId);
  if (!existing) throw new RangeError(`Unknown object: ${objectId}`);
  if (!SOURCE_MODELS.includes(existing.model)) throw new RangeError(`${existing.model} has no adjustable source strength.`);
  if (!Number.isFinite(intensity) || intensity < SOURCE_INTENSITY_LIMITS.min || intensity > SOURCE_INTENSITY_LIMITS.max) {
    throw new RangeError(`Source strength must be between ${SOURCE_INTENSITY_LIMITS.min} and ${SOURCE_INTENSITY_LIMITS.max}.`);
  }
  const updated = { ...existing, intensity: round(intensity) };
  return {
    object: updated,
    scene: { ...scene, objects: scene.objects.map((object) => object.id === objectId ? updated : object) },
  };
}

export function renameObject(scene, objectId, name) {
  const existing = scene.objects.find((object) => object.id === objectId);
  if (!existing) throw new RangeError(`Unknown object: ${objectId}`);
  const updated = { ...existing, name: normalizeObjectName(name) };
  const objects = scene.objects.map((object) => object.id === objectId ? updated : object);
  return { scene: { ...scene, objects }, object: updated };
}

function normalizeObjectName(name) {
  if (typeof name !== 'string') throw new TypeError('Object name must be text.');
  const normalized = name.trim();
  if (!normalized || normalized.length > 80) throw new RangeError('Object name must contain 1–80 characters.');
  return normalized;
}

export function rotatedHalfExtents(dimensions, rotation) {
  const matrix = rotationMatrixXYZ(rotation);
  const half = [dimensions.width / 2, dimensions.height / 2, dimensions.depth / 2];
  return matrix.map((row) => row.reduce((extent, coefficient, axis) => extent + Math.abs(coefficient) * half[axis], 0));
}

const normalizeDegrees = (degrees) => round((((degrees + 180) % 360 + 360) % 360) - 180);

function boundedPosition(object, position, room) {
  const [halfWidth, halfHeight, halfDepth] = rotatedHalfExtents(object.dimensions, object.rotation);
  if (halfWidth * 2 > room.width || halfDepth * 2 > room.depth
    || halfHeight * 2 > room.height) {
    throw new RangeError(`Object ${object.id} does not fit inside the room at this rotation.`);
  }
  return {
    x: clampAndRound(position.x ?? object.position.x, halfWidth, room.width - halfWidth),
    y: clampAndRound(
      position.y ?? object.position.y,
      halfHeight - object.dimensions.height / 2,
      room.height - halfHeight - object.dimensions.height / 2,
    ),
    z: clampAndRound(position.z ?? object.position.z, halfDepth, room.depth - halfDepth),
  };
}

export function moveObject(scene, objectId, position) {
  const existing = scene.objects.find((object) => object.id === objectId);
  if (!existing) throw new RangeError(`Unknown object: ${objectId}`);
  const moved = { ...existing, position: boundedPosition(existing, position, scene.room) };
  let anchored = moved;
  if (isOpeningObject(existing)) {
    const candidate = {
      x: position.x ?? existing.position.x,
      y: position.y ?? existing.position.y,
      z: position.z ?? existing.position.z,
    };
    const inset = existing.dimensions.depth / 2;
    const distances = {
      front: Math.abs(candidate.z - inset),
      back: Math.abs(candidate.z - (scene.room.depth - inset)),
      left: Math.abs(candidate.x - inset),
      right: Math.abs(candidate.x - (scene.room.width - inset)),
    };
    const closestWall = Object.keys(distances).sort((a, b) => distances[a] - distances[b])[0];
    const wall = distances[closestWall] + 0.12 < distances[existing.wall ?? 'back'] ? closestWall : existing.wall ?? 'back';
    anchored = anchoredOpeningPosition({ ...existing, wall }, candidate, scene.room);
  }
  const objects = scene.objects.map((object) => object.id === objectId ? anchored : object);
  assertPlacementClear(scene.objects, anchored, objectId);
  return { scene: { ...scene, objects }, object: anchored };
}

export const ROOM_LIMITS = Object.freeze({
  width: Object.freeze({ min: 2, max: 20 }),
  depth: Object.freeze({ min: 2, max: 20 }),
  height: Object.freeze({ min: 2, max: 6 }),
});

export function resizeRoom(scene, dimensions) {
  const room = { ...scene.room, ...dimensions };
  for (const [axis, limits] of Object.entries(ROOM_LIMITS)) {
    if (!Number.isFinite(room[axis]) || room[axis] < limits.min || room[axis] > limits.max) {
      throw new RangeError(`${axis} must be between ${limits.min} and ${limits.max} meters.`);
    }
  }
  const objects = scene.objects.map((object) => isOpeningObject(object)
    ? anchoredOpeningPosition(object, object.position, room)
    : { ...object, position: boundedPosition(object, object.position, room) });
  for (let index = 0; index < objects.length; index += 1) {
    assertPlacementClear(objects.slice(0, index), objects[index]);
  }
  return { ...scene, room, objects };
}

export function resizeObject(scene, objectId, dimensions) {
  const existing = scene.objects.find((object) => object.id === objectId);
  if (!existing) throw new RangeError(`Unknown object: ${objectId}`);
  if (isOpeningObject(existing)) {
    const alongX = existing.wall === 'back' || existing.wall === 'front';
    const maxWidth = (alongX ? scene.room.width : scene.room.depth) - 0.2;
    const nextDimensions = { ...existing.dimensions, ...dimensions, depth: existing.dimensions.depth };
    if (nextDimensions.width < 0.4 || nextDimensions.width > maxWidth
      || nextDimensions.height < 0.4 || nextDimensions.height > scene.room.height - 0.2) {
      throw new RangeError(`${MODEL_PRESETS[existing.model].label} dimensions do not fit on this wall.`);
    }
    const resized = anchoredOpeningPosition({ ...existing, dimensions: nextDimensions }, existing.position, scene.room);
    assertPlacementClear(scene.objects, resized, objectId);
    const objects = scene.objects.map((object) => object.id === objectId ? resized : object);
    return { scene: { ...scene, objects }, object: resized };
  }
  const nextDimensions = { ...existing.dimensions, ...dimensions };
  for (const axis of ['width', 'height', 'depth']) {
    const roomLimit = axis === 'height' ? scene.room.height : axis === 'width' ? scene.room.width : scene.room.depth;
    if (!Number.isFinite(nextDimensions[axis]) || nextDimensions[axis] < 0.1 || nextDimensions[axis] > roomLimit) {
      throw new RangeError(`Object ${axis} must be between 0.1 and ${roomLimit} meters.`);
    }
  }
  const resized = {
    ...existing,
    dimensions: nextDimensions,
    position: boundedPosition({ ...existing, dimensions: nextDimensions }, existing.position, scene.room),
  };
  const objects = scene.objects.map((object) => object.id === objectId ? resized : object);
  assertPlacementClear(scene.objects, resized, objectId);
  return { scene: { ...scene, objects }, object: resized };
}

export function rotateObject(scene, objectId, rotation) {
  const existing = scene.objects.find((object) => object.id === objectId);
  if (!existing) throw new RangeError(`Unknown object: ${objectId}`);
  if (isOpeningObject(existing)) return { scene, object: existing };
  const nextRotation = {};
  for (const axis of ['x', 'y', 'z']) {
    const degrees = rotation?.[axis] ?? existing.rotation[axis];
    if (!Number.isFinite(degrees)) throw new RangeError(`Rotation ${axis.toUpperCase()} must be finite.`);
    nextRotation[axis] = normalizeDegrees(degrees);
  }
  const rotated = {
    ...existing,
    rotation: nextRotation,
    position: boundedPosition({ ...existing, rotation: nextRotation }, existing.position, scene.room),
  };
  const objects = scene.objects.map((object) => object.id === objectId ? rotated : object);
  assertPlacementClear(scene.objects, rotated, objectId);
  return { scene: { ...scene, objects }, object: rotated };
}

export function removeObject(scene, objectId) {
  if (!scene.objects.some((object) => object.id === objectId)) throw new RangeError(`Unknown object: ${objectId}`);
  return { ...scene, objects: scene.objects.filter((object) => object.id !== objectId) };
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round = (value) => Number(value.toFixed(2));
const clampAndRound = (value, min, max) => clamp(round(clamp(value, min, max)), min, max);
