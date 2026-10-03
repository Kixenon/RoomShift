import test from 'node:test';
import assert from 'node:assert/strict';
import { addObject, createRoomScene, moveObject, removeObject, renameObject, resizeObject, resizeRoom, rotateObject, setObjectModel } from '../src/model/room-scene.js';

test('a new scene starts with real room dimensions in meters', () => {
  const scene = createRoomScene();

  assert.deepEqual(scene.room, { width: 5.2, depth: 4, height: 2.7, outdoorTemperature: 10 });
  assert.ok(Array.isArray(scene.objects));
  assert.ok(scene.objects.every((object) => object.primitive === 'box'));
  assert.deepEqual(scene.objects.map((object) => object.model), ['fan', 'sofa', 'desk', 'table', 'lamp', 'heater']);
  assert.equal(scene.objects.find((object) => object.model === 'lamp')?.id, 'lamp-1');
  assert.equal(scene.objects.find((object) => object.model === 'heater')?.id, 'heater-1');
});

test('adding an object creates a named box primitive with a unique stable id', () => {
  const first = addObject(createRoomScene());
  const second = addObject(first.scene);
  const box = first.object;

  assert.equal(box.id, 'box-5');
  assert.equal(box.primitive, 'box');
  assert.equal(box.model, 'box');
  assert.equal(box.name, 'Box 5');
  assert.deepEqual(box.dimensions, { width: 1, height: 1, depth: 1 });
  assert.notEqual(box.id, second.object.id);
  assert.deepEqual(first.scene.room, { width: 5.2, depth: 4, height: 2.7, outdoorTemperature: 10 });
});

test('changing the model preset does not change the editable box geometry', () => {
  const added = addObject(createRoomScene());
  const result = setObjectModel(added.scene, added.object.id, 'bed');

  assert.equal(result.object.primitive, 'box');
  assert.equal(result.object.model, 'bed');
  assert.equal(result.object.name, 'Box 5');
  assert.deepEqual(result.object.dimensions, added.object.dimensions);
  assert.deepEqual(result.object.position, added.object.position);
  assert.equal(added.object.model, 'box');
});

test('renaming an object trims whitespace and rejects blank names', () => {
  const scene = createRoomScene();
  const renamed = renameObject(scene, 'fan-1', '  Desk fan  ');

  assert.equal(renamed.object.name, 'Desk fan');
  assert.equal(renamed.scene.objects[0].name, 'Desk fan');
  assert.equal(scene.objects[0].name, 'Pedestal fan');
  assert.throws(() => renameObject(scene, 'fan-1', '   '), /name/i);
});

test('moving an object constrains its full geometry to room bounds', () => {
  const original = createRoomScene();
  const moved = moveObject(original, 'fan-1', { x: -10, y: 9, z: 10 });
  const fan = moved.scene.objects.find((object) => object.id === 'fan-1');

  // Clamped coordinates are derived by arithmetic, so compare with a tolerance
  // rather than exact float equality.
  assert.ok(Math.abs(fan.position.x - 0.21) < 1e-9, `x was ${fan.position.x}`);
  assert.ok(Math.abs(fan.position.y - 1.35) < 1e-9, `y was ${fan.position.y}`);
  assert.ok(Math.abs(fan.position.z - 3.79) < 1e-9, `z was ${fan.position.z}`);
  assert.deepEqual(original.objects[0].position, { x: 0.82, y: 0, z: 3.15 });
  assert.equal(moved.object.id, 'fan-1');
});

test('resizing a room preserves every object inside its new dimensions', () => {
  const original = createRoomScene();
  const resized = resizeRoom(original, { width: 4.8, depth: 3.8, height: 2.2 });

  assert.deepEqual(resized.room, { width: 4.8, depth: 3.8, height: 2.2, outdoorTemperature: 10 });
  for (const object of resized.objects) {
    assert.ok(object.position.x - object.dimensions.width / 2 >= 0);
    assert.ok(object.position.x + object.dimensions.width / 2 <= resized.room.width);
    assert.ok(object.position.z - object.dimensions.depth / 2 >= 0);
    assert.ok(object.position.z + object.dimensions.depth / 2 <= resized.room.depth);
    assert.ok(object.position.y + object.dimensions.height <= resized.room.height);
  }
  assert.deepEqual(original.room, { width: 5.2, depth: 4, height: 2.7, outdoorTemperature: 10 });
});

test('resizing an object updates its dimensions and keeps it in the room', () => {
  const original = createRoomScene();
  const resized = resizeObject(original, 'sofa-2', { width: 2.2, height: 1, depth: 1.2 });
  const sofa = resized.scene.objects.find((object) => object.id === 'sofa-2');

  assert.deepEqual(sofa.dimensions, { width: 2.2, height: 1, depth: 1.2 });
  assert.ok(sofa.position.x + sofa.dimensions.width / 2 <= resized.scene.room.width);
  assert.deepEqual(original.objects[1].dimensions, { width: 1.55, height: 0.78, depth: 0.84 });
});

test('rotating an object normalizes its angle without changing its position', () => {
  const original = createRoomScene();
  const seed = structuredClone(original.objects[0]);
  const rotated = rotateObject(original, 'fan-1', { x: 0, y: 370, z: 0 });

  assert.deepEqual(rotated.object.rotation, { x: 0, y: 10, z: 0 });
  assert.ok(Math.abs(rotated.object.position.x - seed.position.x) < 1e-9);
  assert.ok(Math.abs(rotated.object.position.y - seed.position.y) < 1e-9);
  assert.ok(Math.abs(rotated.object.position.z - seed.position.z) < 1e-9);
  assert.deepEqual(original.objects[0].rotation, seed.rotation);
});

test('rotation can be edited independently around every object axis', () => {
  const original = createRoomScene();
  const seed = structuredClone(original.objects[0]);
  const rotated = rotateObject(original, 'fan-1', { x: 370, y: 25, z: -380 });

  assert.deepEqual(rotated.object.rotation, { x: 10, y: 25, z: -20 });
  assert.deepEqual(original.objects[0].rotation, seed.rotation);
});

test('rotating an object constrains its rotated footprint to the room', () => {
  const original = createRoomScene();
  const onlySofa = { ...original, objects: [original.objects.find((object) => object.id === 'sofa-2')] };
  const scene = moveObject(onlySofa, 'sofa-2', { x: 0.775, z: 0.42 });
  const rotated = rotateObject(scene.scene, 'sofa-2', { x: 0, y: 90, z: 0 });

  assert.equal(rotated.object.position.x, 0.78);
  assert.equal(rotated.object.position.z, 0.78);
  assert.ok(rotated.object.position.x - rotated.object.dimensions.depth / 2 >= 0);
  assert.ok(rotated.object.position.z - rotated.object.dimensions.width / 2 >= 0);
});

test('removing a selected object leaves the other objects unchanged', () => {
  const original = createRoomScene();
  const updated = removeObject(original, 'table-4');

  assert.equal(updated.objects.some((object) => object.id === 'table-4'), false);
  assert.equal(updated.objects.length, original.objects.length - 1);
  assert.equal(original.objects.length, 6);
});
