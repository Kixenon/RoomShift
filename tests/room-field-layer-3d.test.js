import assert from 'node:assert/strict';
import test from 'node:test';
import { addWindow, createRoomScene } from '../src/model/room-scene.js';
import { createRoomFieldLayer, getAirflowColor, getLightColor, getTemperatureColor } from '../src/scene/room-field-layer-3d.js';
import { simulateRoomFields } from '../src/simulation/room-fields-3d.js';

const sampleFields = {
  grid: { width: 2, height: 2, depth: 2, nx: 2, ny: 2, nz: 2, dx: 1, dy: 1, dz: 1 },
  fields: {
    u: Float32Array.from([1, 0, 0, 0, 0, 0, 0, 0]),
    v: Float32Array.from([0, 0, 0.7, 0, 0, 0, 0, 0]),
    w: Float32Array.from([0, 0, 0.2, 0, 0, 0, 0, 0]),
    temperature: Float32Array.from([20, 20, 22, 24, 26, 28, 30, 30]),
    light: Float32Array.from([0.05, 0.08, 0.12, 0.2, 0.3, 0.45, 0.7, 0.9]),
    solid: Uint8Array.from([0, 1, 0, 0, 0, 0, 0, 0]),
  },
  ambientTemperature: 20,
  ambientLevel: 0.05,
  stats: { maxSpeed: 1, maxTemperature: 30, maxLight: 0.9, maxLevel: 0.9 },
};

const volumeFor = (layer) => layer.children.find((child) => child.name.startsWith('field-volume-'));

test('field palettes distinguish levels and clamp values', () => {
  assert.notEqual(getAirflowColor(0, 1).getHex(), getAirflowColor(1, 1).getHex());
  assert.notEqual(getTemperatureColor(20, 20, 30).getHex(), getTemperatureColor(30, 20, 30).getHex());
  assert.notEqual(getLightColor(0.05).getHex(), getLightColor(0.9).getHex());
  assert.equal(getAirflowColor(5, 1).getHex(), getAirflowColor(1, 1).getHex());
  assert.equal(getTemperatureColor(40, 20, 30).getHex(), getTemperatureColor(30, 20, 30).getHex());
  assert.equal(getLightColor(2).getHex(), getLightColor(1).getHex());
});

test('temperature maps the solved field onto infrared room surfaces', () => {
  const layer = createRoomFieldLayer(sampleFields, 'temperature');
  const surfaces = layer.children.find((child) => child.name === 'infrared-temperature-surfaces');
  const floor = surfaces.children.find((child) => child.name === 'infrared-floor');
  const colors = floor.geometry.attributes.color;

  assert.ok(surfaces?.isGroup);
  assert.equal(surfaces.children.length, 6);
  assert.equal(colors.itemSize, 4);
  assert.ok(Math.min(...colors.array.filter((_, index) => index % 4 === 3)) >= 0.23);
  assert.ok(Math.max(...colors.array.filter((_, index) => index % 4 === 3)) <= 0.61);
  assert.notDeepEqual(Array.from(colors.array.slice(0, 3)), Array.from(colors.array.slice(-4, -1)));
  assert.equal(layer.userData.volumeVoxelCount, 0);
  assert.equal(volumeFor(layer), undefined);
});

test('airflow advects and diffuses a continuous 3D gas field', () => {
  const count = 6 ** 3;
  const maximumSpeed = Math.hypot(0.6, 0.4, 0.2);
  const result = {
    ...sampleFields,
    grid: { width: 3, height: 3, depth: 3, nx: 6, ny: 6, nz: 6, dx: 0.5, dy: 0.5, dz: 0.5 },
    fields: {
      u: new Float32Array(count).fill(0.6),
      v: new Float32Array(count).fill(0.4),
      w: new Float32Array(count).fill(0.2),
      temperature: new Float32Array(count).fill(20),
      light: new Float32Array(count).fill(0.1),
      solid: new Uint8Array(count),
    },
    stats: { maxSpeed: maximumSpeed, maxTemperature: 20, maxLight: 0.1 },
  };
  const layer = createRoomFieldLayer(result, 'airflow');
  const gas = layer.children.find((child) => child.name === 'advected-room-gas');
  const volume = gas.children.find((child) => child.name === 'advected-room-gas-volume');
  const textureData = volume.material.uniforms.uGas.value.image.data;
  const initialDensity = textureData.slice();
  let maximumEncodedSpeed = 0;
  for (let index = 1; index < textureData.length; index += 4) {
    maximumEncodedSpeed = Math.max(maximumEncodedSpeed, textureData[index]);
  }

  assert.ok(gas?.isGroup);
  assert.ok(volume?.isMesh);
  assert.ok(layer.userData.gasVoxelCount > 0);
  assert.ok(layer.userData.volumeVoxelCount > 0);
  assert.ok(volume.userData.voxelSize <= 0.15);
  const { width, height, depth } = volume.material.uniforms.uGas.value.image;
  assert.deepEqual(volume.material.uniforms.uVoxelSize.value.toArray(), [
    1 / width,
    1 / height,
    1 / depth,
  ]);
  assert.equal(maximumEncodedSpeed, 255);
  assert.ok(typeof layer.userData.animate === 'function');
  layer.userData.animate(1 + 1 / 30);
  assert.notDeepEqual(Array.from(textureData), Array.from(initialDensity));
  assert.ok(layer.userData.maxDensity > 0);
  assert.ok(layer.userData.occupiedVoxels > 0);
  assert.equal(layer.userData.airflowVisualization, 'advected-density');
});

test('gas follows open-window outflow beyond the wall', () => {
  const grid = { width: 2, height: 2, depth: 2, nx: 16, ny: 16, nz: 16, dx: 0.125, dy: 0.125, dz: 0.125 };
  const count = grid.nx * grid.ny * grid.nz;
  const outlets = new Uint8Array(count);
  const windowFlow = new Float32Array(count);
  for (let j = 2; j < 14; j += 1) {
    for (let i = 2; i < 14; i += 1) {
      const index = (j * grid.nz) * grid.nx + i;
      outlets[index] = 16;
      windowFlow[index] = -0.8;
    }
  }
  const result = {
    ...sampleFields,
    grid,
    fields: {
      u: new Float32Array(count),
      v: new Float32Array(count),
      w: new Float32Array(count).fill(-0.8),
      temperature: new Float32Array(count).fill(20),
      light: new Float32Array(count).fill(0.1),
      solid: new Uint8Array(count),
      outlets,
      windowFlow,
    },
    stats: { maxSpeed: 0.8, maxTemperature: 20, maxLight: 0.1 },
  };
  const roomScene = {
    room: { width: 2, height: 2, depth: 2 },
    objects: [
      {
        model: 'fan', enabled: true, intensity: 1,
        position: { x: 1, y: 0, z: 1.7 },
        rotation: { x: 0, y: 180, z: 0 },
        dimensions: { width: 0.4, height: 1.5, depth: 0.4 },
      },
      {
        model: 'window', wall: 'front', open: true, flowDirection: 'outlet', flowRate: 0.8,
        position: { x: 1, y: 0.3, z: 0.03 },
        dimensions: { width: 1.4, height: 1, depth: 0.06 },
      },
    ],
  };
  const layer = createRoomFieldLayer(result, 'airflow', roomScene);
  for (let frame = 1; frame <= 150; frame += 1) layer.userData.animate(1 + frame / 30);

  assert.ok(layer.userData.exteriorTracerVolumeM3 > 0);
});

test('an open exchange window transports the solved airflow tracer outside the room', () => {
  const base = createRoomScene();
  const placed = addWindow(base, 'front');
  const window = {
    ...placed.object,
    open: true,
    position: { ...placed.object.position, x: 0.8, y: 0.4 },
  };
  const scene = {
    ...placed.scene,
    objects: placed.scene.objects.map((object) => object.id === window.id ? window : object),
  };
  const result = simulateRoomFields(scene, { steps: 120 });
  let inflowFaces = 0;
  let outflowFaces = 0;
  for (let index = 0; index < result.fields.windowFlow.length; index += 1) {
    if (!(result.fields.outlets[index] & 16)) continue;
    if (result.fields.windowFlow[index] > 0) inflowFaces += 1;
    if (result.fields.windowFlow[index] < 0) outflowFaces += 1;
  }

  const layer = createRoomFieldLayer(result, 'airflow', scene, { displayStyle: 'gas' });
  for (let frame = 1; frame <= 45; frame += 1) layer.userData.animate(frame / 30);

  assert.ok(inflowFaces > 0, 'the exchange window should admit outdoor air');
  assert.ok(outflowFaces > 0, 'the exchange window should exhaust room air');
  assert.ok(result.stats.boundaryFlowImbalancePercent < 1,
    `default exchange flow imbalance was ${result.stats.boundaryFlowImbalancePercent}%`);
  assert.ok(layer.userData.exteriorTracerVolumeM3 > 0,
    'the rendered tracer should cross the open window');

  for (const flowRate of [0.8, 1.2]) {
    const highFlowWindow = { ...window, flowRate };
    const highFlowScene = {
      ...scene,
      objects: scene.objects.map((object) => object.id === window.id ? highFlowWindow : object),
    };
    const highFlow = simulateRoomFields(highFlowScene, { steps: 120 });
    assert.ok(highFlow.stats.boundaryFlowImbalancePercent < 1,
      `${flowRate} m/s exchange imbalance was ${highFlow.stats.boundaryFlowImbalancePercent}%`);
  }
});

test('uniform temperature produces a uniform infrared surface map', () => {
  const result = {
    ...sampleFields,
    fields: {
      ...sampleFields.fields,
      u: new Float32Array(8), v: new Float32Array(8), w: new Float32Array(8),
      temperature: new Float32Array(8).fill(20),
      light: new Float32Array(8).fill(0.05),
    },
    stats: { maxSpeed: 0, maxTemperature: 20, maxLight: 0.05, maxLevel: 0.05 },
  };
  const layer = createRoomFieldLayer(result, 'temperature');
  const floor = layer.children[0].children.find((child) => child.name === 'infrared-floor');
  const colors = floor.geometry.attributes.color.array;

  assert.ok(Array.from(colors).every((value, index) => index % 4 === 3 || value === colors[index % 4]));
});

test('light uses the same full 3D representation and retains solid-object masking', () => {
  const layer = createRoomFieldLayer(sampleFields, 'light', undefined, { displayStyle: 'map' });
  const volume = volumeFor(layer);
  const data = volume.material.uniforms.uField.value.image.data;

  assert.equal(layer.name, 'room-field-light');
  assert.equal(data[1 * 4 + 1], 255);
  assert.equal(data[7 * 4], 255);
});

test('field layers reject incomplete 3D grids and unsupported modes', () => {
  assert.throws(() => createRoomFieldLayer(sampleFields, 'unknown'), RangeError);
  assert.throws(() => createRoomFieldLayer({ ...sampleFields, fields: { ...sampleFields.fields, w: [] } }, 'airflow'), TypeError);
  assert.throws(() => createRoomFieldLayer({ ...sampleFields, fields: { ...sampleFields.fields, solid: undefined } }, 'airflow'), /complete 3D arrays/);
});
