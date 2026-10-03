// Solar position, after the NOAA algorithm.
//
// The site is fixed to Hong Kong so the arc and the day length are physically
// meaningful rather than decorative. At 22.3 degrees north the sun passes
// north of the zenith between the solstices, so its azimuth sweeps through the
// whole compass and the room's aspect genuinely changes through the day.
//
// This is a geometric model of where the sun is. It is not a photometric
// model: it says nothing about irradiance, sky conditions, or how much light
// actually reaches the room.

export const SITE = Object.freeze({
  name: 'Hong Kong',
  latitude: 22.3193,
  longitude: 114.1694,
  timezoneOffsetHours: 8,
});

// A fixed default date keeps the preview stable and testable. Nothing here
// depends on the calendar day; callers can pass another date if they want
// seasonal variation.
export const DEFAULT_DATE = Object.freeze({ year: 2026, month: 3, day: 21 }); // equinox

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function normaliseDegrees(value) {
  return ((value % 360) + 360) % 360;
}

/** Julian day number for a Gregorian calendar date, after Meeus. */
function julianDay({ year, month, day }) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    throw new RangeError('Date parts must be integers.');
  }
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new RangeError('Date is out of range.');
  }
  const shiftedYear = month <= 2 ? year - 1 : year;
  const shiftedMonth = month <= 2 ? month + 12 : month;
  const centuryTerm = Math.floor(shiftedYear / 100);
  // The Gregorian correction moves the epoch after 1582; without it the year
  // numbering drifts by days, which is enough to move the sun visibly.
  const gregorian = 2 - centuryTerm + Math.floor(centuryTerm / 4);
  return Math.floor(365.25 * (shiftedYear + 4716))
    + Math.floor(30.6001 * (shiftedMonth + 1))
    + day + gregorian - 1524.5;
}

function daysInMonth(year, month) {
  return [31, (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28,
    31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

/** Julian centuries since J2000.0. */
function julianCentury(jd) {
  return (jd - 2451545) / 36525;
}

function solarGeometry(date, century) {
  const meanLongitude = normaliseDegrees(280.46646 + century * (36000.76983 + century * 0.0003032));
  const meanAnomaly = 357.52911 + century * (35999.05029 - 0.0001537 * century);
  const eccentricity = 0.016708634 - century * (0.000042037 + 0.0000001267 * century);

  const equationOfCentre = Math.sin(meanAnomaly * RAD) * (1.914602 - century * (0.004817 + 0.000014 * century))
    + Math.sin(2 * meanAnomaly * RAD) * (0.019993 - 0.000101 * century)
    + Math.sin(3 * meanAnomaly * RAD) * 0.000289;

  const trueLongitude = meanLongitude + equationOfCentre;
  const omega = 125.04 - 1934.136 * century;
  const apparentLongitude = trueLongitude - 0.00569 - 0.00478 * Math.sin(omega * RAD);

  const meanObliquity = 23 + (26 + (21.448 - century * (46.815 + century * (0.00059 - century * 0.001813))) / 60) / 60;
  const obliquity = meanObliquity + 0.00256 * Math.cos(omega * RAD);
  const declination = Math.asin(Math.sin(obliquity * RAD) * Math.sin(apparentLongitude * RAD)) * DEG;

  const y = Math.tan((obliquity / 2) * RAD) ** 2;
  const equationOfTime = 4 * DEG * (
    y * Math.sin(2 * meanLongitude * RAD)
    - 2 * eccentricity * Math.sin(meanAnomaly * RAD)
    + 4 * eccentricity * y * Math.sin(meanAnomaly * RAD) * Math.cos(2 * meanLongitude * RAD)
    - 0.5 * y * y * Math.sin(4 * meanLongitude * RAD)
    - 1.25 * eccentricity * eccentricity * Math.sin(2 * meanAnomaly * RAD)
  );

  return { meanLongitude, declination, equationOfTime };
}

/**
 * Sun altitude and azimuth for a clock time.
 *
 * `timeMinutes` is local clock time in minutes past midnight, so the caller
 * passes what the room's clock reads rather than worrying about UTC.
 */
export function solarPosition({
  date = DEFAULT_DATE,
  timeMinutes = 720,
  latitude = SITE.latitude,
  longitude = SITE.longitude,
  timezoneOffsetHours = SITE.timezoneOffsetHours,
} = {}) {
  if (!Number.isFinite(timeMinutes)) throw new RangeError('Time must be a finite number of minutes.');
  timeMinutes = ((timeMinutes % 1440) + 1440) % 1440;
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    throw new RangeError('Latitude must be between -90 and 90.');
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new RangeError('Longitude must be between -180 and 180.');
  }
  if (!Number.isFinite(timezoneOffsetHours) || timezoneOffsetHours < -12 || timezoneOffsetHours > 14) {
    throw new RangeError('Timezone offset must be between -12 and 14 hours.');
  }

  const century = julianCentury(julianDay(date));
  const { declination, equationOfTime } = solarGeometry(date, century);

  // True solar time, then the hour angle measured from solar noon.
  const trueSolarTime = timeMinutes + equationOfTime + 4 * longitude - 60 * timezoneOffsetHours;
  const hourAngle = ((trueSolarTime / 4) - 180 + 540) % 360 - 180;

  const latRad = latitude * RAD;
  const decRad = declination * RAD;
  const hourRad = hourAngle * RAD;

  const cosZenith = clamp(
    Math.sin(latRad) * Math.sin(decRad) + Math.cos(latRad) * Math.cos(decRad) * Math.cos(hourRad),
    -1,
    1,
  );
  const zenith = Math.acos(cosZenith) * DEG;
  const altitude = 90 - zenith;
  const sinZenith = Math.sin(zenith * RAD);

  // Azimuth measured clockwise from north. The afternoon branch flips, because
  // the same cosine describes both sides of the meridian.
  let azimuth;
  if (Math.abs(sinZenith) < 1e-6) {
    azimuth = 0;
  } else {
    const cosine = clamp((Math.sin(decRad) * Math.cos(latRad)
      - Math.cos(decRad) * Math.sin(latRad) * Math.cos(hourRad)) / sinZenith, -1, 1);
    azimuth = Math.acos(cosine) * DEG;
    if (hourAngle > 0) azimuth = 360 - azimuth;
  }

  return {
    altitude,
    azimuth: normaliseDegrees(azimuth),
    declination,
    equationOfTime,
    hourAngle,
    aboveHorizon: altitude > 0,
  };
}

/**
 * Clock times of sunrise, solar noon and sunset, in minutes past midnight, or
 * null when the sun does not cross the horizon on that date.
 */
export function dayEvents({ date = DEFAULT_DATE, ...rest } = {}) {
  const century = julianCentury(julianDay(date));
  const { declination, equationOfTime } = solarGeometry(date, century);
  const latitude = rest.latitude ?? SITE.latitude;
  const longitude = rest.longitude ?? SITE.longitude;
  const timezoneOffsetHours = rest.timezoneOffsetHours ?? SITE.timezoneOffsetHours;

  const latRad = latitude * RAD;
  const decRad = declination * RAD;
  const cosineHourAngle = (Math.sin(-0.833 * RAD) - Math.sin(latRad) * Math.sin(decRad))
    / (Math.cos(latRad) * Math.cos(decRad));

  const noon = 720 - 4 * longitude - equationOfTime + 60 * timezoneOffsetHours;
  if (cosineHourAngle > 1) return { sunrise: null, solarNoon: noon, sunset: null, polar: 'night' };
  if (cosineHourAngle < -1) return { sunrise: null, solarNoon: noon, sunset: null, polar: 'day' };

  const hourAngle = Math.acos(cosineHourAngle) * DEG;
  const sunrise = noon - hourAngle * 4;
  const sunset = noon + hourAngle * 4;
  return {
    sunrise: normaliseMinutes(sunrise),
    solarNoon: normaliseMinutes(noon),
    sunset: normaliseMinutes(sunset),
    polar: null,
    dayLengthMinutes: sunset - sunrise,
  };
}

function normaliseMinutes(value) {
  return ((value % 1440) + 1440) % 1440;
}

/** "07:42" from minutes past midnight. */
export function formatClock(minutes) {
  if (!Number.isFinite(minutes)) return '--:--';
  const wrapped = ((minutes % 1440) + 1440) % 1440;
  const hours = Math.floor(wrapped / 60);
  const mins = Math.round(wrapped % 60);
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}