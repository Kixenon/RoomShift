import assert from 'node:assert/strict';
import test from 'node:test';
import { createRoomScene } from '../src/model/room-scene.js';
import { estimateRoomLight } from '../src/simulation/room-light.js';

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

test('lamp orientation changes the light field direction', () => {
  const downward = estimateRoomLight({ ...emptyRoom(), objects: [lampAt(2.6, 0.3, 2)] });
  const upward = estimateRoomLight({ ...emptyRoom(), objects: [lampAt(2.6, 0.3, 2, { x: 180, y: 0, z: 0 })] });
  const below = fieldIndex(downward.grid, 2.6, 0.675, 2);
  const above = fieldIndex(upward.grid, 2.6, 2.25, 2);

  assert.ok(downward.fields.light[below] > upward.fields.light[below]);
  assert.ok(upward.fields.light[above] > downward.fields.light[above]);
});

test('solid furniture blocks direct light behind it', () => {
  const lamp = lampAt(2.6, 0.3, 2);
  const obstacle = {
    id: 'screen', primitive: 'box', model: 'box', name: 'Screen',
    position: { x: 2.6, y: 0.8, z: 2 }, rotation: { x: 0, y: 0, z: 0 },
    dimensions: { width: 0.6, height: 0.3, depth: 0.6 },
  };
  const clear = estimateRoomLight({ ...emptyRoom(), objects: [lamp] });
  const blocked = estimateRoomLight({ ...emptyRoom(), objects: [lamp, obstacle] });
  const point = fieldIndex(clear.grid, 2.6, 0.675, 2);

  assert.ok(blocked.fields.light[point] < clear.fields.light[point] * 0.3);
});

test('light estimate rejects an unsupported room and non-finite options', () => {
  assert.throws(() => estimateRoomLight({ ...emptyRoom(), room: { width: 21, depth: 4, height: 2.7 } }), RangeError);
  assert.throws(() => estimateRoomLight(emptyRoom(), { cellSize: 0.005 }), RangeError);
  assert.throws(() => estimateRoomLight(emptyRoom(), { ambientLevel: NaN }), RangeError);
});
