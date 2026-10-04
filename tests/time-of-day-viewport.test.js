import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { RoomViewport } from '../src/scene/room-viewport.js';
import { addWindow, createRoomScene, setDeviceEnabled, setWindowOpen } from '../src/model/room-scene.js';
import { DEFAULT_LAMP_POWER, DEFAULT_TIME_MINUTES } from '../src/simulation/daylight.js';

// Exercises the three.js side of the time-of-day model against stand-in lights,
// which is enough to prove the state is pushed into the scene without needing a
// GPU. Rendering is covered by the browser tests.

function harness(overrides = {}) {
  const { roomScene, methods, ...rest } = overrides;
  const scene = new THREE.Scene();
  // The real viewport always has a background colour; a bare Scene does not.
  scene.background = new THREE.Color(0xf6f8f6);
  const viewport = {
    roomScene: roomScene ?? createRoomScene(),
    timeMinutes: DEFAULT_TIME_MINUTES,
    daylightState: null,
    lightingPreview: true,
    keyLight: new THREE.DirectionalLight(0xffffff, 1),
    hemisphereLight: new THREE.HemisphereLight(0xffffff, 0xffffff, 1),
    scene,
    sceneRoot: new THREE.Group(),
    renderer: { domElement: { dataset: {} }, toneMappingExposure: 1 },
    lightingLights: [],
    setTimeOfDay: RoomViewport.prototype.setTimeOfDay,
    applyDaylight: RoomViewport.prototype.applyDaylight,
    updateDaylightDataset: RoomViewport.prototype.updateDaylightDataset,
    clearDaylightDataset: RoomViewport.prototype.clearDaylightDataset,
    ...methods,
    ...rest,
  };
  scene.add(viewport.keyLight, viewport.hemisphereLight);
  return viewport;
}

const sceneWithOpenWindow = (wall = 'back') => {
  const withWindow = addWindow(createRoomScene(), wall);
  return setWindowOpen(withWindow.scene, 'window-1', true).scene;
};

const setClock = (viewport, timeMinutes) => viewport.setTimeOfDay({ timeMinutes });

test('setting the time of day derives and publishes the daylight state', () => {
  const viewport = harness();
  const state = setClock(viewport, 9 * 60);

  assert.equal(state.clock, '09:00');
  assert.ok(state.sun.altitude > 0);
  assert.equal(viewport.renderer.domElement.dataset.clockTime, '09:00');
  assert.equal(viewport.renderer.domElement.dataset.sunPatches, String(state.patches.length));
  assert.ok(Number.isFinite(Number(viewport.renderer.domElement.dataset.sunAltitude)));
});

test('the sun light follows the altitude and azimuth', () => {
  const viewport = harness();

  // The intensity ramp only spans the horizon: once the sun is comfortably up
  // the light is at full strength and the altitude alone changes, which is why
  // a mid-morning and a mid-afternoon reading are the same brightness.
  setClock(viewport, 6 * 60);
  const dawn = { intensity: viewport.keyLight.intensity, altitude: viewport.daylightState.sun.altitude };
  setClock(viewport, 9 * 60);
  const morning = { intensity: viewport.keyLight.intensity, altitude: viewport.daylightState.sun.altitude, azimuth: viewport.daylightState.sun.azimuth };
  setClock(viewport, 13 * 60);
  const afternoon = { intensity: viewport.keyLight.intensity, altitude: viewport.daylightState.sun.altitude };

  assert.ok(dawn.altitude < 0, `pre-dawn sun should be below the horizon, got ${dawn.altitude}`);
  assert.equal(dawn.intensity, 0);
  assert.ok(morning.intensity > dawn.intensity, 'light should ramp in after sunrise');
  assert.ok(morning.intensity === afternoon.intensity, 'full daylight has a flat intensity');
  assert.ok(afternoon.altitude > morning.altitude, 'the sun should be higher at 13:00');
  assert.ok(morning.azimuth > 60 && morning.azimuth < 130, `morning azimuth was ${morning.azimuth}`);
  assert.equal(viewport.keyLight.castShadow, true);
  assert.equal(viewport.keyLight.visible, true);
});

test('the sun light is parked above the room and aims at its centre', () => {
  const viewport = harness();
  setClock(viewport, 11 * 60);
  const light = viewport.keyLight;

  assert.ok(light.position.length() > 0, 'the light must not sit at the origin');
  assert.ok(light.position.y > 0, 'the light must be above the floor');
  assert.equal(light.target.position.x, 0);
  assert.equal(light.target.position.z, 0);
});

test('at night the sun is hidden and the exposure opens up', () => {
  const viewport = harness();
  setClock(viewport, 12 * 60);
  const dayExposure = viewport.renderer.toneMappingExposure;
  setClock(viewport, 0);
  const state = viewport.daylightState;

  assert.ok(state.sun.altitude < 0);
  assert.equal(viewport.keyLight.visible, false);
  assert.equal(viewport.keyLight.castShadow, false);
  assert.equal(viewport.keyLight.intensity, 0);
  assert.ok(viewport.renderer.toneMappingExposure > dayExposure);
});

test('lamp power is independent of time of day', () => {
  const viewport = harness();
  viewport.lightingLights = [{ power: 0, userData: { objectId: 'lamp-1' } }];

  setClock(viewport, 13 * 60);
  assert.equal(viewport.lightingLights[0].power, DEFAULT_LAMP_POWER);

  setClock(viewport, 22 * 60);
  assert.equal(viewport.lightingLights[0].power, DEFAULT_LAMP_POWER);
});

test('lamp power follows its device on setting at any time', () => {
  const viewport = harness();
  viewport.lightingLights = [{ power: DEFAULT_LAMP_POWER, userData: { objectId: 'lamp-1' } }];

  viewport.roomScene = setDeviceEnabled(viewport.roomScene, 'lamp-1', false).scene;
  setClock(viewport, 13 * 60);
  assert.equal(viewport.lightingLights[0].power, 0);

  setClock(viewport, 0);
  assert.equal(viewport.lightingLights[0].power, 0);
});

test('daylight uses shadow-casting illumination without unoccluded overlay polygons', () => {
  const viewport = harness({ roomScene: sceneWithOpenWindow('back') });
  setClock(viewport, 10 * 60);
  assert.equal(viewport.sceneRoot.children.length, 0);
  assert.ok(viewport.daylightState.patches.length > 0);
  assert.equal(viewport.keyLight.castShadow, true);
  const actual = viewport.keyLight.position.clone().sub(viewport.keyLight.target.position).normalize();
  const expected = new THREE.Vector3(...Object.values(viewport.daylightState.sun.direction));
  assert.ok(actual.distanceTo(expected) < 1e-10);
  assert.deepEqual(viewport.keyLight.target.position.toArray(), [0, 0, 0]);
});

test('daylight state is derived but not applied while the preview is off', () => {
  const viewport = harness({ lightingPreview: false });
  const state = setClock(viewport, 9 * 60);

  assert.ok(state, 'the state is still computed so the inspector can show it');
  assert.equal(viewport.keyLight.intensity, 1, 'the studio key light is left alone');
  assert.equal(viewport.renderer.toneMappingExposure, 1);
  assert.equal(viewport.renderer.domElement.dataset.clockTime, undefined);
});

test('the dataset is cleared when the preview is switched off', () => {
  const viewport = harness();
  setClock(viewport, 9 * 60);
  assert.ok(viewport.renderer.domElement.dataset.clockTime);

  viewport.clearDaylightDataset();
  assert.equal(viewport.renderer.domElement.dataset.clockTime, undefined);
  assert.equal(viewport.renderer.domElement.dataset.sunAltitude, undefined);
  assert.equal(viewport.renderer.domElement.dataset.sunPatches, undefined);
});

test('the background tracks the daylight', () => {
  const viewport = harness();
  setClock(viewport, 12 * 60);
  const day = viewport.scene.background.clone();
  setClock(viewport, 0);
  const night = viewport.scene.background.clone();
  assert.ok(night.getHSL({ h: 0, s: 0, l: 0 }).l < day.getHSL({ h: 0, s: 0, l: 0 }).l,
    'the background should darken at night');
});
