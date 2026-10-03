import assert from 'node:assert/strict';
import test from 'node:test';
import { addWindow, createRoomScene, setWindowOpen } from '../src/model/room-scene.js';
import {
  COMPASS,
  clipPolygonToRectangle,
  describeDaylight,
  polygonArea,
  sunDirection,
  wallCompassLabel,
  wallInwardNormal,
  windowCorners,
} from '../src/simulation/daylight.js';
import { solarPosition } from '../src/simulation/sun-position.js';

const minutes = (text) => {
  const [h, m] = text.split(':').map(Number);
  return h * 60 + m;
};
const near = (actual, expected, tolerance, label) => {
  assert.ok(Math.abs(actual - expected) <= tolerance,
    `${label}: expected about ${expected}, got ${actual}`);
};

const sceneWithWindow = (wall = 'back', open = true) => {
  const withWindow = addWindow(createRoomScene(), wall);
  return setWindowOpen(withWindow.scene, 'window-1', open).scene;
};

test('sun direction is a unit vector pointing up and toward the azimuth', () => {
  for (const [altitude, azimuth] of [[0, 0], [0, 90], [45, 180], [70, 270], [-10, 135]]) {
    const direction = sunDirection(altitude, azimuth);
    near(Math.hypot(direction.x, direction.y, direction.z), 1, 1e-9, `length at ${altitude}/${azimuth}`);
    near(direction.y, Math.sin(altitude * Math.PI / 180), 1e-9, `vertical at ${altitude}`);
  }
});

test('north is -z and east is +x in the scene coordinates', () => {
  near(COMPASS.north.x, 0, 0, 'north x');
  near(COMPASS.north.z, -1, 0, 'north z');
  near(COMPASS.east.x, 1, 0, 'east x');
  near(COMPASS.east.z, 0, 0, 'east z');

  const dueNorth = sunDirection(10, 0);
  assert.ok(dueNorth.z < -0.9 && Math.abs(dueNorth.x) < 1e-9, `due north was ${JSON.stringify(dueNorth)}`);
  const dueEast = sunDirection(10, 90);
  assert.ok(dueEast.x > 0.9 && Math.abs(dueEast.z) < 1e-9, `due east was ${JSON.stringify(dueEast)}`);
  const overhead = sunDirection(90, 123);
  assert.ok(overhead.y > 0.999, 'a high sun should be nearly straight up');
});

test('each wall has an inward normal and a compass label', () => {
  assert.deepEqual(wallInwardNormal('back'), { x: 0, z: -1 });
  assert.deepEqual(wallInwardNormal('front'), { x: 0, z: 1 });
  assert.deepEqual(wallInwardNormal('left'), { x: 1, z: 0 });
  assert.deepEqual(wallInwardNormal('right'), { x: -1, z: 0 });
  assert.throws(() => wallInwardNormal('ceiling'), /Unsupported window wall/);
  assert.deepEqual(
    Object.fromEntries(['back', 'front', 'left', 'right'].map((wall) => [wall, wallCompassLabel(wall)])),
    { back: 'south', front: 'north', left: 'west', right: 'east' },
  );
});

test('window corners sit on the wall and span the right axis', () => {
  const scene = sceneWithWindow('back');
  const window = scene.objects.find((object) => object.model === 'window');
  const corners = windowCorners(window, scene.room);

  assert.equal(corners.length, 4);
  for (const corner of corners) {
    near(corner.z, window.position.z, 1e-9, 'a back window sits at a single depth');
    assert.ok(corner.y >= window.position.y - 1e-9 && corner.y <= window.position.y + window.dimensions.height + 1e-9);
    assert.ok(corner.x >= 0 && corner.x <= scene.room.width, 'corners stay inside the room width');
  }
  // A back window spans x while every corner shares one depth.
  assert.notEqual(corners[0].x, corners[1].x);
  assert.equal(corners[0].z, corners[1].z, 'a back window spans x, not z');

  const sideScene = sceneWithWindow('left');
  const sideWindow = sideScene.objects.find((object) => object.model === 'window');
  const sideCorners = windowCorners(sideWindow, sideScene.room);
  assert.equal(sideCorners[0].x, sideCorners[1].x, 'a left window sits at a single x');
  assert.notEqual(sideCorners[0].z, sideCorners[1].z, 'a left window spans z');
});

test('polygon clipping keeps what is inside and drops what is outside', () => {
  const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  const rect = { minX: 0, maxX: 5, minY: 0, maxY: 5 };

  assert.deepEqual(clipPolygonToRectangle(square, rect).length, 4);
  near(polygonArea(clipPolygonToRectangle(square, rect)), 25, 1e-9, 'half the square survives');

  assert.deepEqual(clipPolygonToRectangle([{ x: 20, y: 20 }, { x: 30, y: 20 }], rect), []);
  near(polygonArea(square), 100, 1e-9, 'unclipped area');
});

test('a sun below the horizon contributes nothing', () => {
  const state = describeDaylight({ scene: sceneWithWindow(), timeMinutes: 0 });
  assert.equal(state.sun.daylight, 0);
  assert.equal(state.sun.intensity, 0);
  assert.deepEqual(state.patches, []);
  assert.equal(state.sky.intensity, 0.3);
});

test('at midday the sun is up and the sky is bright', () => {
  const state = describeDaylight({ scene: sceneWithWindow(), timeMinutes: minutes('12:30') });
  assert.ok(state.sun.altitude > 60, `altitude was ${state.sun.altitude}`);
  assert.ok(state.sun.intensity > 2, `intensity was ${state.sun.intensity}`);
  assert.ok(state.sky.intensity > 0.7, `sky intensity was ${state.sky.intensity}`);
  assert.ok(state.sun.warmth < 0.2, 'a high sun should be close to neutral');
});

test('a closed window casts no patch', () => {
  const state = describeDaylight({ scene: sceneWithWindow('back', false), timeMinutes: minutes('12:30') });
  assert.deepEqual(state.patches, []);
});

test('a window only receives sun on the walls facing it', () => {
  // At 09:00 on the equinox the sun is in the east-south-east, so the east and
  // south walls are lit and the west and north walls are in shade.
  const sun = solarPosition({ timeMinutes: minutes('09:00') });
  assert.ok(sun.azimuth > 90 && sun.azimuth < 135, `expected a south-easterly sun, got ${sun.azimuth}`);

  for (const wall of ['right', 'back']) {
    const state = describeDaylight({ scene: sceneWithWindow(wall, true), timeMinutes: minutes('09:00') });
    assert.equal(state.patches.length, 1, `the ${wall} wall should be lit`);
  }
  for (const wall of ['left', 'front']) {
    const state = describeDaylight({ scene: sceneWithWindow(wall, true), timeMinutes: minutes('09:00') });
    assert.equal(state.patches.length, 0, `the ${wall} wall must be in shade`);
  }
});

test('a near-overhead sun barely reaches a vertical wall', () => {
  // At the June solstice noon the sun passes almost directly over the site, so
  // it is nearly parallel to every wall and the patches collapse to slivers.
  // The incidence guard exists to reject exactly this case.
  const june = { year: 2026, month: 6, day: 21 };
  const noon = solarPosition({ date: june, timeMinutes: minutes('12:25') });
  assert.ok(noon.altitude > 80, `expected a near-overhead sun, got ${noon.altitude}`);

  const overhead = describeDaylight({
    scene: sceneWithWindow('front', true), timeMinutes: minutes('12:25'), date: june,
  });
  const morning = describeDaylight({
    scene: sceneWithWindow('front', true), timeMinutes: minutes('08:00'), date: june,
  });
  assert.equal(overhead.patches.length, 0, 'an overhead sun lights no vertical wall');
  assert.ok(morning.patches.length > 0, 'a lower sun does reach the same wall');
});

test('a sun patch is a parallelogram clipped to the floor', () => {
  const state = describeDaylight({
    scene: sceneWithWindow('right', true),
    timeMinutes: minutes('09:00'),
  });
  assert.equal(state.patches.length, 1);
  const [patch] = state.patches;
  assert.equal(patch.windowId, 'window-1');
  assert.ok(patch.area > 0, 'the patch must have area');
  for (const point of patch.polygon) {
    assert.ok(point.x >= -1e-6 && point.x <= 5.2 + 1e-6, `x ${point.x} escaped the room`);
    assert.ok(point.z >= -1e-6 && point.z <= 4 + 1e-6, `z ${point.z} escaped the room`);
  }
  // The window is 1.4 m wide, so its projection cannot be narrower than that
  // once clipped, and must not be wildly larger.
  assert.ok(patch.area >= 0.5 && patch.area < 12, `patch area was ${patch.area}`);
});

test('a patch pulls away from its wall and brightens as the sun climbs', () => {
  const scene = sceneWithWindow('back', true);
  const measure = (timeMinutes) => {
    const [patch] = describeDaylight({ scene, timeMinutes }).patches;
    const centreZ = patch.polygon.reduce((sum, point) => sum + point.z, 0) / patch.polygon.length;
    return { centreZ, area: patch.area, intensity: patch.intensity };
  };

  const morning = measure(minutes('09:00'));
  const later = measure(minutes('11:30'));

  // A higher sun throws the patch further from the wall, because the sill height
  // and the shallower angle combine to push it deeper into the room.
  assert.ok(morning.centreZ > later.centreZ,
    `the patch should pull away from the wall as the sun climbs: ${morning.centreZ} vs ${later.centreZ}`);
  // The sun also swings closer to the wall's normal, so the light is more direct.
  assert.ok(later.intensity > morning.intensity,
    `light should brighten as it turns direct: ${morning.intensity} then ${later.intensity}`);

  // The clipped area is deliberately not asserted here: a grazing patch is more
  // spread out, but so much of it can fall outside the room that clipping leaves
  // less of it, which makes area non-monotone. That is why brightness, not area,
  // is the quantity the shader is driven by.
  assert.ok(morning.area > 0 && later.area > 0);
});

test('every open window on a sunward wall gets its own patch', () => {
  // One window on each of the two walls that face the 09:00 sun.
  let scene = sceneWithWindow('back', true);
  scene = setWindowOpen(addWindow(scene, 'right').scene, 'window-2', true).scene;

  const state = describeDaylight({ scene, timeMinutes: minutes('09:00') });
  assert.equal(state.patches.length, 2);
  assert.deepEqual(state.patches.map((patch) => patch.windowId).sort(), ['window-1', 'window-2']);
  assert.deepEqual(state.patches.map((patch) => patch.wall).sort(), ['back', 'right']);
});

test('a shaded window contributes no patch even beside a lit one', () => {
  let scene = sceneWithWindow('back', true);
  scene = setWindowOpen(addWindow(scene, 'front').scene, 'window-2', true).scene;
  const state = describeDaylight({ scene, timeMinutes: minutes('09:00') });
  assert.equal(state.patches.length, 1);
  assert.equal(state.patches[0].wall, 'back');
});

test('grazing light reads as dimmer than direct light', () => {
  const scene = sceneWithWindow('back', true);
  const low = describeDaylight({ scene, timeMinutes: minutes('09:00') });
  const high = describeDaylight({ scene, timeMinutes: minutes('11:00') });
  assert.ok(low.patches.length > 0 && high.patches.length > 0);
  assert.ok(low.patches[0].intensity < high.patches[0].intensity,
    `grazing ${low.patches[0].intensity} should be dimmer than direct ${high.patches[0].intensity}`);
});

test('sun and sky colours warm towards the horizon', () => {
  const scene = sceneWithWindow();
  const dawn = describeDaylight({ scene, timeMinutes: minutes('06:15') });
  const noon = describeDaylight({ scene, timeMinutes: minutes('12:30') });
  assert.ok(dawn.sun.warmth > noon.sun.warmth, 'dawn should be warmer than noon');
  assert.ok(dawn.sun.colour.r > dawn.sun.colour.b, 'a low sun reads red');
  assert.ok(noon.sun.colour.r >= noon.sun.colour.b, 'a high sun is close to neutral');
  assert.ok(dawn.background.r < dawn.background.b || dawn.background.b <= dawn.background.g,
    'a dark background reads blue');
});

test('exposure opens up as daylight fades so the lamps carry the room', () => {
  const scene = sceneWithWindow();
  const night = describeDaylight({ scene, timeMinutes: 0 });
  const noon = describeDaylight({ scene, timeMinutes: minutes('12:30') });
  assert.ok(night.exposure > noon.exposure, `${night.exposure} should exceed ${noon.exposure}`);
});

test('the reported day events come along with the state', () => {
  const state = describeDaylight({ scene: sceneWithWindow(), timeMinutes: minutes('12:30') });
  assert.match(state.clock, /^\d\d:\d\d$/);
  assert.equal(state.clock, '12:30');
  assert.ok(state.events.sunrise !== null && state.events.sunset !== null);
  assert.equal(state.site.name, 'Hong Kong');
});

test('invalid input is rejected', () => {
  assert.throws(() => describeDaylight({ scene: null }), TypeError);
  assert.throws(() => describeDaylight({ scene: { room: {}, objects: null } }), TypeError);
  assert.throws(() => describeDaylight({ scene: sceneWithWindow(), timeMinutes: Number.NaN }), /finite/);
  assert.throws(() => describeDaylight({
    scene: { room: createRoomScene().room, objects: [{ model: 'window', wall: 'roof' }] },
  }), /unsupported wall/);
});

test('the state is stable and repeatable', () => {
  const scene = sceneWithWindow();
  const a = describeDaylight({ scene, timeMinutes: minutes('15:00') });
  const b = describeDaylight({ scene, timeMinutes: minutes('15:00') });
  assert.deepEqual(a, b);
});
