import test from 'node:test';
import assert from 'node:assert/strict';
import { addObject, addWindow, setObjectMaterial } from '../src/model/room-scene.js';
import { TEMPLATES } from '../src/model/projects.js';
import { sunPosition, wallBearings, windwardWall } from '../src/model/environment.js';
import { computePlaneField, roomAcoustics, wifiAt } from '../src/simulation/room-propagation.js';
import { evaluateLayout, suggestLayout } from '../src/model/layout-advisor.js';
import { setSurfaceMaterial } from '../src/model/room-scene.js';

const empty = () => TEMPLATES.find((template) => template.id === 'empty').create();

test('the noon sun at midsummer is near overhead in Hong Kong and low in London', () => {
  const hongKong = sunPosition({ lat: 22.32, lon: 114.17, tz: 8, month: 6, day: 21, hour: 12.3 });
  const london = sunPosition({ lat: 51.5, lon: -0.12, tz: 0, month: 12, day: 21, hour: 12 });
  assert.ok(hongKong.altitude > 85, `HK altitude ${hongKong.altitude}`);
  assert.ok(london.altitude > 12 && london.altitude < 17, `London altitude ${london.altitude}`);
  assert.ok(Math.abs(london.azimuth - 180) < 5);
});

test('wall bearings follow the back wall and wind picks the facing wall', () => {
  assert.deepEqual(wallBearings(180), { back: 180, left: 270, front: 0, right: 90 });
  assert.equal(windwardWall({ backWallBearing: 180 }, 200), 'back');
});

test('WiFi falls with distance and a metal object costs more than a wooden one', () => {
  let scene = addObject(empty(), { model: 'router', position: { x: 0.3, z: 1.75 } }).scene;
  const near = wifiAt(scene, { x: 1, y: 1, z: 1.75 });
  const far = wifiAt(scene, { x: 3.7, y: 1, z: 1.75 });
  assert.ok(near > far);
  const blocked = addObject(scene, { model: 'wardrobe', position: { x: 2, z: 1.75 } });
  const wood = wifiAt(blocked.scene, { x: 3.7, y: 1, z: 1.75 });
  const metal = wifiAt(setObjectMaterial(blocked.scene, blocked.object.id, 'metal').scene, { x: 3.7, y: 1, z: 1.75 });
  assert.ok(far - wood > 2 && wood - metal > 10, `${far} ${wood} ${metal}`);
  scene = blocked.scene;
  const field = computePlaneField(scene, 'wifi');
  assert.equal(field.values.length, field.nx * field.nz);
});

test('soft finishes shorten the echo time', () => {
  const hard = roomAcoustics(setSurfaceMaterial(empty(), 'floor', 'tile'));
  const soft = roomAcoustics(setSurfaceMaterial(addObject(empty(), { model: 'sofa' }).scene, 'floor', 'carpet'));
  assert.ok(hard.rt60 > 1.5 * soft.rt60, `${hard.rt60} vs ${soft.rt60}`);
});

test('the layout check flags a blocked door and a heater by the sofa', () => {
  let scene = addWindow(empty(), 'front', 'door').scene;
  const door = scene.objects[0];
  scene = addObject(scene, { model: 'wardrobe', position: { x: door.position.x, z: 0.3 } }).scene;
  scene = addObject(scene, { model: 'sofa', position: { x: 3, z: 3 } }).scene;
  scene = addObject(scene, { model: 'heater', position: { x: 3, z: 2.3 } }).scene;
  const report = evaluateLayout(scene);
  assert.ok(report.score < 80);
  assert.ok(report.issues.some((issue) => /door/.test(issue.text)));
  assert.ok(report.issues.some((issue) => /fire risk/.test(issue.text)));
});

test('suggested layouts never score worse and leave locked objects alone', async () => {
  const scene = TEMPLATES.find((template) => template.id === 'hall').create();
  const bed = scene.objects.find((object) => object.model === 'bed');
  const locked = { ...scene, objects: scene.objects.map((object) => object.id === bed.id ? { ...object, locked: true } : object) };
  const result = await suggestLayout(locked, { seed: 7, iterations: 400 });
  assert.ok(result.after.score >= result.before.score);
  assert.deepEqual(result.scene.objects.find((object) => object.id === bed.id).position, bed.position);
});
