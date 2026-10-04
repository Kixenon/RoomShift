import assert from 'node:assert/strict';
import test from 'node:test';
import { addWindow, createRoomScene } from '../src/model/room-scene.js';
import { simulateRoomFields } from '../src/simulation/room-fields-3d.js';

function emptyRoomScene() {
  return { ...createRoomScene(), room: { ...createRoomScene().room, outdoorTemperature: 20 }, objects: [], nextWindowId: 1, nextDoorId: 1 };
}

function fieldIndex(grid, x, y, z) {
  const i = Math.min(grid.nx - 1, Math.floor(x / grid.dx));
  const j = Math.min(grid.ny - 1, Math.floor(y / grid.dy));
  const k = Math.min(grid.nz - 1, Math.floor(z / grid.dz));
  return (j * grid.nz + k) * grid.nx + i;
}

test('an unforced room has a bounded 3D metre grid and remains at ambient temperature', () => {
  const result = simulateRoomFields(emptyRoomScene(), { steps: 4 });
  const { nx, ny, nz, dx, dy, dz } = result.grid;
  const { u, v, w, temperature, solid } = result.fields;
  const cellCount = nx * ny * nz;

  assert.equal(result.grid.cellSize, Math.max(dx, dy, dz));
  assert.equal(result.grid.requestedCellSize, 0.15);
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

test('an open window cools the room more than envelope conduction alone', () => {
  const base = { ...emptyRoomScene(), room: { ...emptyRoomScene().room, outdoorTemperature: 10 } };
  const closed = simulateRoomFields(base, { steps: 20 });
  assert.ok(closed.stats.minTemperature < closed.ambientTemperature);

  const placed = addWindow(base, 'front');
  const window = { ...placed.object, open: true, flowDirection: 'inlet', flowRate: 0.8 };
  const openScene = {
    ...placed.scene,
    objects: placed.scene.objects.map((object) => object.id === window.id ? window : object),
  };
  const open = simulateRoomFields(openScene, { steps: 20 });

  assert.equal(open.stats.minTemperature, open.outdoorTemperature);
  assert.ok(open.stats.meanTemperature < closed.stats.meanTemperature);
});

test('an angled fan drives a 3D field in its facing direction', () => {
  const template = createRoomScene().objects.find((object) => object.model === 'fan');
  const fan = { ...template, position: { x: 2.6, y: 0, z: 2 }, rotation: { x: 0, y: 90, z: 0 } };
  const result = simulateRoomFields({ ...emptyRoomScene(), objects: [fan] });
  const downstream = result.fields.u[fieldIndex(result.grid, 3.1, 1, 2)];

  assert.ok(result.stats.maxSpeed > 0.1);
  assert.ok(downstream > 0.05, `downstream velocity was ${downstream} m/s`);
  assert.ok(result.stats.maxSpeed <= 2.5);
  assert.ok(result.stats.rmsDivergence < 1);
});

test('fan airflow redistributes heat away from a heater', () => {
  const template = createRoomScene();
  const base = emptyRoomScene();
  const fan = {
    ...template.objects.find((object) => object.model === 'fan'),
    position: { x: 0.82, y: 0, z: 3.15 },
    rotation: { x: 0, y: 180, z: 0 },
  };
  const heater = {
    ...template.objects.find((object) => object.model === 'heater'),
    position: { x: 0.55, y: 0, z: 1.9 },
  };
  const scene = { ...base, objects: [fan, heater] };
  const active = simulateRoomFields(scene, { steps: 120 });
  const still = simulateRoomFields({
    ...scene,
    objects: [{ ...fan, enabled: false }, heater],
  }, { steps: 120 });
  let maximumDifference = 0;
  let affectedCells = 0;
  for (let index = 0; index < active.fields.temperature.length; index += 1) {
    const difference = Math.abs(active.fields.temperature[index] - still.fields.temperature[index]);
    maximumDifference = Math.max(maximumDifference, difference);
    if (difference > 0.01) affectedCells += 1;
  }

  assert.ok(maximumDifference > 0.35,
    `fan changed temperature by at most ${maximumDifference.toFixed(3)} °C`);
  assert.ok(affectedCells > 1000, `fan affected only ${affectedCells} cells`);
});

test('a fan pointed directly at a nearby wall retains a visible near-wall flow', () => {
  const template = createRoomScene().objects.find((object) => object.model === 'fan');
  const fan = { ...template, position: { x: 0.82, y: 0, z: 3.79 }, rotation: { x: 0, y: 0, z: 0 } };
  const result = simulateRoomFields({ ...emptyRoomScene(), objects: [fan] });

  assert.ok(result.stats.maxSpeed > 0.05,
    `near-wall fan flow collapsed to ${result.stats.maxSpeed} m/s`);
});

test('a corner-facing fan deflects flow along both adjoining walls', () => {
  const base = emptyRoomScene();
  const template = createRoomScene().objects.find((object) => object.model === 'fan');
  const fan = { ...template, position: { x: 0.82, y: 0, z: 0.82 }, rotation: { x: 0, y: -135, z: 0 } };
  const result = simulateRoomFields({ ...base, objects: [fan] });
  let xWallCells = 0;
  let zWallCells = 0;
  for (let j = 0; j < result.grid.ny; j += 1) {
    for (let k = 0; k < result.grid.nz; k += 1) {
      for (let i = 0; i < result.grid.nx; i += 1) {
        const index = (j * result.grid.nz + k) * result.grid.nx + i;
        if (result.fields.solid[index]) continue;
        if (i < 2 && Math.abs(result.fields.w[index]) > 0.05) xWallCells += 1;
        if (k < 2 && Math.abs(result.fields.u[index]) > 0.05) zWallCells += 1;
      }
    }
  }

  assert.ok(xWallCells > 10 && zWallCells > 10,
    `tangential flow should reach both walls, got ${xWallCells} and ${zWallCells} cells`);
  assert.equal(result.stats.maxClosedWallNormalSpeed, 0);
});

test('a fan jet develops a measurable 3D wake behind an obstacle', () => {
  const base = emptyRoomScene();
  const template = createRoomScene().objects.find((object) => object.model === 'fan');
  const fan = { ...template, position: { x: 2.6, y: 0, z: 3.55 }, rotation: { x: 0, y: 180, z: 0 } };
  const obstacle = {
    id: 'wake-obstacle', primitive: 'box', model: 'box', name: 'Wake obstacle',
    position: { x: 2.6, y: 0, z: 2.55 }, rotation: { x: 0, y: 0, z: 0 },
    dimensions: { width: 1.2, height: 1.4, depth: 0.2 },
  };
  const result = simulateRoomFields({ ...base, objects: [fan, obstacle] });
  let maximumWakeSpeed = 0;
  for (let j = 0; j < result.grid.ny; j += 1) {
    for (let k = 0; k < result.grid.nz; k += 1) {
      for (let i = 0; i < result.grid.nx; i += 1) {
        const x = (i + 0.5) * result.grid.dx;
        const y = (j + 0.5) * result.grid.dy;
        const z = (k + 0.5) * result.grid.dz;
        const index = fieldIndex(result.grid, x, y, z);
        if (result.fields.solid[index] || z >= 2.4 || x <= 1.3 || x >= 3.9 || y <= 0.3 || y >= 2.3) continue;
        maximumWakeSpeed = Math.max(maximumWakeSpeed,
          Math.hypot(result.fields.u[index], result.fields.v[index], result.fields.w[index]));
      }
    }
  }

  assert.ok(maximumWakeSpeed > 0.03, `downstream wake peaked at ${maximumWakeSpeed.toFixed(3)} m/s`);
  assert.ok(result.stats.rmsDivergence < 0.01);
});

test('the airflow field follows full object rotation, including vertical fan orientation', () => {
  const template = createRoomScene().objects.find((object) => object.model === 'fan');
  const fan = { ...template, position: { x: 2.6, y: 0, z: 2 }, rotation: { x: -90, y: 0, z: 0 } };
  const result = simulateRoomFields({ ...emptyRoomScene(), objects: [fan] });
  let verticalSpeed = 0;
  let fluidCells = 0;
  for (let j = 0; j < result.grid.ny; j += 1) {
    for (let k = 0; k < result.grid.nz; k += 1) {
      for (let i = 0; i < result.grid.nx; i += 1) {
        const x = (i + 0.5) * result.grid.dx;
        const y = (j + 0.5) * result.grid.dy;
        const z = (k + 0.5) * result.grid.dz;
        const index = fieldIndex(result.grid, x, y, z);
        if (result.fields.solid[index] || y <= 1.1 || y >= 2.4
          || Math.abs(x - fan.position.x) >= 0.3 || Math.abs(z - fan.position.z) >= 0.3) continue;
        verticalSpeed += result.fields.v[index];
        fluidCells += 1;
      }
    }
  }

  const meanVerticalSpeed = verticalSpeed / fluidCells;
  assert.ok(meanVerticalSpeed > 0.05, `mean upward jet speed was ${meanVerticalSpeed.toFixed(3)} m/s`);
});

test('closed walls remain impermeable after pressure projection', () => {
  const template = createRoomScene().objects.find((object) => object.model === 'fan');
  const fan = { ...template, position: { x: 0.3, y: 0, z: 2 }, rotation: { x: 0, y: 90, z: 0 } };
  const result = simulateRoomFields({ ...emptyRoomScene(), objects: [fan] });

  assert.equal(result.stats.maxClosedWallNormalSpeed, 0);
  assert.ok(result.stats.rmsDivergence < 0.01);
});

test('box obstacles occupy 3D voxels while the surrounding air remains fluid', () => {
  const obstacle = {
    id: 'obstacle', primitive: 'box', model: 'box', name: 'Obstacle',
    position: { x: 2.6, y: 0.8, z: 2 }, rotation: { x: 0, y: 0, z: 0 },
    dimensions: { width: 0.6, height: 0.6, depth: 0.6 },
  };
  const result = simulateRoomFields({ ...emptyRoomScene(), objects: [obstacle] }, { steps: 1 });

  assert.equal(result.fields.solid[fieldIndex(result.grid, 2.6, 1.125, 2)], 1);
  assert.equal(result.fields.solid[fieldIndex(result.grid, 1.6, 0.675, 2)], 0);
});

test('a heater creates a local bounded temperature rise in the 3D field', () => {
  const heater = {
    id: 'heater-5', primitive: 'box', model: 'heater', name: 'Heater',
    position: { x: 2.6, y: 0.4, z: 2 }, rotation: { x: 0, y: 0, z: 0 },
    dimensions: { width: 0.4, height: 0.4, depth: 0.4 },
  };
  const result = simulateRoomFields({ ...emptyRoomScene(), objects: [heater] });
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

test('disabled heaters contribute no heat', () => {
  const heater = {
    id: 'heater', primitive: 'box', model: 'heater', name: 'Heater', intensity: 1,
    position: { x: 2.6, y: 0.4, z: 2 }, rotation: { x: 0, y: 0, z: 0 },
    dimensions: { width: 0.4, height: 0.4, depth: 0.4 },
  };
  const scene = { ...emptyRoomScene(), objects: [{ ...heater, enabled: false }] };
  const result = simulateRoomFields(scene, { steps: 20 });

  assert.equal(result.stats.maxTemperature, result.ambientTemperature);
});

test('maximum room/grid work is bounded and all returned fields stay finite', () => {
  const room = { ...emptyRoomScene(), room: { width: 20, depth: 20, height: 6 }, objects: [] };
  const result = simulateRoomFields(room, {
    cellSize: 0.25, steps: 40, pressureIterations: 12, timeStep: 0.05,
    kinematicViscosity: 0.05, effectiveThermalDiffusivity: 0.05,
  });

  assert.ok(result.grid.nx <= 80 && result.grid.ny <= 48 && result.grid.nz <= 80);
  assert.ok(result.fields.u.length <= 307_200);
  assert.equal(result.grid.cellSize, 0.25);
  assert.equal(result.grid.requestedCellSize, 0.25);
  for (const field of [result.fields.u, result.fields.v, result.fields.w, result.fields.temperature]) {
    assert.ok(Array.from(field).every(Number.isFinite));
  }
  assert.throws(() => simulateRoomFields(room, { steps: 241 }), /steps/i);
  assert.throws(() => simulateRoomFields(room, { cellSize: 0.05 }), /cell size/i);
});

test('invalid physical coefficients are rejected before field integration', () => {
  const base = emptyRoomScene();
  const invalidOptions = [
    { timeStep: Infinity }, { timeStep: -0.01 }, { timeStep: 0.051 },
    { cellSize: NaN }, { kinematicViscosity: Infinity }, { kinematicViscosity: -0.01 },
    { effectiveThermalDiffusivity: Infinity }, { effectiveThermalDiffusivity: -0.01 },
    { vorticityConfinement: -0.01 }, { vorticityConfinement: 4.01 },
    { coolingRate: NaN }, { coolingRate: -0.01 }, { fanOutletSpeed: -0.01 },
    { envelopeUValue: Infinity }, { heaterRadius: 0 },
    { ambientTemperature: 41 },
  ];

  for (const options of invalidOptions) {
    assert.throws(() => simulateRoomFields(base, { ...options, steps: 1 }), RangeError,
      `expected invalid options ${JSON.stringify(options)} to be rejected`);
  }
});

test('a completely solid room returns finite ambient statistics', () => {
  const scene = {
    ...emptyRoomScene(),
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
