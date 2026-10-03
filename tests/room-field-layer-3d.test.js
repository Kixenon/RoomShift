import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createRoomFieldLayer, getAirflowColor, getLightColor, getTemperatureColor } from '../src/scene/room-field-layer-3d.js';

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

test('scalar fields map the complete 3D grid into a volumetric texture', () => {
  const layer = createRoomFieldLayer(sampleFields, 'temperature');
  const volume = volumeFor(layer);
  const texture = volume.material.uniforms.uField.value;

  assert.ok(volume.isMesh);
  assert.ok(volume.geometry.isBoxGeometry);
  assert.deepEqual([texture.image.width, texture.image.height, texture.image.depth], [2, 2, 2]);
  assert.equal(texture.image.data[0], 0);
  assert.equal(texture.image.data[7 * 4], 255);
  assert.equal(layer.userData.volumeVoxelCount, 8);
  assert.ok(layer.children.every((child) => !child.userData.fieldSlice));
  assert.equal(volume.material.transparent, true);
  assert.equal(volume.material.depthWrite, false);
});

test('airflow combines the 3D velocity volume with animated spatial streamlines and tracers', () => {
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
  const streamlines = layer.children.find((child) => child.name === 'airflow-streamlines');
  const tracers = layer.children.find((child) => child.name === 'airflow-tracers');
  const initialPositions = tracers.geometry.getAttribute('position').array.slice();
  const bounds = new THREE.Box3().setFromObject(streamlines);

  assert.ok(volumeFor(layer)?.isMesh);
  assert.ok(streamlines?.isMesh);
  assert.ok(streamlines.geometry.index.count > streamlines.geometry.attributes.position.count);
  assert.ok(bounds.min.x < bounds.max.x && bounds.min.y < bounds.max.y && bounds.min.z < bounds.max.z);
  assert.ok(bounds.min.x >= -1.53 && bounds.max.x <= 1.53);
  assert.ok(bounds.min.z >= -1.53 && bounds.max.z <= 1.53);
  assert.ok(tracers?.isPoints);
  assert.ok(typeof layer.userData.animate === 'function');
  layer.userData.animate(1);
  assert.notDeepEqual(Array.from(tracers.geometry.getAttribute('position').array), Array.from(initialPositions));
  assert.ok(layer.children.every((child) => child.name !== 'airflow-vectors'));
});

test('uniform fields produce an empty volume texture instead of tinting the room', () => {
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
  const texture = volumeFor(layer).material.uniforms.uField.value;

  assert.ok(Array.from(texture.image.data).every((value, index) => index % 4 !== 0 || value === 0));
});

test('light uses the same full 3D representation and retains solid-object masking', () => {
  const layer = createRoomFieldLayer(sampleFields, 'light');
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
