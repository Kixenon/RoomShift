import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { addObject, addWindow, floorContains, setRoomShape, setWindowOpen } from '../src/model/room-scene.js';
import { TEMPLATES } from '../src/model/projects.js';
import { DEFAULT_ENVIRONMENT, heatBalance, ventilation } from '../src/model/environment.js';
import { itu1238Loss, profileAlong, roomAcoustics, computeLightVolume } from '../src/simulation/room-propagation.js';
import { sceneFromLayout } from '../src/features/ai-scan.js';
import { analyseScan, sceneFromScan } from '../src/features/scan-import.js';
import { underlayFor } from '../src/features/floor-plan.js';
import { bestIndex } from '../src/features/metrics.js';

const empty = () => TEMPLATES.find((template) => template.id === 'empty').create();

test('ITU-R P.1238 loss matches the published formula', () => {
  // 20·log10(5200) + 30·log10(10) − 28 ≈ 76.3 dB
  assert.ok(Math.abs(itu1238Loss(10, 5) - (20 * Math.log10(5200) + 30 - 28)) < 1e-9);
  assert.ok(itu1238Loss(10, 2.4) < itu1238Loss(10, 5));
});

test('Eyring echo time is at most Sabine’s', () => {
  const acoustics = roomAcoustics(addObject(empty(), { model: 'sofa' }).scene);
  assert.ok(acoustics.rt60 <= acoustics.rt60Sabine);
});

test('cross-ventilation beats single-sided and closed rooms', () => {
  let scene = addWindow(empty(), 'back').scene;
  const back = scene.objects[0].id;
  scene = setWindowOpen(scene, back, true).scene;
  const single = ventilation(scene, { windSpeed: 3 });
  const withFront = addWindow(scene, 'front');
  const cross = ventilation(setWindowOpen(withFront.scene, withFront.object.id, true).scene, { windSpeed: 3 });
  const closed = ventilation(empty(), { windSpeed: 3 });
  assert.equal(cross.mode, 'cross');
  assert.ok(cross.ach > single.ach && single.ach > closed.ach);
});

test('a heater warms the steady-state room and an AC pulls it back', () => {
  const environment = { ...DEFAULT_ENVIRONMENT, hour: 22 };
  const base = heatBalance(empty(), environment, { outdoor: 30 });
  const heated = heatBalance(addObject(empty(), { model: 'heater' }).scene, environment, { outdoor: 30 });
  assert.ok(heated.indoor > base.indoor + 3);
  const cooled = heatBalance(addObject(addObject(empty(), { model: 'heater' }).scene, { model: 'ac' }).scene, environment, { outdoor: 30 });
  assert.ok(cooled.indoor < heated.indoor && cooled.cooling > 0);
});

test('L-shaped and round rooms exclude the missing floor', () => {
  const l = setRoomShape(empty(), { type: 'L', cutWidth: 1.5, cutDepth: 1.5 });
  assert.equal(floorContains(l.room, l.room.width - 0.5, 0.5), false);
  assert.equal(floorContains(l.room, 0.5, 0.5), true);
  const round = setRoomShape(empty(), { type: 'rounded', radius: 1.75 });
  assert.equal(floorContains(round.room, 0.05, 0.05), false);
});

test('the light volume is brighter near a lamp than across the room', () => {
  const scene = addObject(empty(), { model: 'lamp', position: { x: 0.5, z: 0.5 } }).scene;
  const volume = computeLightVolume(scene, { ...DEFAULT_ENVIRONMENT, hour: 23 }, { cellSize: 0.25 });
  const { grid, fields } = volume;
  const at = (x, y, z) => fields.raw[(Math.floor(y / grid.dy) * grid.nz + Math.floor(z / grid.dz)) * grid.nx + Math.floor(x / grid.dx)];
  assert.ok(at(0.9, 0.8, 0.9) > at(3.6, 0.8, 3.2));
});

test('profileAlong samples evenly from source to target', () => {
  const profile = profileAlong({ x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: 4 }, (point) => point.x, 10);
  assert.equal(profile.length, 5);
  assert.equal(profile.values.length, 11);
  assert.equal(profile.values.at(-1).value, 3);
});

test('an AI layout becomes a scene with openings and furniture at size', () => {
  const scene = sceneFromLayout(empty(), {
    room: { width: 4, depth: 3.5, height: 2.6 },
    objects: [{ type: 'bed', name: 'Bed', width: 1.4, depth: 2, height: 0.5, x: 1, z: 2, rotation_deg: 0, color_hex: '#aabbcc' }],
    openings: [{ type: 'door', wall: 'front', along: 0.6, width: 0.85, height: 2.05, sill: 0 }],
    notes: '',
  });
  assert.equal(scene.room.width, 4);
  assert.ok(scene.objects.some((object) => object.model === 'door'));
  const bed = scene.objects.find((object) => object.model === 'bed');
  assert.equal(bed.color, '#aabbcc');
  assert.equal(bed.dimensions.width, 1.4);
});

test('a labelled 3D scan in centimetres becomes a room with furniture', () => {
  const root = new THREE.Group();
  const shell = new THREE.Mesh(new THREE.BoxGeometry(420, 260, 350));
  shell.position.set(210, 130, 175);
  shell.name = 'Room';
  const bed = new THREE.Mesh(new THREE.BoxGeometry(140, 50, 200));
  bed.position.set(100, 25, 150);
  bed.name = 'Bed0';
  root.add(shell, bed);
  const scan = analyseScan(root);
  assert.ok(Math.abs(scan.size.x - 4.2) < 0.01);
  const scene = sceneFromScan(empty(), scan);
  assert.ok(Math.abs(scene.room.width - 4.2) < 0.01 && Math.abs(scene.room.height - 2.6) < 0.01);
  const placed = scene.objects.find((object) => object.model === 'bed');
  assert.ok(placed && Math.abs(placed.dimensions.width - 1.4) < 0.01);
});

test('floor-plan calibration converts clicks to metres', () => {
  const underlay = underlayFor({ url: 'x', width: 1000, height: 800, metresPerPixel: 0.01 }, [{ x: 100, y: 100 }, { x: 500, y: 450 }]);
  assert.deepEqual(underlay.room, { width: 4, depth: 3.5 });
  assert.equal(underlay.centerX, 4);
});

test('bestIndex respects the direction of “better”', () => {
  assert.equal(bestIndex([1, 3, 2], 'high'), 1);
  assert.equal(bestIndex([1, 3, 2], 'low'), 0);
  assert.equal(bestIndex([100, 400, 900], 'target', [300, 750]), 1);
});

test('AI shape fields map onto the parametric styles', async () => {
  const { styleFromFields } = await import('../src/features/ai-scan.js');
  assert.deepEqual(styleFromFields('table', { top_shape: 'rect', legs: 'tleg' }), { shape: 'rect', legs: 'tleg' });
  assert.deepEqual(styleFromFields('sofa', { arms: 'none', chaise: 'left', back: 'n/a' }), { arms: 'none', chaise: 'left' });
  assert.equal(styleFromFields('plant', {}), undefined);
});
