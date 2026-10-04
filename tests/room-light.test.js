import assert from 'node:assert/strict';
import test from 'node:test';
import { addWindow, createRoomScene, setWindowOpen } from '../src/model/room-scene.js';
import { directLux, estimateRoomLight, indirectLux, lightContext } from '../src/simulation/room-light.js';

const UP = { x: 0, y: 1, z: 0 };
const DOWN = { x: 0, y: -1, z: 0 };
// Lamps only, so the direct-light checks are not muddied by daylight.
const NIGHT = { sun: { direction: { x: 0, y: -1, z: 0 }, altitude: -10, daylight: 0 } };
const DAY = { sun: { direction: { x: 0, y: 0.5, z: -0.866 }, altitude: 30, daylight: 1 } };

function roomWithWindow(open) {
  const placed = addWindow(emptyRoom(), 'back');
  return setWindowOpen(placed.scene, placed.object.id, open).scene;
}

function emptyRoom() {
  return { ...createRoomScene(), objects: [] };
}

function fieldIndex(grid, x, y, z) {
  const i = Math.min(grid.nx - 1, Math.floor(x / grid.dx));
  const j = Math.min(grid.ny - 1, Math.floor(y / grid.dy));
  const k = Math.min(grid.nz - 1, Math.floor(z / grid.dz));
  return (j * grid.nz + k) * grid.nx + i;
}

function lampAt(x, y, z, rotation = { x: 0, y: 0, z: 0 }) {
  return {
    id: 'lamp-1', primitive: 'box', model: 'lamp', name: 'Lamp',
    position: { x, y, z }, rotation,
    dimensions: { width: 0.32, height: 1.55, depth: 0.32 },
  };
}

test('the sample room includes an active lamp for its initial light estimate', () => {
  const result = estimateRoomLight(createRoomScene());

  assert.equal(result.stats.sourceCount, 1);
  assert.ok(result.stats.maxLevel > result.ambientLevel + 0.05);
});

test('light estimate resolves the default room at five centimetres', () => {
  const result = estimateRoomLight(emptyRoom());
  const { nx, ny, nz, dx, dy, dz } = result.grid;
  const cellCount = nx * ny * nz;

  assert.equal(result.grid.cellSize, 0.05);
  assert.deepEqual([nx, ny, nz], [104, 54, 80]);
  assert.equal(cellCount, 449_280);
  assert.ok(nx > 1 && ny > 1 && nz > 1);
  assert.ok(Math.abs(dx * nx - 5.2) < 1e-10);
  assert.ok(Math.abs(dy * ny - 2.7) < 1e-10);
  assert.ok(Math.abs(dz * nz - 4) < 1e-10);
  assert.equal(result.fields.light.length, cellCount);
  assert.ok(Array.from(result.fields.light).every((value) => Math.abs(value - result.ambientLevel) < 1e-6));
  assert.equal(result.stats.sourceCount, 0);
  assert.equal(result.stats.maxLevel, result.ambientLevel);
});

test('a lamp produces directional falloff that is strongest below the source', () => {
  const scene = { ...emptyRoom(), objects: [lampAt(2.6, 0.3, 2)] };
  const result = estimateRoomLight(scene);
  const below = result.fields.light[fieldIndex(result.grid, 2.6, 1.125, 2)];
  const above = result.fields.light[fieldIndex(result.grid, 2.6, 2.25, 2)];
  const far = result.fields.light[fieldIndex(result.grid, 0.5, 0.675, 0.5)];

  assert.ok(below > result.ambientLevel + 0.25);
  assert.ok(below > above);
  assert.ok(below > far);
  assert.ok(Array.from(result.fields.light).every((value) => Number.isFinite(value) && value >= 0 && value <= 1));
  assert.equal(result.stats.sourceCount, 1);
  const maximum = result.fields.light.reduce((value, level) => Math.max(value, level), -Infinity);
  assert.ok(Math.abs(result.stats.maxLevel - maximum) < 0.001);
});

test('lamp orientation steers the light it emits', () => {
  const downward = lightContext({ ...emptyRoom(), objects: [lampAt(2.6, 0.3, 2)] }, NIGHT);
  const upward = lightContext({ ...emptyRoom(), objects: [lampAt(2.6, 0.3, 2, { x: 180, y: 0, z: 0 })] }, NIGHT);
  const below = { x: 2.6, y: 0.5, z: 2 };
  const above = { x: 2.6, y: 2.4, z: 2 };

  assert.ok(directLux(downward, below, UP) > 0, 'a downward lamp lights the floor');
  assert.equal(directLux(upward, below, UP), 0, 'a lamp aimed at the ceiling does not light the floor');
  assert.ok(directLux(upward, above, DOWN) > 0, 'an upward lamp lights the ceiling');
  assert.equal(directLux(downward, above, DOWN), 0, 'a downward lamp does not light the ceiling');
});

test('solid furniture blocks direct light behind it', () => {
  const lamp = lampAt(2.6, 0.3, 2);
  const obstacle = {
    id: 'screen', primitive: 'box', model: 'box', name: 'Screen',
    position: { x: 2.6, y: 0.8, z: 2 }, rotation: { x: 0, y: 0, z: 0 },
    dimensions: { width: 0.6, height: 0.3, depth: 0.6 },
  };
  const clear = lightContext({ ...emptyRoom(), objects: [lamp] }, NIGHT);
  const blocked = lightContext({ ...emptyRoom(), objects: [lamp, obstacle] }, NIGHT);
  const point = { x: 2.6, y: 0.5, z: 2 };

  assert.ok(directLux(clear, point, UP) > 0);
  assert.equal(directLux(blocked, point, UP), 0, 'the screen hides the lamp from the point behind it');
  // The radiosity bounce still reaches the point, so the room does not go black
  // behind furniture even though the direct beam is blocked.
  assert.ok(indirectLux(clear, point, UP) > 0);
});

test('an open window lights the room with diffuse sky', () => {
  const closed = lightContext(roomWithWindow(false), DAY);
  const open = lightContext(roomWithWindow(true), DAY);
  const window = open.windows[0];
  const point = { x: window.centre.x, y: 0.4, z: window.centre.z - 2 };

  assert.ok(directLux(closed, point, UP) > 0, 'even a closed window passes diffuse sky');
  assert.ok(directLux(open, point, UP) > directLux(closed, point, UP), 'opening the window admits more sky');
  assert.ok(indirectLux(open, point, UP) > 0, 'sky-lit surfaces re-emit into the room around them');
});

test('light estimate rejects an unsupported room and non-finite options', () => {
  assert.throws(() => estimateRoomLight({ ...emptyRoom(), room: { width: 21, depth: 4, height: 2.7 } }), RangeError);
  assert.throws(() => estimateRoomLight(emptyRoom(), { cellSize: 0.005 }), RangeError);
  assert.throws(() => estimateRoomLight(emptyRoom(), { ambientLevel: NaN }), RangeError);
});
