import { createRoomScene } from '../src/model/room-scene.js';
import { simulateRoomFields } from '../src/simulation/room-fields-3d.js';
import { sampleRoomFields } from '../src/simulation/room-field-analysis.js';

const template = createRoomScene();
const room = { width: 2, depth: 2, height: 2, outdoorTemperature: 20, envelopeUValue: 0 };
const fan = { ...template.objects[0], position: { x: 1, y: 0, z: 1.7 }, rotation: { x: 0, y: 180, z: 0 } };
const point = { x: 1, y: 1, z: 0.8 };
const rows = [];
for (const cellSize of [0.25, 0.15, 0.075]) for (const seconds of [1, 3]) {
  const started = performance.now();
  const result = simulateRoomFields({ ...template, room, objects: [fan] }, { cellSize, steps: Math.round(seconds / (cellSize < 0.15 ? 0.02 : 0.05)) });
  const probe = sampleRoomFields(result, point);
  rows.push({ cellSize, time: result.durationSeconds, solveMs: Math.round(performance.now() - started), peakSpeed: result.stats.maxSpeed, probeSpeed: Number(probe.speed.toFixed(4)), divergence: result.stats.rmsDivergence });
}
console.table(rows);
for (const timeStep of [0.05, 0.025, 0.0125]) {
  const result = simulateRoomFields({ ...template, room, objects: [fan] }, { timeStep, steps: Math.round(3 / timeStep) });
  console.log(JSON.stringify({ timeStep, time: result.durationSeconds, probeSpeed: sampleRoomFields(result, point).speed }));
}
console.log('Resolution and time sensitivity, not real-world validation. Changes must be checked against room measurements before claiming predictive accuracy.');
