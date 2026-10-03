import { isWallItem, openArea, windowCovering } from './room-scene.js';
import { sunPosition, bearingToRoomVector } from './environment.js';

// ─── Thermal comfort: ISO 7730 PMV / PPD ──────────────────────────────────
// Predicted Mean Vote (−3 cold … +3 hot) and Predicted Percentage Dissatisfied,
// from air temperature, mean radiant temperature, air speed, humidity, metabolic
// rate (met) and clothing (clo). Straight port of the standard's algorithm.
export function pmvPpd({ airTemperature, radiantTemperature = airTemperature, airSpeed = 0.1, humidity = 50, met = 1.1, clo = 0.5 }) {
  const ta = airTemperature;
  const tr = radiantTemperature;
  const pa = humidity * 10 * Math.exp(16.6536 - 4030.183 / (ta + 235));
  const icl = 0.155 * clo;
  const m = met * 58.15;
  const mw = m;
  const fcl = icl <= 0.078 ? 1 + 1.29 * icl : 1.05 + 0.645 * icl;
  const hcf = 12.1 * Math.sqrt(Math.max(0.05, airSpeed));
  const taa = ta + 273;
  const tra = tr + 273;
  const tcla = taa + (35.5 - ta) / (3.5 * icl + 0.1);
  const p1 = icl * fcl;
  const p2 = p1 * 3.96;
  const p3 = p1 * 100;
  const p4 = p1 * taa;
  const p5 = 308.7 - 0.028 * mw + p2 * (tra / 100) ** 4;
  let xn = tcla / 100;
  let xf = tcla / 50;
  let hc = hcf;
  for (let iteration = 0; iteration < 150 && Math.abs(xn - xf) > 0.00015; iteration += 1) {
    xf = (xf + xn) / 2;
    const hcn = 2.38 * Math.abs(100 * xf - taa) ** 0.25;
    hc = Math.max(hcf, hcn);
    xn = (p5 + p4 * hc - p2 * xf ** 4) / (100 + p3 * hc);
  }
  const tcl = 100 * xn - 273;
  const hl1 = 3.05 * 0.001 * (5733 - 6.99 * mw - pa);
  const hl2 = mw > 58.15 ? 0.42 * (mw - 58.15) : 0;
  const hl3 = 1.7e-5 * m * (5867 - pa);
  const hl4 = 0.0014 * m * (34 - ta);
  const hl5 = 3.96 * fcl * (xn ** 4 - (tra / 100) ** 4);
  const hl6 = fcl * hc * (tcl - ta);
  const ts = 0.303 * Math.exp(-0.036 * m) + 0.028;
  const pmv = ts * (mw - hl1 - hl2 - hl3 - hl4 - hl5 - hl6);
  const ppd = 100 - 95 * Math.exp(-0.03353 * pmv ** 4 - 0.2179 * pmv ** 2);
  return { pmv, ppd };
}

export function comfortLabel(pmv) {
  if (pmv > 2.5) return 'Hot';
  if (pmv > 1.5) return 'Warm';
  if (pmv > 0.5) return 'Slightly warm';
  if (pmv >= -0.5) return 'Comfortable';
  if (pmv >= -1.5) return 'Slightly cool';
  if (pmv >= -2.5) return 'Cool';
  return 'Cold';
}

// What people do at each kind of seat: activity (met) and extra insulation.
const ACTIVITY = Object.freeze({
  desk: { met: 1.1, extraClo: 0.1, label: 'working' },
  chair: { met: 1.1, extraClo: 0.1, label: 'seated' },
  sofa: { met: 1.0, extraClo: 0.15, label: 'relaxing' },
  bed: { met: 0.8, extraClo: 0.9, label: 'sleeping under a duvet' },
});

// Clothing follows the season the room is in: light in warm rooms, more in cool.
export const seasonalClo = (temperature) => (temperature >= 26 ? 0.5 : temperature >= 22 ? 0.7 : 1.0);

export function seatComfort(seat, { airTemperature, airSpeed = 0.1, humidity = 55 }) {
  const activity = ACTIVITY[seat.model] ?? ACTIVITY.chair;
  const clo = seasonalClo(airTemperature) + activity.extraClo;
  const result = pmvPpd({ airTemperature, airSpeed, humidity, met: activity.met, clo });
  return { ...result, label: comfortLabel(result.pmv), activity: activity.label, clo, met: activity.met };
}

// ─── Sun hours ────────────────────────────────────────────────────────────
// Hours of direct sun reaching a point today, sampled every 15 minutes: the sun
// must be up, in front of a window on its way in, and not blocked by the frame.
export function sunHours(scene, environment, point) {
  const windows = scene.objects.filter((object) => object.model === 'window' && windowCovering(object).light > 0.2);
  let quarterHours = 0;
  for (let hour = 4; hour <= 21; hour += 0.25) {
    const sun = sunPosition({ ...environment, hour });
    if (sun.altitude <= 2) continue;
    const toSun = bearingToRoomVector(sun.azimuth, environment.backWallBearing, sun.altitude);
    if (windows.some((window) => throughWindow(scene.room, window, point, toSun))) quarterHours += 1;
  }
  return quarterHours / 4;
}

function throughWindow(room, window, point, direction) {
  const alongX = window.wall === 'back' || window.wall === 'front';
  const plane = window.wall === 'front' ? 0 : window.wall === 'back' ? room.depth : window.wall === 'left' ? 0 : room.width;
  const component = alongX ? direction.z : direction.x;
  if (Math.abs(component) < 1e-6) return false;
  const t = (plane - (alongX ? point.z : point.x)) / component;
  if (t <= 0) return false;
  const y = point.y + direction.y * t;
  const along = alongX ? point.x + direction.x * t : point.z + direction.z * t;
  const center = alongX ? window.position.x : window.position.z;
  return y >= window.position.y && y <= window.position.y + window.dimensions.height && Math.abs(along - center) <= window.dimensions.width / 2;
}

// ─── Outside noise ────────────────────────────────────────────────────────
// Indoor level from outdoor noise through the façade (simplified EN 12354-3):
// L_in = L_out − R + 10·log10(S / A), with R ≈ 25 dB for closed single glazing,
// ~32 dB for a solid wall, ~10 dB through an open area; S each element's area and
// A the room's absorption (m² sabins).
export const OUTDOOR_NOISE = Object.freeze({
  quiet: { label: 'Quiet (garden, courtyard)', level: 45 },
  residential: { label: 'Residential street', level: 55 },
  street: { label: 'Busy street', level: 65 },
  road: { label: 'Main road / traffic', level: 75 },
});

export function indoorNoise(scene, outdoorLevel, absorption) {
  let energy = 0;
  for (const opening of scene.objects.filter(isWallItem)) {
    const frame = opening.dimensions.width * opening.dimensions.height;
    const open = Math.min(frame, openArea(opening));
    const closed = frame - open;
    if (open > 0) energy += open * 10 ** ((outdoorLevel - 10) / 10);
    if (closed > 0) energy += closed * 10 ** ((outdoorLevel - (opening.model === 'door' ? 30 : 25)) / 10);
  }
  if (!energy) return null;
  return 10 * Math.log10(energy / Math.max(1, absorption));
}
