// A two-input sweep on RoomShift's CPU solver: fan distance from the desk and fan strength.
// Outcomes: air speed where you sit at the desk, and warmth where you sit on the sofa.
// Usage: node site/scripts/experiment.mjs > site/data/experiment.json
import { createRoomScene } from '../../src/model/room-scene.js';
import { simulateRoomFields } from '../../src/simulation/room-fields-3d.js';

const base = createRoomScene();
const place = (scene, id, patch) => {
  const object = scene.objects.find((item) => item.id === id);
  Object.assign(object.position, patch.position ?? {});
  Object.assign(object.rotation, patch.rotation ?? {});
};
// Layout B from the site: heater beside the sofa, fan aimed along the desk (+x).
place(base, 'heater-1', { position: { x: 2.9, z: 3.7 } });
place(base, 'lamp-1', { position: { x: 4.95, z: 1.6 } });
place(base, 'table-4', { position: { x: 4.18, z: 2.2 } });

// Occupied zones (metres): head-and-chest height above each seat.
const zones = {
  desk: { x: [3.55, 4.8], y: [0.85, 1.35], z: [0.3, 1.5] },
  sofa: { x: [3.45, 4.9], y: [0.85, 1.35], z: [2.65, 3.45] },
};
function zoneMean(result, zone, field) {
  const { grid, fields } = result;
  let total = 0;
  let count = 0;
  for (let j = 0; j < grid.ny; j += 1) for (let k = 0; k < grid.nz; k += 1) for (let i = 0; i < grid.nx; i += 1) {
    const x = (i + 0.5) * grid.dx; const y = (j + 0.5) * grid.dy; const z = (k + 0.5) * grid.dz;
    if (x < zone.x[0] || x > zone.x[1] || y < zone.y[0] || y > zone.y[1] || z < zone.z[0] || z > zone.z[1]) continue;
    const index = (j * grid.nz + k) * grid.nx + i;
    if (fields.solid[index]) continue;
    total += field(fields, index);
    count += 1;
  }
  return total / count;
}
const speed = (f, n) => Math.hypot(f.u[n], f.v[n], f.w[n]);
const temp = (f, n) => f.temperature[n];

const distances = [0.6, 1.0, 1.4, 1.8, 2.2]; // fan to desk edge, metres
const strengths = [0, 1.5, 3, 4.5, 6, 7.5]; // fan acceleration, the solver's fan-strength input
const deskEdge = 4.18 - 1.18 / 2;
const runs = [];
for (const distance of distances) {
  for (const strength of strengths) {
    const scene = structuredClone(base);
    place(scene, 'fan-1', { position: { x: deskEdge - distance, z: 0.86 }, rotation: { y: 90 } });
    const result = simulateRoomFields(scene, { fanAcceleration: strength });
    runs.push({
      distance,
      strength,
      deskAir: Number(zoneMean(result, zones.desk, speed).toFixed(3)),
      sofaWarmth: Number((zoneMean(result, zones.sofa, temp) - result.ambientTemperature).toFixed(3)),
      rmsDivergence: result.stats.rmsDivergence,
    });
  }
}
console.log(JSON.stringify({
  solver: 'RoomShift CPU preview, 0.15 m grid, 2 s simulated',
  zones,
  inputs: { distance: 'fan to desk edge (m)', strength: 'fan acceleration (m/s² source term)' },
  outputs: { deskAir: 'mean air speed at desk seat height (m/s)', sofaWarmth: 'mean rise above 20 °C at sofa seat height (°C)' },
  runs,
}, null, 1));
