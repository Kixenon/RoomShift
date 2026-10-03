import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LAMP_AUTO_ALTITUDE_DEGREES,
  formatHour,
  lampsOnAt,
  sunPosition,
} from '../src/model/environment.js';

// The lamps half of the time-of-day feature: dusk switches the lamps, and the
// user's switch switches them back. These cover the pure decision so the
// viewport and the lux lens cannot drift apart.

test('the lamps follow dusk until the switch is touched', () => {
  assert.equal(lampsOnAt(20), false, 'high sun means no lamps');
  assert.equal(lampsOnAt(0), true, 'the horizon means lamps');
  assert.equal(lampsOnAt(-15), true, 'night means lamps');
  assert.equal(lampsOnAt(20, true), true, 'a hand can overrule the day');
  assert.equal(lampsOnAt(-15, false), false, 'and overrule the night');
  assert.equal(lampsOnAt(0, null), true, 'null falls back to dusk');
});

test('the dusk threshold sits just above the horizon', () => {
  assert.equal(lampsOnAt(LAMP_AUTO_ALTITUDE_DEGREES - 0.1), true);
  assert.equal(lampsOnAt(LAMP_AUTO_ALTITUDE_DEGREES + 0.1), false);
});

test('a room with no site keeps the historical always-on lamps', () => {
  assert.equal(lampsOnAt(null), true);
  assert.equal(lampsOnAt(undefined), true);
});

test('formatHour renders a clock face', () => {
  assert.equal(formatHour(13.5), '13:30');
  assert.equal(formatHour(5), '05:00');
  assert.equal(formatHour(20.75), '20:45');
  assert.equal(formatHour(0), '00:00');
});

// The solar engine behind the dock: NOAA's low-precision equations. These pin
// down the qualitative behaviour the UI promises, using the default city.

const hongKong = { lat: 22.32, lon: 114.17, tz: 8 };

test('the Hong Kong sun is up at noon and down at night', () => {
  const noon = sunPosition({ ...hongKong, month: 7, day: 15, hour: 12.5 });
  assert.ok(noon.altitude > 60, `expected a high noon sun, got ${noon.altitude}°`);
  assert.ok(sunPosition({ ...hongKong, month: 7, day: 15, hour: 0 }).altitude < 0);
  assert.ok(sunPosition({ ...hongKong, month: 7, day: 15, hour: 20 }).altitude < 0,
    'by 20:00 the lamps should have taken over');
});

test('the sun rises in the east and sets in the west', () => {
  const morning = sunPosition({ ...hongKong, month: 7, day: 15, hour: 8 });
  assert.ok(morning.azimuth > 45 && morning.azimuth < 135, `morning azimuth ${morning.azimuth}°`);
  const afternoon = sunPosition({ ...hongKong, month: 7, day: 15, hour: 16 });
  assert.ok(afternoon.azimuth > 225 && afternoon.azimuth < 315, `afternoon azimuth ${afternoon.azimuth}°`);
});

test('a summer noon beats a winter noon', () => {
  const summer = sunPosition({ ...hongKong, month: 7, day: 15, hour: 12.5 });
  const winter = sunPosition({ ...hongKong, month: 1, day: 15, hour: 12.5 });
  assert.ok(summer.altitude > winter.altitude,
    `summer ${summer.altitude}° should clear winter ${winter.altitude}°`);
});
