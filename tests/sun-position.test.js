import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_DATE,
  SITE,
  dayEvents,
  formatClock,
  solarPosition,
} from '../src/simulation/sun-position.js';

// Hong Kong, chosen as the site: 22.3 degrees north, so the sun passes north of
// the zenith between the solstices and the compass sweep is the interesting one.

const minutes = (text) => {
  const [h, m] = text.split(':').map(Number);
  return h * 60 + m;
};
const degrees = (text) => {
  const [d, m, s = '0'] = text.split(':').map(Number);
  return d + m / 60 + s / 3600;
};

const near = (actual, expected, tolerance, label) => {
  assert.ok(Math.abs(actual - expected) <= tolerance,
    `${label}: expected about ${expected}, got ${actual}`);
};

test('the site is Hong Kong with a sane coordinate', () => {
  assert.equal(SITE.name, 'Hong Kong');
  near(SITE.latitude, 22.3193, 0.001, 'latitude');
  near(SITE.longitude, 114.1694, 0.001, 'longitude');
  assert.equal(SITE.timezoneOffsetHours, 8);
  assert.deepEqual(DEFAULT_DATE, { year: 2026, month: 3, day: 21 });
});

test('solar noon on the equinox sits near the highest point and due south', () => {
  // Declination is about 0 at the equinox, so noon altitude is 90 - latitude.
  const events = dayEvents();
  const noon = solarPosition({ timeMinutes: events.solarNoon });
  near(noon.altitude, 90 - SITE.latitude, 0.3, 'equinox noon altitude');
  near(noon.azimuth, 180, 0.5, 'equinox noon azimuth');
  // Hong Kong's clock runs ahead of its solar meridian by about 20 minutes.
  near(events.solarNoon, minutes('12:31'), 4, 'equinox solar noon clock time');
});

test('equinox day length is close to twelve hours', () => {
  const events = dayEvents();
  near(events.dayLengthMinutes / 60, 12, 0.2, 'equinox day length');
  // Published Hong Kong values for the March equinox.
  near(events.sunrise, minutes('06:27'), 6, 'equinox sunrise');
  near(events.sunset, minutes('18:34'), 6, 'equinox sunset');
});

test('the solstices set the annual extremes of altitude and day length', () => {
  const june = { year: 2026, month: 6, day: 21 };
  const december = { year: 2026, month: 12, day: 21 };

  const juneNoon = solarPosition({ date: june, timeMinutes: dayEvents({ date: june }).solarNoon });
  const decemberNoon = solarPosition({ date: december, timeMinutes: dayEvents({ date: december }).solarNoon });

  // Latitude 22.32 is below the tropic, so June noon is nearly overhead and the
  // sun is north of the zenith at solar noon.
  near(juneNoon.altitude, 90 - Math.abs(SITE.latitude - 23.44), 0.7, 'June noon altitude');
  near(juneNoon.azimuth, 0, 3, 'June noon azimuth, north of the zenith');

  // December noon altitude is 90 - (latitude + 23.44).
  near(decemberNoon.altitude, 90 - (SITE.latitude + 23.44), 0.7, 'December noon altitude');
  near(decemberNoon.azimuth, 180, 3, 'December noon azimuth, due south');

  const juneEvents = dayEvents({ date: june });
  const decemberEvents = dayEvents({ date: december });
  assert.ok(juneEvents.dayLengthMinutes > 13 * 60, `June day length was ${juneEvents.dayLengthMinutes}`);
  assert.ok(decemberEvents.dayLengthMinutes < 11 * 60, `December day length was ${decemberEvents.dayLengthMinutes}`);
  assert.ok(juneEvents.dayLengthMinutes - decemberEvents.dayLengthMinutes > 2 * 60,
    'the seasonal swing should exceed two hours');
});

test('midnight is below the horizon and midday is above it', () => {
  const midnight = solarPosition({ timeMinutes: 0 });
  const midday = solarPosition({ timeMinutes: minutes('12:30') });
  assert.ok(midnight.altitude < 0, `midnight altitude was ${midnight.altitude}`);
  assert.equal(midnight.aboveHorizon, false);
  assert.ok(midday.altitude > 60, `midday altitude was ${midday.altitude}`);
  assert.equal(midday.aboveHorizon, true);
});

test('the sun rises in the east and sets in the west', () => {
  const morning = solarPosition({ timeMinutes: minutes('07:00') });
  const evening = solarPosition({ timeMinutes: minutes('17:30') });
  assert.ok(morning.altitude > 0 && morning.altitude < 45, `morning altitude was ${morning.altitude}`);
  assert.ok(morning.azimuth > 60 && morning.azimuth < 120, `morning azimuth was ${morning.azimuth}`);
  assert.ok(evening.altitude > 0 && evening.altitude < 45, `evening altitude was ${evening.altitude}`);
  assert.ok(evening.azimuth > 240 && evening.azimuth < 300, `evening azimuth was ${evening.azimuth}`);
});

test('altitude increases monotonically through the morning', () => {
  let previous = -Infinity;
  for (const time of [minutes('06:00'), minutes('07:00'), minutes('08:00'), minutes('09:00'), minutes('10:00')]) {
    const { altitude } = solarPosition({ timeMinutes: time });
    assert.ok(altitude > previous, `altitude fell at ${formatClock(time)}`);
    previous = altitude;
  }
});

test('near the solstice the sun passes north of the zenith', () => {
  // The site is inside the tropics, so in June the declination exceeds the
  // latitude and the sun appears on the northern side of the zenith at noon.
  // Azimuth therefore runs east, through north, to the west rather than the
  // familiar east-south-west arc, which is what makes a room's aspect matter.
  const june = { year: 2026, month: 6, day: 21 };
  const azimuths = [];
  for (let time = 0; time < 1440; time += 10) {
    const { altitude, azimuth } = solarPosition({ date: june, timeMinutes: time });
    if (altitude > 0) azimuths.push(azimuth);
  }
  // Because the declination exceeds the latitude, the whole diurnal arc stays in
  // the northern half of the sky: it rises north of east, passes north of the
  // zenith, and sets north of west. Nothing is ever due south at noon.
  assert.ok(azimuths.every((a) => a < 90 || a > 270),
    `expected every azimuth north of east-west, saw ${Math.min(...azimuths)}-${Math.max(...azimuths)}`);
  assert.ok(azimuths.some((a) => a < 90), 'expected the sun north of east in the morning');
  assert.ok(azimuths.some((a) => a > 270), 'expected the sun north of west in the evening');
});

test('at the equinox the sun stays in the southern sky all day', () => {
  const azimuths = [];
  for (let time = 0; time < 1440; time += 10) {
    const { altitude, azimuth } = solarPosition({ timeMinutes: time });
    if (altitude > 0) azimuths.push(azimuth);
  }
  // At zero declination the arc runs the familiar east-south-west way, only
  // touching due east and due west right at sunrise and sunset.
  assert.ok(Math.min(...azimuths) > 88 && Math.max(...azimuths) < 272,
    `expected every azimuth in the southern half, saw ${Math.min(...azimuths)}-${Math.max(...azimuths)}`);
});

test('altitude and azimuth stay finite across a whole day', () => {
  for (let time = 0; time < 1440; time += 5) {
    const { altitude, azimuth } = solarPosition({ timeMinutes: time });
    assert.ok(Number.isFinite(altitude) && altitude >= -90 && altitude <= 90, `altitude ${altitude} at ${formatClock(time)}`);
    assert.ok(Number.isFinite(azimuth) && azimuth >= 0 && azimuth < 360, `azimuth ${azimuth} at ${formatClock(time)}`);
  }
});

test('times outside a single day wrap around', () => {
  const base = solarPosition({ timeMinutes: minutes('12:30') });
  const later = solarPosition({ timeMinutes: minutes('12:30') + 1440 });
  const earlier = solarPosition({ timeMinutes: minutes('12:30') - 1440 });
  near(later.altitude, base.altitude, 1e-9, 'wrapping forward');
  near(earlier.altitude, base.altitude, 1e-9, 'wrapping backward');
});

test('a different date changes the result', () => {
  const equinox = solarPosition({ timeMinutes: minutes('12:30') });
  const december = solarPosition({ date: { year: 2026, month: 12, day: 21 }, timeMinutes: minutes('12:30') });
  assert.ok(Math.abs(equinox.altitude - december.altitude) > 10);
});

test('the equation of time stays within its physical range', () => {
  for (let day = 1; day <= 365; day += 5) {
    const { equationOfTime } = solarPosition({
      date: { year: 2026, month: 1, day: Math.min(28, 1 + (day % 28)) },
      timeMinutes: 720,
    });
    assert.ok(Math.abs(equationOfTime) < 20, `equation of time was ${equationOfTime}`);
  }
});

test('polar sites report the all-day or all-night cases', () => {
  const arcticSummer = dayEvents({
    date: { year: 2026, month: 6, day: 21 },
    latitude: 78,
    longitude: 0,
    timezoneOffsetHours: 0,
  });
  assert.equal(arcticSummer.polar, 'day');
  assert.equal(arcticSummer.sunrise, null);

  const arcticWinter = dayEvents({
    date: { year: 2026, month: 12, day: 21 },
    latitude: 78,
    longitude: 0,
    timezoneOffsetHours: 0,
  });
  assert.equal(arcticWinter.polar, 'night');
  assert.equal(arcticWinter.sunset, null);
});

test('clock formatting and invalid input', () => {
  assert.equal(formatClock(0), '00:00');
  assert.equal(formatClock(minutes('07:42')), '07:42');
  assert.equal(formatClock(minutes('23:59')), '23:59');
  assert.equal(formatClock(1440), '00:00');
  assert.equal(formatClock(Number.NaN), '--:--');

  assert.throws(() => solarPosition({ timeMinutes: Number.NaN }), /finite/);
  assert.throws(() => solarPosition({ latitude: 95 }), /Latitude/);
  assert.throws(() => solarPosition({ longitude: -200 }), /Longitude/);
  assert.throws(() => solarPosition({ timezoneOffsetHours: 20 }), /Timezone/);
  assert.throws(() => solarPosition({ date: { year: 2026, month: 2, day: 30 } }), /out of range/);
  assert.throws(() => solarPosition({ date: { year: 2026, month: 13, day: 1 } }), /out of range/);
  assert.throws(() => solarPosition({ date: { year: 2026.5, month: 1, day: 1 } }), /integers/);
});

test('the solstice altitudes agree with published Hong Kong figures', () => {
  // Cross-check against the well-known local values rather than only
  // self-consistency, since a sign error in the obliquity term would still
  // round-trip through the arithmetic above.
  const juneDate = { year: 2026, month: 6, day: 21 };
  const decemberDate = { year: 2026, month: 12, day: 21 };
  const juneNoon = solarPosition({ date: juneDate, timeMinutes: dayEvents({ date: juneDate }).solarNoon });
  const decemberNoon = solarPosition({ date: decemberDate, timeMinutes: dayEvents({ date: decemberDate }).solarNoon });
  near(juneNoon.altitude, 88.9, 1.0, 'June solstice noon altitude');
  near(decemberNoon.altitude, 44.2, 1.0, 'December solstice noon altitude');

  const june = dayEvents({ date: { year: 2026, month: 6, day: 21 } });
  near(june.sunrise, minutes('05:41'), 4, 'June sunrise');
  near(june.sunset, minutes('19:11'), 4, 'June sunset');
});