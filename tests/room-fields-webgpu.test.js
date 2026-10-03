import assert from 'node:assert/strict';
import test from 'node:test';
import { createRoomScene } from '../src/model/room-scene.js';
import { prepareWebGpuInputs, simulateRoomFieldsWebGpu } from '../src/simulation/room-fields-webgpu.js';

test('WebGPU reports an unavailable adapter so the worker can use its CPU preview', async () => {
  assert.equal(await simulateRoomFieldsWebGpu(createRoomScene(), {}, null), null);
  await assert.rejects(simulateRoomFieldsWebGpu(createRoomScene(), { vorticityConfinement: 5 }, null), /vorticity confinement/i);
});

test('GPU inputs preserve rotated fan direction and voxelize room obstacles', () => {
  const scene = createRoomScene();
  const fan = { ...scene.objects.find((object) => object.model === 'fan'), rotation: { x: 0, y: 90, z: 0 } };
  const obstacle = {
    id: 'block', primitive: 'box', model: 'box', name: 'Block',
    position: { x: 2.6, y: 0.8, z: 2 }, rotation: { x: 0, y: 0, z: 0 },
    dimensions: { width: 0.6, height: 0.6, depth: 0.6 },
  };
  const heater = {
    id: 'heater', primitive: 'box', model: 'heater', name: 'Heater',
    position: { x: 1, y: 0, z: 1 }, rotation: { x: 0, y: 0, z: 0 },
    dimensions: { width: 0.4, height: 0.4, depth: 0.4 },
  };
  const grid = {
    width: 5.2, height: 2.7, depth: 4,
    nx: 52, ny: 27, nz: 40, dx: 0.1, dy: 0.1, dz: 0.1,
  };
  const inputs = prepareWebGpuInputs({ ...scene, objects: [fan, obstacle, heater] }, grid);

  assert.equal(inputs.solid.length, grid.nx * grid.ny * grid.nz);
  assert.equal(inputs.solid[(8 * grid.nz + 20) * grid.nx + 26], 1);
  assert.equal(inputs.fanForces.length, grid.nx * grid.ny * grid.nz * 4);
  const grilleCell = ((10 * grid.nz + 31) * grid.nx + 11) * 4;
  assert.ok(inputs.fanForces[grilleCell] > 0.99);
  assert.ok(Math.abs(inputs.fanForces[grilleCell + 1]) < 1e-6);
  assert.ok(Math.abs(inputs.fanForces[grilleCell + 2]) < 1e-6);
  assert.deepEqual(Array.from(inputs.fanForces.slice(((8 * grid.nz + 20) * grid.nx + 26) * 4,
    ((8 * grid.nz + 20) * grid.nx + 26) * 4 + 3)), [0, 0, 0]);
  assert.equal(inputs.heaters.length, 8);
  assert.equal(inputs.heaters[0], 1);
  assert.ok(Math.abs(inputs.heaters[1] - 0.2) < 1e-6);
  assert.equal(inputs.heaters[2], 1);
});

test('disabled heaters are omitted from GPU source inputs', () => {
  const scene = createRoomScene();
  const heater = { ...scene.objects.find((object) => object.model === 'heater'), enabled: false };
  const inputs = prepareWebGpuInputs({ ...scene, objects: [heater] }, {
    width: 5.2, height: 2.7, depth: 4,
    nx: 52, ny: 27, nz: 40, dx: 0.1, dy: 0.1, dz: 0.1,
  });

  assert.equal(inputs.heaterCount, 0);
});
