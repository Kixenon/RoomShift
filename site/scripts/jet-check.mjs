// Model check: centreline speed of the fan jet in an empty room, compared with a free round jet,
// whose centreline speed falls roughly as 1/x beyond the first few diameters.
// Usage: node site/scripts/jet-check.mjs > site/data/jet-check.json
import { simulateRoomFields } from '../../src/simulation/room-fields-3d.js';

const fan = { id: 'fan', primitive: 'box', model: 'fan', name: 'Fan', position: { x: 0.6, y: 0, z: 2.5 }, rotation: { x: 0, y: 90, z: 0 }, dimensions: { width: 0.42, height: 1.35, depth: 0.42 } };
const scene = { room: { width: 6, depth: 5, height: 2.7 }, objects: [fan] };
const result = simulateRoomFields(scene, { fanAcceleration: 4.5, steps: 40 });
const { grid, fields } = result;
const sourceY = fan.dimensions.height / 2 + fan.dimensions.height * 0.24;
const j = Math.floor(sourceY / grid.dy);
const k = Math.floor(fan.position.z / grid.dz);
const samples = [];
for (let i = 0; i < grid.nx; i += 1) {
  const x = (i + 0.5) * grid.dx;
  const distance = x - fan.position.x;
  if (distance < 0.2) continue;
  const n = (j * grid.nz + k) * grid.nx + i;
  samples.push({ distance: Number(distance.toFixed(3)), speed: Number(Math.hypot(fields.u[n], fields.v[n], fields.w[n]).toFixed(4)) });
}
console.log(JSON.stringify({ solver: 'RoomShift CPU preview', fanAcceleration: 4.5, samples }, null, 1));
