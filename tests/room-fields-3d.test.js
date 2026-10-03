import assert from 'node:assert/strict';
import test from 'node:test';
import { createRoomScene } from '../src/model/room-scene.js';
import { simulateRoomFields } from '../src/simulation/room-fields-3d.js';

function sceneWithoutSources() {
  const scene = createRoomScene();
  return {
    ...scene,
    objects: scene.objects.filter((object) => !['fan', 'heater', 'lamp'].includes(object.model)),
  };
}

function fieldIndex(grid, x, y, z) {
  const i = Math.min(grid.nx - 1, Math.floor(x / grid.dx));
  const j = Math.min(grid.ny - 1, Math.floor(y / grid.dy));
  const k = Math.min(grid.nz - 1, Math.floor(z / grid.dz));
  return (j * grid.nz + k) * grid.nx + i;
}

test('an unforced room has a bounded 3D metre grid and remains at ambient temperature', () => {
  const result = simulateRoomFields(sceneWithoutSources(), { steps: 4 });
  const { nx, ny, nz, dx, dy, dz } = result.grid;
  const { u, v, w, temperature, solid } = result.fields;
  const cellCount = nx * ny * nz;

  assert.equal(result.grid.cellSize, 0.15);
  assert.ok(nx > 1 && ny > 1 && nz > 1);
  assert.ok(Math.abs(dx * nx - 5.2) < 1e-10);
  assert.ok(Math.abs(dy * ny - 2.7) < 1e-10);
  assert.ok(Math.abs(dz * nz - 4) < 1e-10);
  assert.deepEqual([u.length, v.length, w.length, temperature.length, solid.length], Array(5).fill(cellCount));
  assert.ok(Array.from(u).every((value) => value === 0));
  assert.ok(Array.from(v).every((value) => value === 0));
  assert.ok(Array.from(w).every((value) => value === 0));
  assert.ok(Array.from(temperature).every((value) => value === result.ambientTemperature));
  assert.equal(result.stats.maxSpeed, 0);
  assert.equal(result.stats.rmsDivergence, 0);
  assert.equal(result.grid.sliceHeight, undefined);
});

test('an angled fan drives a 3D field in its facing direction', () => {
  const template = createRoomScene().objects.find((object) => object.model === 'fan');
  const fan = { ...template, position: { x: 2.6, y: 0, z: 2 }, rotation: { x: 0, y: 90, z: 0 } };
  const result = simulateRoomFields({ ...sceneWithoutSources(), objects: [fan] });
  const downstream = result.fields.u[fieldIndex(result.grid, 3.1, 1, 2)];

  assert.ok(result.stats.maxSpeed > 0.1);
  assert.ok(downstream > 0.05, `downstream velocity was ${downstream} m/s`);
  assert.ok(result.stats.maxSpeed <= 2.5);
  assert.ok(result.stats.rmsDivergence < 1);
});

test('a fan pointed directly at a nearby wall retains a visible near-wall flow', () => {
  const template = createRoomScene().objects.find((object) => object.model === 'fan');
  const fan = { ...template, position: { x: 0.82, y: 0, z: 3.79 }, rotation: { x: 0, y: 0, z: 0 } };
  const result = simulateRoomFields({ ...sceneWithoutSources(), objects: [fan] });

  assert.ok(result.stats.maxSpeed > 0.05,
    `near-wall fan flow collapsed to ${result.stats.maxSpeed} m/s`);
});

test('the airflow field follows full object rotation, including vertical fan orientation', () => {
  const template = createRoomScene().objects.find((object) => object.model === 'fan');
  const fan = { ...template, position: { x: 2.6, y: 0, z: 2 }, rotation: { x: -90, y: 0, z: 0 } };
  const result = simulateRoomFields({ ...sceneWithoutSources(), objects: [fan] });
  const aboveFan = result.fields.v[fieldIndex(result.grid, 2.6, 1.35, 2)];

  assert.ok(aboveFan > 0.05, `vertical airflow was ${aboveFan} m/s`);
});

test('closed outer walls enforce zero normal velocity on every face', () => {
  const template = createRoomScene().objects.find((object) => object.model === 'fan');
  const fan = { ...template, position: { x: 0.3, y: 0, z: 2 }, rotation: { x: 0, y: 90, z: 0 } };
  const result = simulateRoomFields({ ...sceneWithoutSources(), objects: [fan] });
  const { nx, ny, nz } = result.grid;
  const { u, v, w } = result.fields;
  const normalVelocities = [];

  for (let j = 0; j < ny; j += 1) {
    for (let k = 0; k < nz; k += 1) {
      normalVelocities.push(u[(j * nz + k) * nx], u[(j * nz + k) * nx + nx - 1]);
    }
  }
  for (let k = 0; k < nz; k += 1) {
    for (let i = 0; i < nx; i += 1) {
      normalVelocities.push(v[(k * nx) + i], v[(((ny - 1) * nz + k) * nx) + i]);
    }
  }
  for (let j = 0; j < ny; j += 1) {
    for (let i = 0; i < nx; i += 1) {
      normalVelocities.push(w[(j * nz) * nx + i], w[(j * nz + nz - 1) * nx + i]);
    }
  }
  assert.ok(normalVelocities.every((velocity) => Math.abs(velocity) < 1e-8));
});

test('box obstacles occupy 3D voxels while the surrounding air remains fluid', () => {
  const obstacle = {
    id: 'obstacle', primitive: 'box', model: 'box', name: 'Obstacle',
    position: { x: 2.6, y: 0.8, z: 2 }, rotation: { x: 0, y: 0, z: 0 },
    dimensions: { width: 0.6, height: 0.6, depth: 0.6 },
  };
  const result = simulateRoomFields({ ...sceneWithoutSources(), objects: [obstacle] }, { steps: 1 });

  assert.equal(result.fields.solid[fieldIndex(result.grid, 2.6, 1.125, 2)], 1);
  assert.equal(result.fields.solid[fieldIndex(result.grid, 1.6, 0.675, 2)], 0);
});

test('a heater creates a local bounded temperature rise in the 3D field', () => {
  const heater = {
    id: 'heater-5', primitive: 'box', model: 'heater', name: 'Heater',
    position: { x: 2.6, y: 0.4, z: 2 }, rotation: { x: 0, y: 0, z: 0 },
    dimensions: { width: 0.4, height: 0.4, depth: 0.4 },
  };
  const result = simulateRoomFields({ ...sceneWithoutSources(), objects: [heater] });
  const near = result.fields.temperature[fieldIndex(result.grid, 2.6, 0.9, 2)];
  const far = result.fields.temperature[fieldIndex(result.grid, 0.5, 2.2, 0.5)];

  assert.ok(near > result.ambientTemperature + 0.1);
  assert.ok(near > far);
  assert.ok(result.fields.temperature.every((value) => Number.isFinite(value) && value >= 0 && value <= 60));
});

test('the sample room has a heater so its initial temperature field varies', () => {
  const result = simulateRoomFields(createRoomScene(), { steps: 4 });

  assert.ok(result.stats.maxTemperature > result.ambientTemperature);
});

test('maximum room/grid work is bounded and all returned fields stay finite', () => {
  const room = { ...sceneWithoutSources(), room: { width: 20, depth: 20, height: 6 }, objects: [] };
  const result = simulateRoomFields(room, {
    cellSize: 0.25, steps: 40, pressureIterations: 12, timeStep: 0.05,
    kinematicViscosity: 0.05, effectiveThermalDiffusivity: 0.05,
  });

  assert.ok(result.grid.nx <= 40 && result.grid.ny <= 24 && result.grid.nz <= 40);
  assert.ok(result.fields.u.length <= 38_400);
  for (const field of [result.fields.u, result.fields.v, result.fields.w, result.fields.temperature]) {
    assert.ok(Array.from(field).every(Number.isFinite));
  }
  assert.throws(() => simulateRoomFields(room, { steps: 241 }), /steps/i);
  assert.throws(() => simulateRoomFields(room, { cellSize: 0.1 }), /cell size/i);
});

test('invalid physical coefficients are rejected before field integration', () => {
  const base = sceneWithoutSources();
  const invalidOptions = [
    { timeStep: Infinity }, { timeStep: -0.01 }, { timeStep: 0.051 },
    { cellSize: NaN }, { kinematicViscosity: Infinity }, { kinematicViscosity: -0.01 },
    { effectiveThermalDiffusivity: Infinity }, { effectiveThermalDiffusivity: -0.01 },
    { coolingRate: NaN }, { coolingRate: -0.01 }, { fanAcceleration: -0.01 },
    { fanRange: 0 }, { heaterRate: Infinity }, { heaterRadius: 0 },
    { ambientTemperature: 41 },
  ];

  for (const options of invalidOptions) {
    assert.throws(() => simulateRoomFields(base, { ...options, steps: 1 }), RangeError,
      `expected invalid options ${JSON.stringify(options)} to be rejected`);
  }
});

test('a completely solid room returns finite ambient statistics', () => {
  const scene = {
    ...sceneWithoutSources(),
    room: { width: 2, depth: 2, height: 2 },
    objects: [{
      id: 'full-room', primitive: 'box', model: 'box', name: 'Full room',
      position: { x: 1, y: 0, z: 1 }, rotation: { x: 0, y: 0, z: 0 },
      dimensions: { width: 2, height: 2, depth: 2 },
    }],
  };
  const result = simulateRoomFields(scene, { steps: 1 });

  assert.equal(result.stats.fluidCells, 0);
  assert.equal(result.stats.solidCells, result.fields.solid.length);
  assert.ok(Number.isFinite(result.stats.meanTemperature));
  assert.equal(result.stats.maxTemperature, result.ambientTemperature);
});
