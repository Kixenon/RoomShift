// Site, orientation and weather for a project. The sun uses the NOAA low-precision
// solar position equations (about ±0.5° for 1950–2050), which is far finer than the
// room model needs.

export const CITIES = Object.freeze([
  { id: 'hk', label: 'Hong Kong', lat: 22.32, lon: 114.17, tz: 8 },
  { id: 'bj', label: 'Beijing', lat: 39.9, lon: 116.4, tz: 8 },
  { id: 'sg', label: 'Singapore', lat: 1.35, lon: 103.82, tz: 8 },
  { id: 'tk', label: 'Tokyo', lat: 35.68, lon: 139.69, tz: 9 },
  { id: 'ldn', label: 'London', lat: 51.5, lon: -0.12, tz: 0 },
  { id: 'nyc', label: 'New York', lat: 40.71, lon: -74.0, tz: -5 },
  { id: 'sf', label: 'San Francisco', lat: 37.77, lon: -122.42, tz: -8 },
  { id: 'syd', label: 'Sydney', lat: -33.87, lon: 151.21, tz: 10 },
]);

export const DEFAULT_ENVIRONMENT = Object.freeze({
  city: 'hk',
  lat: 22.32,
  lon: 114.17,
  tz: 8,
  backWallBearing: 180, // compass direction the back wall faces (outward normal)
  month: 7,
  day: 15,
  hour: 15,
  baselineTemperature: 20,
});

export function environmentOf(project) {
  return { ...DEFAULT_ENVIRONMENT, ...(project?.environment ?? {}) };
}

const rad = (degrees) => degrees * Math.PI / 180;
const deg = (radians) => radians * 180 / Math.PI;

export function sunPosition({ lat, lon, tz, month, day, hour }) {
  const date = Date.UTC(2026, month - 1, day);
  const dayOfYear = Math.round((date - Date.UTC(2026, 0, 0)) / 86_400_000);
  const gamma = 2 * Math.PI / 365 * (dayOfYear - 1 + (hour - 12) / 24);
  const equationOfTime = 229.18 * (0.000075 + 0.001868 * Math.cos(gamma) - 0.032077 * Math.sin(gamma)
    - 0.014615 * Math.cos(2 * gamma) - 0.040849 * Math.sin(2 * gamma));
  const declination = 0.006918 - 0.399912 * Math.cos(gamma) + 0.070257 * Math.sin(gamma)
    - 0.006758 * Math.cos(2 * gamma) + 0.000907 * Math.sin(2 * gamma)
    - 0.002697 * Math.cos(3 * gamma) + 0.00148 * Math.sin(3 * gamma);
  const trueSolarMinutes = hour * 60 + equationOfTime + 4 * lon - 60 * tz;
  const hourAngle = rad(trueSolarMinutes / 4 - 180);
  const latitude = rad(lat);
  const cosZenith = Math.sin(latitude) * Math.sin(declination) + Math.cos(latitude) * Math.cos(declination) * Math.cos(hourAngle);
  const zenith = Math.acos(Math.min(1, Math.max(-1, cosZenith)));
  const azimuth = (deg(Math.atan2(
    Math.sin(hourAngle),
    Math.cos(hourAngle) * Math.sin(latitude) - Math.tan(declination) * Math.cos(latitude),
  )) + 180 + 360) % 360;
  return { altitude: 90 - deg(zenith), azimuth };
}

// Room frame: +x right, +z toward the back wall, +y up. Seen from above, compass
// bearings turn clockwise from +z (the back wall's facing) toward -x.
export function bearingToRoomVector(bearing, backWallBearing, altitude = 0) {
  const phi = rad(bearing - backWallBearing);
  const flat = Math.cos(rad(altitude));
  return { x: -Math.sin(phi) * flat, y: Math.sin(rad(altitude)), z: Math.cos(phi) * flat };
}

export function wallBearings(backWallBearing) {
  const wrap = (value) => ((value % 360) + 360) % 360;
  return { back: wrap(backWallBearing), left: wrap(backWallBearing + 90), front: wrap(backWallBearing + 180), right: wrap(backWallBearing + 270) };
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export const compassLabel = (bearing) => COMPASS[Math.round((((bearing % 360) + 360) % 360) / 45) % 8];

const angleBetween = (a, b) => Math.abs((((a - b) % 360) + 540) % 360 - 180);

// Which walls the sun reaches right now (sun in front of the wall and above the horizon).
export function sunlitWalls(environment) {
  const sun = sunPosition(environment);
  if (sun.altitude <= 0) return { sun, walls: [] };
  const walls = Object.entries(wallBearings(environment.backWallBearing))
    .filter(([, bearing]) => angleBetween(bearing, sun.azimuth) < 90)
    .map(([wall]) => wall);
  return { sun, walls };
}

export function windwardWall(environment, windFromBearing) {
  const entries = Object.entries(wallBearings(environment.backWallBearing));
  return entries.reduce((best, entry) => angleBetween(entry[1], windFromBearing) < angleBetween(best[1], windFromBearing) ? entry : best)[0];
}

// Current weather from Open-Meteo (free, no key). Returns null when offline.
export async function fetchWeather({ lat, lon }, fetchImpl = globalThis.fetch) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,cloud_cover&wind_speed_unit=ms`;
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`Weather unavailable (${response.status})`);
  const { current } = await response.json();
  return {
    temperature: current.temperature_2m,
    humidity: current.relative_humidity_2m,
    windSpeed: current.wind_speed_10m,
    windFrom: current.wind_direction_10m,
    cloudCover: current.cloud_cover,
    time: current.time,
  };
}

// ─── Ventilation ──────────────────────────────────────────────────────────
// Natural ventilation through open windows/doors, using the BS 5925 / CIBSE AM10
// simplified formulas. Single-sided: Q = 0.025·A·v. Cross-ventilation between
// walls: Q = Cd·A_eff·v·√ΔCp with Cd = 0.61, ΔCp ≈ 0.6 and
// 1/A_eff² = 1/A₁² + 1/A₂². A sliding window opens to half its area.
export function ventilation(scene, { windSpeed = null, people = 1 } = {}) {
  const { width, depth, height } = scene.room;
  const volume = width * depth * height;
  const open = scene.objects.filter((object) => (object.model === 'window' || object.model === 'door') && object.open);
  const speed = windSpeed ?? 2;
  const byWall = {};
  for (const opening of open) {
    const area = opening.dimensions.width * opening.dimensions.height * (opening.model === 'window' ? 0.5 : 1);
    byWall[opening.wall] = (byWall[opening.wall] ?? 0) + area;
  }
  const areas = Object.values(byWall).sort((a, b) => b - a);
  let flow = 0;
  let mode = 'closed';
  if (areas.length >= 2) {
    const effective = 1 / Math.sqrt(1 / areas[0] ** 2 + 1 / areas[1] ** 2);
    flow = 0.61 * effective * speed * Math.sqrt(0.6);
    mode = 'cross';
  } else if (areas.length === 1) {
    flow = 0.025 * areas[0] * speed;
    mode = 'single';
  }
  flow += volume * 0.3 / 3600; // background infiltration ≈ 0.3 air changes per hour
  const outdoorCo2 = 420;
  const co2PerPerson = 0.0052; // L/s of CO₂ at rest
  return {
    mode,
    assumedWind: windSpeed === null,
    flow,
    ach: flow * 3600 / volume,
    litresPerPerson: people > 0 ? flow * 1000 / people : Infinity,
    co2: Math.round(outdoorCo2 + (people * co2PerPerson) / (flow * 1000) * 1e6),
  };
}

// ─── Steady-state heat balance ────────────────────────────────────────────
// Indoor temperature where gains equal losses:
//   T_in = T_out + (Q_solar + Q_internal − Q_cooling) / (ΣUA + ρ·cₚ·V̇)
// Walls with an opening are treated as external (U = 2.0 W/m²K, solid
// concrete/brick); other walls adjoin heated rooms. Single glazing U = 5.7 W/m²K,
// solar heat gain coefficient 0.7. Solar irradiance on each window comes from
// the sun position: direct normal × cos(incidence) plus half the sky diffuse.
const WATTS = Object.freeze({ tv: 100, fridge: 150, router: 10, speaker: 20, monitor: 25, laptop: 45 });
export const ELECTRICITY_PRICE = Object.freeze({ hk: 1.4, bj: 0.55, sg: 0.3, tk: 31, ldn: 0.25, nyc: 0.23, sf: 0.32, syd: 0.33 });
export const CURRENCY = Object.freeze({ hk: 'HK$', bj: '¥', sg: 'S$', tk: '¥', ldn: '£', nyc: '$', sf: '$', syd: 'A$' });

export function heatBalance(scene, environment, { outdoor = null, windSpeed = null, cloudCover = 20 } = {}) {
  const env = { ...DEFAULT_ENVIRONMENT, ...environment };
  const { width, depth, height } = scene.room;
  const people = env.people ?? 1;
  const outdoorTemperature = outdoor ?? env.baselineTemperature;
  const openings = scene.objects.filter((object) => object.model === 'window' || object.model === 'door');
  const windows = scene.objects.filter((object) => object.model === 'window');
  const externalWalls = new Set(windows.map((window) => window.wall));
  if (!externalWalls.size) externalWalls.add('back');
  const wallArea = (wall) => (wall === 'back' || wall === 'front' ? width : depth) * height;
  let ua = 0;
  for (const wall of externalWalls) {
    const glass = windows.filter((window) => window.wall === wall).reduce((sum, window) => sum + window.dimensions.width * window.dimensions.height, 0);
    ua += 2.0 * Math.max(0, wallArea(wall) - glass) + 5.7 * glass;
  }
  // Partitions, floor and ceiling exchange heat with neighbouring spaces, taken
  // to sit near the outdoor temperature (U ≈ 1.5 W/m²K for plastered block/slab).
  const internalArea = ['back', 'front', 'left', 'right'].filter((wall) => !externalWalls.has(wall)).reduce((sum, wall) => sum + wallArea(wall), 0) + 2 * width * depth;
  ua += 1.5 * internalArea;
  const air = ventilation(scene, { windSpeed, people });
  const ventConductance = 1.2 * 1005 * air.flow;

  // Solar gain through glass
  const sun = sunPosition(env);
  const clear = 1 - Math.min(1, cloudCover / 100) * 0.75;
  const directNormal = sun.altitude > 0 ? 850 * clear * Math.min(1, Math.sin(sun.altitude * Math.PI / 180) * 3) : 0;
  const diffuse = sun.altitude > -3 ? 60 + 140 * Math.max(0, Math.sin(sun.altitude * Math.PI / 180)) : 0;
  const bearings = wallBearings(env.backWallBearing);
  let solar = 0;
  const solarByWindow = [];
  for (const window of windows) {
    const azimuthGap = Math.abs((((sun.azimuth - bearings[window.wall]) % 360) + 540) % 360 - 180) * Math.PI / 180;
    const incidence = Math.cos(sun.altitude * Math.PI / 180) * Math.cos(azimuthGap);
    const irradiance = Math.max(0, directNormal * incidence) + diffuse * 0.5;
    const watts = window.dimensions.width * window.dimensions.height * 0.7 * irradiance;
    solar += watts;
    solarByWindow.push({ window, watts });
  }

  const on = (object) => object.props?.on !== 0;
  const heaters = scene.objects.filter((object) => object.model === 'heater' && on(object))
    .reduce((sum, object) => sum + (object.props?.watts ?? 1500), 0);
  const lights = scene.objects.filter((object) => ['lamp', 'deskLamp', 'ceilingLight'].includes(object.model) && on(object))
    .reduce((sum, object) => sum + (object.props?.lumens ?? { lamp: 800, deskLamp: 450, ceilingLight: 1600 }[object.model]) / 100, 0);
  const appliances = scene.objects.reduce((sum, object) => sum + (WATTS[object.model] ?? 0), 0) + lights;
  const bodies = people * 100;
  const gains = solar + heaters + appliances + bodies;
  const conductance = ua + ventConductance;
  const freeRunning = outdoorTemperature + gains / Math.max(1, conductance);

  // AC: cooling capacity scales with fan speed; it throttles to hold 24 °C.
  const acUnits = scene.objects.filter((object) => object.model === 'ac' && on(object));
  const capacity = acUnits.reduce((sum, object) => sum + 2600 * [0.6, 1, 1.25][Math.round(object.props?.speed ?? 2) - 1], 0);
  const setpoint = 24;
  const coolingNeeded = Math.max(0, (freeRunning - setpoint) * conductance);
  const cooling = Math.min(capacity, coolingNeeded);
  const indoor = freeRunning - cooling / Math.max(1, conductance);
  const electricWatts = heaters + appliances + cooling / 3; // AC with COP ≈ 3
  const price = ELECTRICITY_PRICE[env.city] ?? 1;
  return {
    outdoor: outdoorTemperature,
    indoor,
    freeRunning,
    gains: { solar, heaters, appliances, people: bodies },
    losses: { fabric: ua * (indoor - outdoorTemperature), ventilation: ventConductance * (indoor - outdoorTemperature) },
    cooling,
    capacity,
    coolingShort: Math.max(0, coolingNeeded - capacity),
    conductance,
    solarByWindow,
    electricWatts,
    monthlyCost: electricWatts / 1000 * 8 * 30 * price,
    currency: CURRENCY[env.city] ?? '',
  };
}
