import { assertPlacementClear, findObjectCollision } from './room-collision.js';
import { rotationMatrixXYZ } from './room-transform.js';
import { isOpeningObject } from './openings.js';

export { rotationMatrixXYZ } from './room-transform.js';

export const DEFAULT_ROOM = Object.freeze({ width: 5.2, depth: 4, height: 2.7, outdoorTemperature: 10 });

export const DEFAULT_BOX_DIMENSIONS = Object.freeze({ width: 1, height: 1, depth: 1 });
export const DEVICE_MODELS = Object.freeze(['fan', 'ceiling-fan', 'heater', 'air-conditioner', 'lamp', 'router']);
export const WALL_MOUNTED_DEVICE_MODELS = Object.freeze(['air-conditioner']);
export const CEILING_MOUNTED_DEVICE_MODELS = Object.freeze(['ceiling-fan']);
export const SOURCE_INTENSITY_LIMITS = Object.freeze({ min: 0, max: 2 });

export function isWallMountedDevice(object) {
  return WALL_MOUNTED_DEVICE_MODELS.includes(object?.model);
}

export function isCeilingMountedDevice(object) {
  return CEILING_MOUNTED_DEVICE_MODELS.includes(object?.model);
}

const preset = (label, icon, dimensions) => Object.freeze({
  label,
  icon,
  dimensions: Object.freeze(dimensions),
});

export const MODEL_PRESETS = Object.freeze({
  box: preset('Object', '□', DEFAULT_BOX_DIMENSIONS),
  fan: preset('Fan', '✳', { width: 0.42, height: 1.35, depth: 0.42 }),
  'ceiling-fan': preset('Ceiling fan with light', '✣', { width: 1.1, height: 0.32, depth: 1.1 }),
  sofa: preset('Sofa', '▰', { width: 1.55, height: 0.78, depth: 0.84 }),
  bed: preset('Bed', '▰', { width: 1.6, height: 0.55, depth: 2 }),
  desk: preset('Desk', '▤', { width: 1.18, height: 0.74, depth: 0.62 }),
  chair: preset('Office chair', '◒', { width: 0.58, height: 0.92, depth: 0.58 }),
  table: preset('Table', '▱', { width: 0.92, height: 0.38, depth: 0.62 }),
  lamp: preset('Lamp', '◉', { width: 0.32, height: 1.55, depth: 0.32 }),
  heater: preset('Heater', '▥', { width: 0.9, height: 0.56, depth: 0.18 }),
  'air-conditioner': preset('Air conditioner', '❄', { width: 0.86, height: 0.3, depth: 0.22 }),
  router: preset('Router', '⌁', { width: 0.28, height: 0.12, depth: 0.22 }),
  window: preset('Window', '▣', { width: 1.4, height: 1, depth: 0.06 }),
  door: preset('Door', '▯', { width: 0.9, height: 2.1, depth: 0.06 }),
});

const INITIAL_OBJECTS = Object.freeze([
  { id: 'fan-1', primitive: 'device', model: 'fan', name: 'Pedestal fan', enabled: true, intensity: 1, position: { x: 3.6, y: 0, z: 3.2 }, rotation: { x: 0, y: -110, z: 0 }, dimensions: { width: 0.42, height: 1.35, depth: 0.42 } },
  { id: 'sofa-2', primitive: 'box', model: 'sofa', name: 'Sofa', position: { x: 0.58, y: 0, z: 2 }, rotation: { x: 0, y: 90, z: 0 }, dimensions: { width: 1.55, height: 0.78, depth: 0.84 } },
  { id: 'desk-3', primitive: 'box', model: 'desk', name: 'Desk', position: { x: 4.83, y: 0, z: 2 }, rotation: { x: 0, y: -90, z: 0 }, dimensions: { width: 1.18, height: 0.74, depth: 0.62 } },
  { id: 'chair-5', primitive: 'box', model: 'chair', name: 'Office chair', position: { x: 4.08, y: 0, z: 2 }, rotation: { x: 0, y: -90, z: 0 }, dimensions: { width: 0.58, height: 0.92, depth: 0.58 } },
  { id: 'table-4', primitive: 'box', model: 'table', name: 'Coffee table', position: { x: 1.75, y: 0, z: 2 }, rotation: { x: 0, y: 0, z: 0 }, dimensions: { width: 0.92, height: 0.38, depth: 0.62 } },
  { id: 'lamp-1', primitive: 'device', model: 'lamp', name: 'Floor lamp', enabled: true, intensity: 1, position: { x: 1.35, y: 0, z: 3.15 }, rotation: { x: 0, y: 0, z: 0 }, dimensions: { width: 0.32, height: 1.55, depth: 0.32 } },
  { id: 'heater-1', primitive: 'device', model: 'heater', name: 'Panel heater', enabled: true, intensity: 1, position: { x: 2.6, y: 0.05, z: 0.13 }, rotation: { x: 0, y: 0, z: 0 }, dimensions: { width: 0.9, height: 0.56, depth: 0.18 } },
  { id: 'air-conditioner-1', primitive: 'device', model: 'air-conditioner', name: 'Wall AC', wall: 'back', enabled: true, intensity: 1, position: { x: 2.6, y: 2.08, z: 3.89 }, rotation: { x: 0, y: 180, z: 0 }, dimensions: { width: 0.86, height: 0.3, depth: 0.22 } },
  { id: 'ceiling-fan-1', primitive: 'device', model: 'ceiling-fan', name: 'Ceiling fan with light', enabled: true, intensity: 1, position: { x: 2.6, y: 2.38, z: 2 }, rotation: { x: 0, y: 0, z: 0 }, dimensions: { width: 1.1, height: 0.32, depth: 1.1 } },
  { id: 'router-1', primitive: 'device', model: 'router', name: 'Router', enabled: true, intensity: 1, position: { x: 4.8, y: 0.76, z: 2.44 }, rotation: { x: 0, y: 0, z: 0 }, dimensions: { width: 0.28, height: 0.12, depth: 0.22 } },
  { id: 'window-1', primitive: 'opening', model: 'window', name: 'Window 1', wall: 'back', open: false, flowDirection: 'exchange', flowRate: 0.35, position: { x: 1.25, y: 1, z: 3.97 }, rotation: { x: 0, y: 180, z: 0 }, dimensions: { width: 1.4, height: 1, depth: 0.06 } },
  { id: 'door-1', primitive: 'opening', model: 'door', name: 'Door 1', wall: 'front', open: false, flowDirection: 'exchange', flowRate: 0.35, position: { x: 4.55, y: 0, z: 0.03 }, rotation: { x: 0, y: 0, z: 0 }, dimensions: { width: 0.9, height: 2.1, depth: 0.06 } },
]);

export function createRoomScene() {
  return {
    room: { ...DEFAULT_ROOM },
    objects: INITIAL_OBJECTS.map((object) => structuredClone(object)),
    nextObjectId: 6,
    nextWindowId: 2,
    nextDoorId: 2,
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

function anchoredWallMountedDevice(object, position, room, wall = object.wall ?? 'back') {
  if (!['back', 'front', 'left', 'right'].includes(wall)) throw new RangeError(`Unsupported device wall: ${wall}`);
  const alongX = wall === 'back' || wall === 'front';
  const span = alongX ? room.width : room.depth;
  const depthOffset = object.dimensions.depth / 2;
  const wallInset = alongX ? 0 : depthOffset;
  const alongAxis = alongX ? 'x' : 'z';
  const alongWall = clampAndRound(
    position[alongAxis] ?? object.position[alongAxis],
    object.dimensions.width / 2 + wallInset,
    span - object.dimensions.width / 2 - wallInset,
  );
  return {
    ...object,
    wall,
    position: {
      x: alongX ? alongWall : wall === 'left' ? depthOffset : room.width - depthOffset,
      y: clampAndRound(position.y ?? object.position.y, 0.1, room.height - object.dimensions.height - 0.1),
      z: alongX ? wall === 'front' ? depthOffset : room.depth - depthOffset : alongWall,
    },
    rotation: { x: 0, y: wall === 'left' ? 90 : wall === 'right' ? -90 : wall === 'back' ? 180 : 0, z: 0 },
  };
}

function anchoredCeilingMountedDevice(object, position, room) {
  const [halfWidth, , halfDepth] = rotatedHalfExtents(object.dimensions, object.rotation);
  return {
    ...object,
    position: {
      x: clampAndRound(position.x ?? object.position.x, halfWidth, room.width - halfWidth),
      y: room.height - object.dimensions.height,
      z: clampAndRound(position.z ?? object.position.z, halfDepth, room.depth - halfDepth),
    },
  };
}

function addWallMountedDevice(scene, model) {
  const idNumber = scene.nextObjectId;
  const dimensions = { ...MODEL_PRESETS[model].dimensions };
  const template = {
    id: `${model}-${idNumber}`,
    primitive: 'device',
    model,
    name: `${MODEL_PRESETS[model].label} ${idNumber}`,
    wall: 'back',
    enabled: true,
    intensity: 1,
    dimensions,
    position: { x: scene.room.width / 2, y: scene.room.height - dimensions.height - 0.35, z: scene.room.depth / 2 },
    rotation: { x: 0, y: 180, z: 0 },
  };
  const span = scene.room.width;
  let object;
  for (let step = 0; step <= Math.ceil(span / 0.1); step += 1) {
    for (const sign of step === 0 ? [0] : [-1, 1]) {
      const position = anchoredWallMountedDevice(template, {
        x: scene.room.width / 2 + step * 0.1 * sign,
        y: template.position.y,
      }, scene.room);
      if (!findObjectCollision(scene.objects, position)) {
        object = position;
        break;
      }
    }
    if (object) break;
  }
  if (!object) throw new RangeError(`No clear space remains for an ${MODEL_PRESETS[model].label.toLowerCase()} on the back wall.`);
  return {
    object,
    scene: { ...scene, nextObjectId: idNumber + 1, objects: [...scene.objects, object] },
  };
}

function addCeilingMountedDevice(scene, model) {
  const idNumber = scene.nextObjectId;
  const dimensions = { ...MODEL_PRESETS[model].dimensions };
  const template = {
    id: `${model}-${idNumber}`,
    primitive: 'device',
    model,
    name: `${MODEL_PRESETS[model].label} ${idNumber}`,
    enabled: true,
    intensity: 1,
    dimensions,
    position: { x: scene.room.width / 2, y: scene.room.height - dimensions.height, z: scene.room.depth / 2 },
    rotation: { x: 0, y: 0, z: 0 },
  };
  const [halfWidth, , halfDepth] = rotatedHalfExtents(dimensions, template.rotation);
  const candidates = [];
  for (let xi = 0; xi <= Math.floor(scene.room.width / 0.25); xi += 1) {
    for (let zi = 0; zi <= Math.floor(scene.room.depth / 0.25); zi += 1) {
      const x = clampAndRound(xi * 0.25, halfWidth, scene.room.width - halfWidth);
      const z = clampAndRound(zi * 0.25, halfDepth, scene.room.depth - halfDepth);
      candidates.push({
        x,
        z,
        distance: (x - scene.room.width / 2) ** 2 + (z - scene.room.depth / 2) ** 2,
      });
    }
  }
  candidates.sort((a, b) => a.distance - b.distance);
  let object;
  for (const candidate of candidates) {
    const position = anchoredCeilingMountedDevice(template, candidate, scene.room);
    if (!findObjectCollision(scene.objects, position)) {
      object = position;
      break;
    }
  }
  if (!object) throw new RangeError(`No clear ceiling space remains for a ${MODEL_PRESETS[model].label.toLowerCase()}.`);
  return {
    object,
    scene: { ...scene, nextObjectId: idNumber + 1, objects: [...scene.objects, object] },
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
    open: true,
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

export function setDeviceWall(scene, objectId, wall) {
  const existing = scene.objects.find((object) => object.id === objectId);
  if (!isWallMountedDevice(existing)) throw new RangeError(`Unknown wall-mounted device: ${objectId}`);
  const wasAlongX = existing.wall === 'back' || existing.wall === 'front';
  const isAlongX = wall === 'back' || wall === 'front';
  const position = wasAlongX === isAlongX ? existing.position : {
    ...existing.position,
    x: scene.room.width / 2,
    z: scene.room.depth / 2,
  };
  const updated = anchoredWallMountedDevice(existing, position, scene.room, wall);
  assertPlacementClear(scene.objects, updated, objectId);
  return {
    object: updated,
    scene: { ...scene, objects: scene.objects.map((object) => object.id === objectId ? updated : object) },
  };
}

export function addObject(scene, options = {}) {
  const { model = 'box', name } = options;
  if (!MODEL_PRESETS[model]) throw new RangeError(`Unsupported object model: ${model}`);
  if (isOpeningObject({ model })) throw new RangeError('Use the opening tools to place a window or door on a room wall.');
  if (isWallMountedDevice({ model }) || isCeilingMountedDevice({ model })) {
    throw new RangeError('Use the device tools to place mounted devices.');
  }

  const idNumber = scene.nextObjectId;
  const isDevice = DEVICE_MODELS.includes(model);
  const initialY = model === 'router' ? 1.1 : 0;
  const boxDimensions = { ...(options.dimensions ?? (isDevice ? MODEL_PRESETS[model].dimensions : DEFAULT_BOX_DIMENSIONS)) };
  if (!['width', 'height', 'depth'].every((axis) => Number.isFinite(boxDimensions[axis]) && boxDimensions[axis] > 0)) {
    throw new RangeError('Object dimensions must be positive finite values.');
  }
  if (boxDimensions.width > scene.room.width || boxDimensions.height > scene.room.height
    || boxDimensions.depth > scene.room.depth) {
    throw new RangeError('Object does not fit inside the room.');
  }
  const template = {
    id: `${isDevice ? model : 'object'}-${idNumber}`,
    primitive: isDevice ? 'device' : 'box',
    model,
    name: normalizeObjectName(name ?? `${isDevice ? MODEL_PRESETS[model].label : 'Object'} ${idNumber}`),
    ...(isDevice ? { enabled: true, intensity: 1 } : {}),
    dimensions: boxDimensions,
    position: { x: scene.room.width / 2, y: initialY, z: scene.room.depth / 2 },
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
      const attempt = { ...template, position: { x: candidate.x, y: initialY, z: candidate.z } };
    if (!findObjectCollision(scene.objects, attempt)) {
      object = attempt;
      break;
    }
  }
  if (!object) throw new RangeError('No clear floor space remains for this object.');
  return { object, scene: { ...scene, nextObjectId: idNumber + 1, objects: [...scene.objects, object] } };
}

export function addDevice(scene, model) {
  if (!DEVICE_MODELS.includes(model)) throw new RangeError(`Unsupported device type: ${model}`);
  if (isWallMountedDevice({ model })) return addWallMountedDevice(scene, model);
  if (isCeilingMountedDevice({ model })) return addCeilingMountedDevice(scene, model);
  return addObject(scene, { model });
}

export function setObjectModel(scene, objectId, model) {
  const existing = scene.objects.find((object) => object.id === objectId);
  if (!existing) throw new RangeError(`Unknown object: ${objectId}`);
  if (!MODEL_PRESETS[model]) throw new RangeError(`Unsupported object model: ${model}`);
  if (isOpeningObject({ model })) throw new RangeError('Use the opening tools to place a window or door on a room wall.');
  if (isWallMountedDevice({ model }) || isCeilingMountedDevice({ model })) {
    throw new RangeError('Mounted devices must be added with their device tool.');
  }
  const isDevice = DEVICE_MODELS.includes(model);
  const updated = { ...existing, primitive: isDevice ? 'device' : 'box', model };
  if (isDevice) updated.intensity = existing.intensity ?? 1;
  else delete updated.intensity;
  if (isDevice) updated.enabled = DEVICE_MODELS.includes(existing.model) ? existing.enabled !== false : true;
  else delete updated.enabled;
  const objects = scene.objects.map((object) => object.id === objectId ? updated : object);
  return { scene: { ...scene, objects }, object: updated };
}

export function setDeviceEnabled(scene, objectId, enabled) {
  const existing = scene.objects.find((object) => object.id === objectId);
  if (!existing || !DEVICE_MODELS.includes(existing.model)) throw new RangeError(`Unknown device: ${objectId}`);
  const updated = { ...existing, enabled: Boolean(enabled) };
  return {
    object: updated,
    scene: { ...scene, objects: scene.objects.map((object) => object.id === objectId ? updated : object) },
  };
}

export function setObjectIntensity(scene, objectId, intensity) {
  const existing = scene.objects.find((object) => object.id === objectId);
  if (!existing) throw new RangeError(`Unknown object: ${objectId}`);
  if (!DEVICE_MODELS.includes(existing.model)) throw new RangeError(`${existing.model} has no adjustable source strength.`);
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
  if (isCeilingMountedDevice(existing)) {
    const anchored = anchoredCeilingMountedDevice(existing, position, scene.room);
    assertPlacementClear(scene.objects, anchored, objectId);
    const objects = scene.objects.map((object) => object.id === objectId ? anchored : object);
    return { scene: { ...scene, objects }, object: anchored };
  }
  const wallMounted = isWallMountedDevice(existing);
  const moved = wallMounted
    ? existing
    : { ...existing, position: boundedPosition(existing, position, scene.room) };
  let anchored = moved;
  if (isOpeningObject(existing) || wallMounted) {
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
    anchored = wallMounted
      ? anchoredWallMountedDevice(existing, candidate, scene.room, wall)
      : anchoredOpeningPosition({ ...existing, wall }, candidate, scene.room);
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
    : isWallMountedDevice(object)
      ? anchoredWallMountedDevice(object, object.position, room)
      : isCeilingMountedDevice(object)
        ? anchoredCeilingMountedDevice(object, object.position, room)
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
  if (isWallMountedDevice(existing)) {
    const span = existing.wall === 'back' || existing.wall === 'front' ? scene.room.width : scene.room.depth;
    if (nextDimensions.width < 0.4 || nextDimensions.width > span - 0.2
      || nextDimensions.height < 0.1 || nextDimensions.height > scene.room.height - 0.2
      || nextDimensions.depth < 0.08 || nextDimensions.depth > 0.6) {
      throw new RangeError(`${MODEL_PRESETS[existing.model].label} dimensions do not fit on this wall.`);
    }
    const resized = anchoredWallMountedDevice({ ...existing, dimensions: nextDimensions }, existing.position, scene.room);
    assertPlacementClear(scene.objects, resized, objectId);
    const objects = scene.objects.map((object) => object.id === objectId ? resized : object);
    return { scene: { ...scene, objects }, object: resized };
  }
  if (isCeilingMountedDevice(existing)) {
    for (const axis of ['width', 'height', 'depth']) {
      const roomLimit = axis === 'height' ? scene.room.height : axis === 'width' ? scene.room.width : scene.room.depth;
      if (!Number.isFinite(nextDimensions[axis]) || nextDimensions[axis] < 0.1 || nextDimensions[axis] > roomLimit) {
        throw new RangeError(`Object ${axis} must be between 0.1 and ${roomLimit} meters.`);
      }
    }
    const resized = anchoredCeilingMountedDevice({ ...existing, dimensions: nextDimensions }, existing.position, scene.room);
    assertPlacementClear(scene.objects, resized, objectId);
    const objects = scene.objects.map((object) => object.id === objectId ? resized : object);
    return { scene: { ...scene, objects }, object: resized };
  }
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
  if (isOpeningObject(existing) || isWallMountedDevice(existing) || isCeilingMountedDevice(existing)) return { scene, object: existing };
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
