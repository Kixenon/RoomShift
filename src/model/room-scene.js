export const DEFAULT_ROOM = Object.freeze({ width: 5.2, depth: 4, height: 2.7 });

export const DEFAULT_BOX_DIMENSIONS = Object.freeze({ width: 1, height: 1, depth: 1 });

const preset = (label, icon, dimensions, extra = {}) => Object.freeze({
  label,
  icon,
  dimensions: Object.freeze(dimensions),
  category: 'furniture',
  material: 'wood',
  ...extra,
});

// `category` groups the add menu; `material` is the default when an object has none;
// `wall: true` items sit in a wall opening instead of on the floor.
export const MODEL_PRESETS = Object.freeze({
  box: preset('Box', '□', DEFAULT_BOX_DIMENSIONS, { category: 'basic' }),
  sofa: preset('Sofa', '▰', { width: 1.55, height: 0.78, depth: 0.84 }, { material: 'fabric' }),
  bed: preset('Bed', '▰', { width: 1.6, height: 0.55, depth: 2 }, { material: 'fabric' }),
  desk: preset('Desk', '▤', { width: 1.18, height: 0.74, depth: 0.62 }),
  chair: preset('Chair', '⑁', { width: 0.48, height: 0.86, depth: 0.5 }),
  table: preset('Table', '▱', { width: 0.92, height: 0.38, depth: 0.62 }),
  wardrobe: preset('Wardrobe', '▯', { width: 1.0, height: 2.0, depth: 0.58 }),
  shelf: preset('Shelf', '☰', { width: 0.8, height: 1.8, depth: 0.32 }),
  plant: preset('Plant', '❦', { width: 0.45, height: 1.1, depth: 0.45 }, { material: 'plant' }),
  fridge: preset('Fridge', '▮', { width: 0.6, height: 1.75, depth: 0.65 }, { category: 'appliance', material: 'metal' }),
  tv: preset('TV', '▭', { width: 1.25, height: 0.75, depth: 0.08 }, { category: 'appliance', material: 'plastic' }),
  monitor: preset('Monitor', '▭', { width: 0.62, height: 0.45, depth: 0.2 }, { category: 'desk', material: 'plastic' }),
  laptop: preset('Laptop', '⌨', { width: 0.32, height: 0.22, depth: 0.23 }, { category: 'desk', material: 'metal' }),
  bottle: preset('Bottle / mug', '◖', { width: 0.08, height: 0.24, depth: 0.08 }, { category: 'desk', material: 'plastic' }),
  books: preset('Books', '▥', { width: 0.3, height: 0.12, depth: 0.22 }, { category: 'desk', material: 'wood' }),
  fan: preset('Fan', '✳', { width: 0.42, height: 1.35, depth: 0.42 }, { category: 'climate', material: 'plastic' }),
  ac: preset('AC unit', '❄', { width: 0.85, height: 0.3, depth: 0.22 }, { category: 'climate', material: 'plastic' }),
  heater: preset('Heater', '▥', { width: 0.9, height: 0.56, depth: 0.18 }, { category: 'climate', material: 'metal' }),
  lamp: preset('Lamp', '◉', { width: 0.32, height: 1.55, depth: 0.32 }, { category: 'light', material: 'metal' }),
  deskLamp: preset('Desk lamp', '✦', { width: 0.2, height: 0.45, depth: 0.2 }, { category: 'light', material: 'metal' }),
  ceilingLight: preset('Ceiling light', '◎', { width: 0.45, height: 0.1, depth: 0.45 }, { category: 'light', material: 'plastic' }),
  router: preset('WiFi router', '⌔', { width: 0.24, height: 0.18, depth: 0.16 }, { category: 'signal', material: 'plastic', props: { power: 20, band: 5 } }),
  speaker: preset('Speaker', '♪', { width: 0.22, height: 0.34, depth: 0.22 }, { category: 'signal', material: 'wood', props: { level: 75 } }),
  window: preset('Window', '▣', { width: 1.4, height: 1, depth: 0.06 }, { category: 'opening', material: 'glass', wall: true }),
  door: preset('Door', '⌸', { width: 0.85, height: 2.05, depth: 0.06 }, { category: 'opening', wall: true }),
});

export const isWallItem = (object) => Boolean(MODEL_PRESETS[object?.model]?.wall);

export function objectMaterial(object) {
  return object.material ?? MODEL_PRESETS[object.model]?.material ?? 'wood';
}

// Real-unit intensity for each source type, and how it scales the solver's default.
export const INTENSITY = Object.freeze({
  heater: { key: 'watts', label: 'Power', unit: 'W', min: 200, max: 3000, step: 50, default: 1500 },
  fan: { key: 'speed', label: 'Speed', unit: '', min: 1, max: 3, step: 1, default: 2, labels: ['Low', 'Medium', 'High'] },
  ac: { key: 'speed', label: 'Fan speed', unit: '', min: 1, max: 3, step: 1, default: 2, labels: ['Low', 'Medium', 'High'] },
  lamp: { key: 'lumens', label: 'Brightness', unit: 'lm', min: 100, max: 3000, step: 50, default: 800 },
  deskLamp: { key: 'lumens', label: 'Brightness', unit: 'lm', min: 100, max: 1500, step: 50, default: 450 },
  ceilingLight: { key: 'lumens', label: 'Brightness', unit: 'lm', min: 200, max: 5000, step: 100, default: 1600 },
  speaker: { key: 'level', label: 'Level at 1 m', unit: 'dB', min: 45, max: 100, step: 1, default: 75 },
  router: { key: 'power', label: 'Transmit power', unit: 'dBm', min: 10, max: 23, step: 1, default: 20 },
});

// Multiplier on the solver's default fan push / heater output for one object.
export function sourceScale(object) {
  const spec = INTENSITY[object.model];
  if (!spec) return 1;
  const value = object.props?.[spec.key] ?? spec.default;
  if (object.props?.on === 0) return 0;
  if (spec.key === 'speed') return [0.5, 1, 1.6][Math.round(value) - 1] ?? 1;
  return value / spec.default;
}

export function objectProps(object) {
  return { ...(MODEL_PRESETS[object.model]?.props ?? {}), ...(object.props ?? {}) };
}

const INITIAL_OBJECTS = Object.freeze([
  { id: 'fan-1', primitive: 'box', model: 'fan', name: 'Pedestal fan', position: { x: 0.82, y: 0, z: 3.15 }, rotation: { x: 0, y: 180, z: 0 }, dimensions: { width: 0.42, height: 1.35, depth: 0.42 } },
  { id: 'sofa-2', primitive: 'box', model: 'sofa', name: 'Sofa', position: { x: 4.18, y: 0, z: 3.04 }, rotation: { x: 0, y: 0, z: 0 }, dimensions: { width: 1.55, height: 0.78, depth: 0.84 } },
  { id: 'desk-3', primitive: 'box', model: 'desk', name: 'Desk', position: { x: 4.18, y: 0, z: 0.86 }, rotation: { x: 0, y: 0, z: 0 }, dimensions: { width: 1.18, height: 0.74, depth: 0.62 } },
  { id: 'table-4', primitive: 'box', model: 'table', name: 'Coffee table', position: { x: 2.62, y: 0, z: 2.12 }, rotation: { x: 0, y: 0, z: 0 }, dimensions: { width: 0.92, height: 0.38, depth: 0.62 } },
  { id: 'lamp-1', primitive: 'box', model: 'lamp', name: 'Floor lamp', position: { x: 1.2, y: 0, z: 0.9 }, rotation: { x: 0, y: 0, z: 0 }, dimensions: { width: 0.32, height: 1.55, depth: 0.32 } },
  { id: 'heater-1', primitive: 'box', model: 'heater', name: 'Panel heater', position: { x: 0.55, y: 0, z: 1.9 }, rotation: { x: 0, y: 0, z: 0 }, dimensions: { width: 0.9, height: 0.56, depth: 0.18 } },
]);

export function createRoomScene() {
  return {
    room: { ...DEFAULT_ROOM },
    objects: INITIAL_OBJECTS.map((object) => structuredClone(object)),
    nextObjectId: 5,
    nextWindowId: 1,
  };
}

// ─── Room shape ───────────────────────────────────────────────────────────
// Rooms are a bounding box plus an optional floor shape:
//   { type: 'rect' } (default)
//   { type: 'L', cutWidth, cutDepth }  — removes the front-right corner
//   { type: 'rounded', radius }        — rounded corners; radius = half the short side gives a round/stadium room
export const ROOM_SHAPES = Object.freeze({ rect: 'Rectangle', L: 'L-shape', rounded: 'Rounded / round' });

export function roomShape(room) {
  const shape = room.shape ?? { type: 'rect' };
  if (shape.type === 'L') {
    return {
      type: 'L',
      cutWidth: Math.min(Math.max(0.5, shape.cutWidth ?? room.width / 2), room.width - 1),
      cutDepth: Math.min(Math.max(0.5, shape.cutDepth ?? room.depth / 2), room.depth - 1),
    };
  }
  if (shape.type === 'rounded') {
    return { type: 'rounded', radius: Math.min(Math.max(0.1, shape.radius ?? 0.8), Math.min(room.width, room.depth) / 2) };
  }
  return { type: 'rect' };
}

export function floorContains(room, x, z, margin = 0) {
  if (x < margin || z < margin || x > room.width - margin || z > room.depth - margin) return false;
  const shape = roomShape(room);
  if (shape.type === 'L') return !(x > room.width - shape.cutWidth - margin && z < shape.cutDepth + margin);
  if (shape.type === 'rounded') {
    const r = shape.radius;
    const cx = Math.min(Math.max(x, r), room.width - r);
    const cz = Math.min(Math.max(z, r), room.depth - r);
    return Math.hypot(x - cx, z - cz) <= r - margin;
  }
  return true;
}

// Counter-clockwise floor outline in room coordinates.
export function floorOutline(room, arcSegments = 10) {
  const { width: w, depth: d } = room;
  const shape = roomShape(room);
  if (shape.type === 'L') {
    return [[0, 0], [w - shape.cutWidth, 0], [w - shape.cutWidth, shape.cutDepth], [w, shape.cutDepth], [w, d], [0, d]];
  }
  if (shape.type === 'rounded') {
    const r = shape.radius;
    const points = [];
    const corners = [[w - r, r, -90], [w - r, d - r, 0], [r, d - r, 90], [r, r, 180]];
    for (const [cx, cz, start] of corners) {
      for (let step = 0; step <= arcSegments; step += 1) {
        const angle = (start + 90 * step / arcSegments) * Math.PI / 180;
        points.push([cx + r * Math.cos(angle), cz + r * Math.sin(angle)]);
      }
    }
    return points.filter((point, index) => index === 0 || Math.hypot(point[0] - points[index - 1][0], point[1] - points[index - 1][1]) > 1e-6);
  }
  return [[0, 0], [w, 0], [w, d], [0, d]];
}

// Straight stretch of each wall where openings can sit.
export function wallRange(room, wall) {
  const span = wall === 'back' || wall === 'front' ? room.width : room.depth;
  const shape = roomShape(room);
  if (shape.type === 'rounded') return [shape.radius, span - shape.radius];
  if (shape.type === 'L') {
    if (wall === 'front') return [0, room.width - shape.cutWidth];
    if (wall === 'right') return [shape.cutDepth, room.depth];
  }
  return [0, span];
}

export function setRoomShape(scene, shape) {
  const room = { ...scene.room, shape: { ...shape } };
  if (shape.type === 'rect') delete room.shape;
  const objects = scene.objects.map((object) => isWallItem(object) ? anchoredWindowPosition(object, object.position, room) : object);
  return { ...scene, room, objects };
}

function anchoredWindowPosition(object, position, room) {
  const wall = object.wall ?? 'back';
  const alongX = wall === 'back' || wall === 'front';
  const span = alongX ? room.width : room.depth;
  const dimensions = {
    ...object.dimensions,
    width: Math.min(object.dimensions.width, span - 0.2),
    height: Math.min(object.dimensions.height, room.height - 0.2),
  };
  const [rangeStart, rangeEnd] = wallRange(room, wall);
  if (rangeEnd - rangeStart < dimensions.width + 0.1) dimensions.width = Math.max(0.4, round(rangeEnd - rangeStart - 0.1));
  const halfWidth = dimensions.width / 2;
  const depthOffset = dimensions.depth / 2;
  const lo = Math.max(rangeStart, 0) + halfWidth;
  const hi = Math.min(rangeEnd, span) - halfWidth;
  const widthPosition = clampAndRound(position.x ?? object.position.x, Math.max(lo, halfWidth + (alongX ? 0 : depthOffset)), Math.max(lo, Math.min(hi, span - halfWidth - (alongX ? 0 : depthOffset))));
  const depthPosition = clampAndRound(position.z ?? object.position.z, lo, Math.max(lo, hi));
  return {
    ...object,
    dimensions,
    position: {
      x: alongX
        ? widthPosition
        : wall === 'left' ? depthOffset : room.width - depthOffset,
      y: object.model === 'door' ? 0 : clampAndRound(position.y ?? object.position.y, 0.1, room.height - dimensions.height - 0.1),
      z: alongX
        ? wall === 'front' ? depthOffset : room.depth - depthOffset
        : depthPosition,
    },
    rotation: { x: 0, y: wall === 'left' ? 90 : wall === 'right' ? -90 : wall === 'back' ? 180 : 0, z: 0 },
  };
}

export function addWindow(scene, wall = 'back', model = 'window') {
  if (!['back', 'front', 'left', 'right'].includes(wall)) throw new RangeError(`Unsupported window wall: ${wall}`);
  if (!isWallItem({ model })) throw new RangeError(`Not a wall opening: ${model}`);
  const idNumber = scene.nextWindowId ?? 1;
  const dimensions = { ...MODEL_PRESETS[model].dimensions };
  const label = model === 'door' ? 'Door' : 'Window';
  const object = anchoredWindowPosition({
    id: `${model}-${idNumber}`,
    primitive: 'box',
    model,
    name: `${label} ${idNumber}`,
    wall,
    open: false,
    dimensions,
    position: { x: scene.room.width / 2, y: 0.9, z: scene.room.depth - dimensions.depth / 2 },
    rotation: { x: 0, y: 0, z: 0 },
  }, {}, scene.room);
  return {
    object,
    scene: { ...scene, nextWindowId: idNumber + 1, objects: [...scene.objects, object] },
  };
}

export function setWindowOpen(scene, objectId, open) {
  const existing = scene.objects.find((object) => object.id === objectId);
  if (!isWallItem(existing)) throw new RangeError(`Unknown window: ${objectId}`);
  const updated = { ...existing, open: Boolean(open) };
  return {
    object: updated,
    scene: { ...scene, objects: scene.objects.map((object) => object.id === objectId ? updated : object) },
  };
}

export function setWindowWall(scene, objectId, wall) {
  const existing = scene.objects.find((object) => object.id === objectId);
  if (!isWallItem(existing)) throw new RangeError(`Unknown window: ${objectId}`);
  if (!['back', 'front', 'left', 'right'].includes(wall)) throw new RangeError(`Unsupported window wall: ${wall}`);
  const wasAlongX = existing.wall === 'back' || existing.wall === 'front';
  const isAlongX = wall === 'back' || wall === 'front';
  const position = wasAlongX === isAlongX ? existing.position : {
    ...existing.position,
    x: scene.room.width / 2,
    z: scene.room.depth / 2,
  };
  const updated = anchoredWindowPosition({ ...existing, wall }, position, scene.room);
  return {
    object: updated,
    scene: { ...scene, objects: scene.objects.map((object) => object.id === objectId ? updated : object) },
  };
}

export function addObject(scene, options = {}) {
  const { model = 'box', dimensions = MODEL_PRESETS[model]?.dimensions ?? DEFAULT_BOX_DIMENSIONS } = options;
  if (!MODEL_PRESETS[model]) throw new RangeError(`Unsupported object model: ${model}`);
  if (isWallItem({ model })) throw new RangeError('Use addWindow to place a window on a room wall.');

  const idNumber = scene.nextObjectId;
  const boxDimensions = { ...dimensions };
  const object = {
    id: `box-${idNumber}`,
    primitive: 'box',
    model,
    name: normalizeObjectName(options.name ?? (model === 'box' ? `Box ${idNumber}` : MODEL_PRESETS[model].label)),
    dimensions: boxDimensions,
    position: {
      x: clampAndRound(scene.room.width / 2 + ((idNumber % 3) - 1) * 0.52, boxDimensions.width / 2, scene.room.width - boxDimensions.width / 2),
      y: 0,
      z: clampAndRound(scene.room.depth / 2 + (idNumber % 2 ? 0.56 : -0.56), boxDimensions.depth / 2, scene.room.depth - boxDimensions.depth / 2),
    },
    rotation: { x: 0, y: 0, z: 0 },
  };
  if (model !== 'box') object.id = `${model}-${idNumber}`;
  // Mounted items start where they normally live.
  const mountedY = model === 'ceilingLight' ? scene.room.height - boxDimensions.height
    : model === 'ac' ? scene.room.height - boxDimensions.height - 0.25
      : model === 'router' ? 0.75 : null;
  if (mountedY !== null) object.position.y = Math.max(0, round(mountedY));
  if (model === 'ac') object.position.z = round(boxDimensions.depth / 2);
  let next = { ...scene, nextObjectId: idNumber + 1, objects: [...scene.objects, object] };
  if (options.position) return moveObject(next, object.id, options.position);
  return { object, scene: next };
}

export function setObjectModel(scene, objectId, model) {
  const existing = scene.objects.find((object) => object.id === objectId);
  if (!existing) throw new RangeError(`Unknown object: ${objectId}`);
  if (!MODEL_PRESETS[model]) throw new RangeError(`Unsupported object model: ${model}`);
  if (isWallItem({ model })) throw new RangeError('Use addWindow to place a window on a room wall.');
  const updated = { ...existing, primitive: 'box', model };
  const objects = scene.objects.map((object) => object.id === objectId ? updated : object);
  return { scene: { ...scene, objects }, object: updated };
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

export function rotationMatrixXYZ(rotation) {
  const x = rotation.x * Math.PI / 180;
  const y = rotation.y * Math.PI / 180;
  const z = rotation.z * Math.PI / 180;
  const cx = Math.cos(x);
  const sx = Math.sin(x);
  const cy = Math.cos(y);
  const sy = Math.sin(y);
  const cz = Math.cos(z);
  const sz = Math.sin(z);

  return [
    [cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx],
    [sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx],
    [-sy, cy * sx, cy * cx],
  ];
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
  const anchored = isWallItem(existing) ? anchoredWindowPosition(existing, position, scene.room) : moved;
  const objects = scene.objects.map((object) => object.id === objectId ? anchored : object);
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
  const objects = scene.objects.map((object) => isWallItem(object)
    ? anchoredWindowPosition(object, object.position, room)
    : { ...object, position: boundedPosition(object, object.position, room) });
  return { ...scene, room, objects };
}

export function resizeObject(scene, objectId, dimensions) {
  const existing = scene.objects.find((object) => object.id === objectId);
  if (!existing) throw new RangeError(`Unknown object: ${objectId}`);
  if (isWallItem(existing)) {
    const alongX = existing.wall === 'back' || existing.wall === 'front';
    const maxWidth = (alongX ? scene.room.width : scene.room.depth) - 0.2;
    const nextDimensions = { ...existing.dimensions, ...dimensions, depth: existing.dimensions.depth };
    if (nextDimensions.width < 0.4 || nextDimensions.width > maxWidth
      || nextDimensions.height < 0.4 || nextDimensions.height > scene.room.height - 0.2) {
      throw new RangeError('Window dimensions do not fit on this wall.');
    }
    const resized = anchoredWindowPosition({ ...existing, dimensions: nextDimensions }, existing.position, scene.room);
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
  return { scene: { ...scene, objects }, object: resized };
}

export function rotateObject(scene, objectId, rotation) {
  const existing = scene.objects.find((object) => object.id === objectId);
  if (!existing) throw new RangeError(`Unknown object: ${objectId}`);
  if (isWallItem(existing)) return { scene, object: existing };
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
  return { scene: { ...scene, objects }, object: rotated };
}

export function removeObject(scene, objectId) {
  if (!scene.objects.some((object) => object.id === objectId)) throw new RangeError(`Unknown object: ${objectId}`);
  return { ...scene, objects: scene.objects.filter((object) => object.id !== objectId) };
}

function updateObject(scene, objectId, patch) {
  const existing = scene.objects.find((object) => object.id === objectId);
  if (!existing) throw new RangeError(`Unknown object: ${objectId}`);
  const updated = { ...existing, ...patch(existing) };
  return { scene: { ...scene, objects: scene.objects.map((object) => object.id === objectId ? updated : object) }, object: updated };
}

export function setObjectMaterial(scene, objectId, material) {
  return updateObject(scene, objectId, () => ({ material }));
}

export function setObjectProp(scene, objectId, key, value) {
  if (!Number.isFinite(value)) throw new RangeError(`${key} must be a number.`);
  return updateObject(scene, objectId, (existing) => ({ props: { ...(existing.props ?? {}), [key]: value } }));
}

export function setSurfaceMaterial(scene, surface, material) {
  return { ...scene, surfaces: { ...(scene.surfaces ?? {}), [surface]: material } };
}

export function duplicateObject(scene, objectId) {
  const existing = scene.objects.find((object) => object.id === objectId);
  if (!existing) throw new RangeError(`Unknown object: ${objectId}`);
  if (isWallItem(existing)) {
    const result = addWindow(scene, existing.wall, existing.model);
    return moveObject(result.scene, result.object.id, { x: existing.position.x + 0.3, z: existing.position.z + 0.3, y: existing.position.y });
  }
  const idNumber = scene.nextObjectId;
  const copy = structuredClone(existing);
  copy.id = `${existing.model}-${idNumber}-${Date.now().toString(36).slice(-3)}`;
  copy.name = normalizeObjectName(`${existing.name.replace(/ copy( \d+)?$/, '')} copy`.slice(0, 80));
  const next = { ...scene, nextObjectId: idNumber + 1, objects: [...scene.objects, copy] };
  return moveObject(next, copy.id, { x: existing.position.x + 0.3, z: existing.position.z + 0.3 });
}

// Accepts a scene from storage or a file and fills anything a newer version expects.
export function normalizeScene(input) {
  if (!input?.room || !Array.isArray(input.objects)) throw new TypeError('Not a RoomShift scene.');
  const room = resizeRoom({ room: { ...DEFAULT_ROOM }, objects: [] }, {
    width: Number(input.room.width), depth: Number(input.room.depth), height: Number(input.room.height),
  }).room;
  const objects = input.objects
    .filter((object) => MODEL_PRESETS[object?.model] && object.dimensions && object.position)
    .map((object) => ({ primitive: 'box', rotation: { x: 0, y: 0, z: 0 }, ...object }));
  const count = objects.length + 1;
  return {
    ...input,
    room,
    objects,
    nextObjectId: Math.max(Number(input.nextObjectId) || 0, count),
    nextWindowId: Math.max(Number(input.nextWindowId) || 0, count),
  };
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round = (value) => Number(value.toFixed(2));
const clampAndRound = (value, min, max) => clamp(round(clamp(value, min, max)), min, max);
