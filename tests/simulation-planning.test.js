import assert from 'node:assert/strict';
import test from 'node:test';
import { addWindow, createRoomScene } from '../src/model/room-scene.js';
import { objectParts } from '../src/model/object-parts.js';
import { buildFanAccelerationField, buildGrid, buildHeatRate, buildSolidMask, buildWindowBoundary, createRoomFieldsSession, simulateRoomFields } from '../src/simulation/room-fields-3d.js';
import { RoomFieldSolver } from '../src/simulation/room-field-backend.js';
import { compareRoomFields, sampleRoomFields } from '../src/simulation/room-field-analysis.js';
import { readWorkspace, writeWorkspace } from '../src/model/scenarios.js';

const empty = () => ({ ...createRoomScene(), room: { width: 2, height: 2, depth: 2, outdoorTemperature: 20, envelopeUValue: 0 }, objects: [] });
const index = (grid, x, y, z) => (Math.floor(y / grid.dy) * grid.nz + Math.floor(z / grid.dz)) * grid.nx + Math.floor(x / grid.dx);

test('a rendered desk and its airflow obstacle share an open underside and solid top', () => {
  const scene = empty();
  const desk = { ...createRoomScene().objects.find((object) => object.model === 'desk'), position: { x: 1, y: 0, z: 1 } };
  const grid = buildGrid(scene.room, 0.15);
  const solid = buildSolidMask({ ...scene, objects: [desk] }, grid);
  assert.ok(objectParts('desk', desk.dimensions).length >= 5);
  assert.equal(solid[index(grid, 1, 0.3, 1)], 0);
  assert.equal(solid[index(grid, 1, 0.72, 1)], 1);
});

test('heater source integrates to the specified watts on different grids', () => {
  const scene = empty();
  scene.objects = [{ ...createRoomScene().objects.find((object) => object.model === 'heater'), position: { x: 1, y: 0, z: 1 }, powerWatts: 1000 }];
  for (const cellSize of [0.15, 0.25, 0.5]) {
    const grid = buildGrid(scene.room, cellSize), solid = buildSolidMask(scene, grid);
    const rate = buildHeatRate(scene, grid, solid);
    const watts = rate.reduce((total, value) => total + value * grid.dx * grid.dy * grid.dz * 1.204 * 1006, 0);
    assert.ok(Math.abs(watts - 1000) < 0.01, `${cellSize}: ${watts}`);
  }
});

test('exchange has no prescribed pressure when inside and outside temperatures match', () => {
  const scene = addWindow(empty(), 'front').scene;
  const grid = buildGrid(scene.room, 0.25);
  const boundary = buildWindowBoundary(scene, grid);
  assert.ok(boundary.outlets.some(Boolean));
  assert.ok(boundary.pressure.every((value) => value === 0));
});

test('subzero outside air is retained and a closed envelope can exchange heat', () => {
  const scene = { ...addWindow(empty(), 'front').scene, room: { ...empty().room, outdoorTemperature: -10, envelopeUValue: 0.7 } };
  const result = simulateRoomFields(scene, { steps: 10, cellSize: 0.25 });
  assert.equal(result.stats.minTemperature, -10);
  const closed = simulateRoomFields({ ...scene, objects: [] }, { steps: 10, cellSize: 0.25 });
  assert.ok(closed.stats.minTemperature < 20);
});

test('advancing resident state matches solving directly to the same time and snapshots remain independent', async () => {
  const scene = empty();
  scene.objects = [{ ...createRoomScene().objects[0], position: { x: 1, y: 0, z: 1 } }];
  const session = createRoomFieldsSession(scene, { cellSize: 0.25 });
  const early = await session.advanceTo(0.5);
  const saved = early.fields.w.slice();
  const late = await session.advanceTo(1);
  const direct = simulateRoomFields(scene, { cellSize: 0.25, steps: 20 });
  for (const key of ['u', 'v', 'w', 'temperature']) assert.deepEqual(late.fields[key], direct.fields[key]);
  assert.deepEqual(early.fields.w, saved);
  assert.equal(late.durationSeconds, 1);
  await assert.rejects(session.advanceTo(0.5), /forward/);
});

test('solver caches identical time points across air and heat modes and honors cancellation', async () => {
  const solver = new RoomFieldSolver({ gpu: null });
  const scene = empty();
  const progress = [];
  const result = await solver.solve(scene, 'airflow', { durationSeconds: 1, cellSize: 0.25, onProgress: (value) => progress.push(value.durationSeconds) });
  assert.deepEqual(progress, [0.5]);
  assert.equal(await solver.solve(scene, 'temperature', { durationSeconds: 1, cellSize: 0.25 }), result);
  assert.equal(await solver.solve(scene, 'airflow', { durationSeconds: 2, cellSize: 0.25, isCancelled: () => true }), null);
  assert.equal((await solver.solve(scene, 'airflow', { durationSeconds: 0.51, cellSize: 0.25 })).durationSeconds, 0.5);
  solver.dispose();
});

test('comparison refuses different grids or times and reports obstruction instead of a false improvement', () => {
  const result = simulateRoomFields(empty(), { steps: 1, cellSize: 0.25 });
  const point = { x: 1, y: 1, z: 1 };
  assert.equal(compareRoomFields(result, { ...result, durationSeconds: 1 }, point).comparable, false);
  assert.equal(compareRoomFields(result, result, point).speedDelta, 0);
  result.fields.solid[index(result.grid, 1, 1, 1)] = 1;
  assert.deepEqual(sampleRoomFields(result, point), { solid: true });
});

test('workspace saves scenes and rejects malformed or unsupported data', () => {
  let value;
  const storage = { getItem: () => value, setItem: (_, next) => value = next };
  writeWorkspace(storage, { scene: empty(), baseline: empty(), scenarios: [{ name: 'Before', scene: empty() }] });
  assert.equal(readWorkspace(storage).scenarios[0].name, 'Before');
  value = JSON.stringify({ version: 2, scene: empty(), scenarios: [] });
  assert.equal(readWorkspace(storage), null);
  value = JSON.stringify({ version: 1, scene: { room: { width: NaN }, objects: [] }, scenarios: [] });
  assert.equal(readWorkspace(storage), null);
});

test('halving the time step does not erase the fan jet through repeated averaging', () => {
  const scene = empty();
  scene.objects = [{ ...createRoomScene().objects[0], position: { x: 1, y: 0, z: 1.7 }, rotation: { x: 0, y: 180, z: 0 } }];
  const point = { x: 1, y: 1, z: 0.8 };
  const speed = (timeStep) => sampleRoomFields(simulateRoomFields(scene, { timeStep, steps: Math.round(3 / timeStep) }), point).speed;
  const coarse = speed(0.05), fine = speed(0.025);
  assert.ok(Math.abs(coarse - fine) / fine < 0.06, `${coarse} vs ${fine}`);
});


test('merged ceiling fan and AC drive the shared physical solver', () => {
  const scene = empty();
  const ceiling = { ...createRoomScene().objects.find((object) => object.model === 'ceiling-fan'), position: { x: 1, y: 1.68, z: 1 } };
  const ac = { ...createRoomScene().objects.find((object) => object.model === 'air-conditioner'), position: { x: 1, y: 1.5, z: 1.8 }, powerWatts: 1000 };
  scene.objects = [ceiling, ac];
  const grid = buildGrid(scene.room, 0.25), solid = buildSolidMask(scene, grid);
  const force = buildFanAccelerationField(scene, grid, solid);
  assert.ok(force.some((value, index) => index % 4 === 1 && value < 0));
  const watts = buildHeatRate(scene, grid, solid).reduce((sum, value) => sum + value * grid.dx * grid.dy * grid.dz * 1.204 * 1006, 0);
  assert.ok(Math.abs(watts + 1000) < 0.01);
});

test('merged Wi-Fi mode responds to routers and supports both display styles', async () => {
  const solver = new RoomFieldSolver({ gpu: null });
  try {
    const scene = empty();
    const off = await solver.solve(scene, 'wifi');
    assert.equal(off.stats.routerCount, 0);
    scene.objects = [{ ...createRoomScene().objects.find((object) => object.model === 'router'), position: { x: 1, y: 1, z: 1 } }];
    const on = await solver.solve(scene, 'wifi');
    assert.equal(on.stats.routerCount, 1);
    assert.ok(on.stats.maxWifiDbm > off.stats.maxWifiDbm);
    const { createRoomFieldLayer } = await import('../src/scene/room-field-layer-3d.js');
    for (const displayStyle of ['slice', 'volume']) assert.ok(createRoomFieldLayer(on, 'wifi', scene, { displayStyle }).children.length);
  } finally { solver.dispose(); }
});
