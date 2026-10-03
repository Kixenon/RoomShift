import { environmentOf, heatBalance, ventilation } from '../model/environment.js';
import { evaluateLayout } from '../model/layout-advisor.js';
import { lightContext, luxAt, roomAcoustics, wifiAt } from '../simulation/room-propagation.js';

// One row of numbers per layout, used by variant comparison and the report.
// Every value comes from the same models the lenses use.
export function roomMetrics(scene, project, weather = null) {
  const environment = environmentOf(project);
  const layout = evaluateLayout(scene, { environment, weather });
  const desk = scene.objects.find((object) => object.model === 'desk') ?? scene.objects.find((object) => object.model === 'table');
  const bed = scene.objects.find((object) => object.model === 'bed');
  const deskPoint = desk && { x: desk.position.x, y: desk.position.y + desk.dimensions.height + 0.01, z: desk.position.z };
  const light = lightContext(scene, environment, weather?.cloudCover);
  const acoustics = roomAcoustics(scene);
  const air = ventilation(scene, { windSpeed: weather?.windSpeed ?? null, people: environment.people ?? 1 });
  const heat = heatBalance(scene, environment, { outdoor: weather?.temperature ?? null, windSpeed: weather?.windSpeed ?? null, cloudCover: weather?.cloudCover });
  return {
    score: layout.score,
    categories: layout.categories,
    issues: layout.issues,
    wins: layout.wins,
    walkable: layout.openFloor,
    deskLux: deskPoint ? luxAt(light, deskPoint) : null,
    deskWifi: deskPoint ? wifiAt(scene, { ...deskPoint, y: 1 }) : null,
    bedWifi: bed ? wifiAt(scene, { x: bed.position.x, y: 0.8, z: bed.position.z }) : null,
    rt60: acoustics.rt60,
    ach: air.ach,
    co2: air.co2,
    indoor: heat.indoor,
    freeRunning: heat.freeRunning,
    monthlyCost: heat.monthlyCost,
    currency: heat.currency,
    heat,
  };
}

// label, getter, formatter, which direction is better
export const METRIC_ROWS = [
  ['Livability score', (m) => m.score, (v) => `${v}`, 'high'],
  ['Walkable floor', (m) => m.walkable, (v) => `${Math.round(v * 100)}%`, 'high'],
  ['Problems to fix', (m) => m.issues.filter((issue) => issue.severity !== 'low').length, (v) => `${v}`, 'low'],
  ['Light on the desk', (m) => m.deskLux, (v) => `${Math.round(v)} lux`, 'target', [300, 750]],
  ['WiFi at the desk', (m) => m.deskWifi, (v) => `${Math.round(v)} dBm`, 'high'],
  ['WiFi at the bed', (m) => m.bedWifi, (v) => `${Math.round(v)} dBm`, 'high'],
  ['Echo (RT60)', (m) => m.rt60, (v) => `${v.toFixed(2)} s`, 'target', [0.35, 0.7]],
  ['Fresh air', (m) => m.ach, (v) => `${v.toFixed(1)} /h`, 'high'],
  ['CO₂ (est.)', (m) => m.co2, (v) => `${v} ppm`, 'low'],
  ['Steady indoor temp', (m) => m.indoor, (v) => `${v.toFixed(1)} °C`, 'target', [20, 26]],
  ['Running cost', (m) => m.monthlyCost, (v, m) => `${m.currency}${Math.round(v)}/mo`, 'low'],
];

export function bestIndex(values, direction, range) {
  const scored = values.map((value, index) => ({ value, index })).filter((entry) => entry.value !== null && Number.isFinite(entry.value));
  if (scored.length < 2) return -1;
  const distance = (value) => (value < range[0] ? range[0] - value : value > range[1] ? value - range[1] : 0);
  scored.sort((a, b) => (direction === 'high' ? b.value - a.value : direction === 'low' ? a.value - b.value : distance(a.value) - distance(b.value)));
  return scored[0].value === scored[1].value ? -1 : scored[0].index;
}
