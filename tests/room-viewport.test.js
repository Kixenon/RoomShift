import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { addObject, createRoomScene, resizeObject, rotateObject } from '../src/model/room-scene.js';
import { RoomViewport } from '../src/scene/room-viewport.js';

test('a rejected gizmo rotation restores the last valid scene pose', () => {
  const added = addObject(createRoomScene());
  const resized = resizeObject(added.scene, added.object.id, { width: 5 });
  const source = resized.object;
  const group = {
    userData: { objectId: source.id },
    position: { set(x, y, z) { Object.assign(this, { x, y, z }); } },
    rotation: { set(x, y, z) { Object.assign(this, { x, y, z }); } },
  };
  group.position.set(99, 99, 99);
  group.rotation.set(1, 1, 1);
  let selectionBoxUpdates = 0;
  const viewport = Object.assign(Object.create(RoomViewport.prototype), {
    roomScene: resized.scene,
    transform: { object: group },
    selectionBox: { update() { selectionBoxUpdates += 1; } },
    onTransform: () => rotateObject(resized.scene, source.id, { y: 45 }),
  });

  assert.throws(() => viewport.onTransform(source.id, {}, { x: 0, y: 45, z: 0 }), /fit inside the room/);
  viewport.handleObjectChange();

  assert.equal(group.position.x, source.position.x - resized.scene.room.width / 2);
  assert.equal(group.position.y, source.position.y + source.dimensions.height / 2);
  assert.equal(group.position.z, source.position.z - resized.scene.room.depth / 2);
  assert.equal(group.rotation.x, 0);
  assert.equal(group.rotation.y, 0);
  assert.equal(group.rotation.z, 0);
  assert.equal(selectionBoxUpdates, 1);
});

test('a fan with zero output does not animate its rotor', () => {
  const scene = createRoomScene();
  const fan = scene.objects.find((object) => object.model === 'fan');
  const viewport = Object.assign(Object.create(RoomViewport.prototype), {
    roomScene: scene,
    groups: new Map(),
    fanRotors: new Map(),
    sceneRoot: new THREE.Group(),
  });
  viewport.createObjectGroup({ ...fan, intensity: 0 });

  assert.equal(viewport.fanRotors.get(fan.id).userData.enabled, false);
});

test('viewport frames advance the airflow layer animation clock', () => {
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  let animationTime = null;
  globalThis.requestAnimationFrame = () => 1;
  const viewport = {
    animate: RoomViewport.prototype.animate,
    updateFieldVolumeDepthTest: RoomViewport.prototype.updateFieldVolumeDepthTest,
    orbit: { update() {} },
    selectionBox: null,
    hoverBox: null,
    fanRotors: new Map(),
    fieldLayer: { userData: { animate: (time) => { animationTime = time; } } },
    renderer: { render() {} },
    scene: {},
    camera: {},
  };

  try {
    viewport.animate(2500);
  } finally {
    if (originalRequestAnimationFrame) globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    else delete globalThis.requestAnimationFrame;
  }

  assert.equal(animationTime, 2.5);
});
