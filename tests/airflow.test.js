import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePlacement, recommendPlacement, scoreZone } from '../src/simulation.js';

const room = { width: 5.2, height: 4 };
const zones = [
  { id: 'desk', label: 'Desk', x: 4.25, y: 1.05, weight: 1.2 },
  { id: 'sofa', label: 'Sofa', x: 4.2, y: 3.05, weight: 1 },
];

 test('airflow is stronger when the fan faces a zone', () => {
  const zone = { x: 4, y: 2 };
  const toward = scoreZone({ fan: { x: 1, y: 2, angle: 0 }, zone, room });
  const away = scoreZone({ fan: { x: 1, y: 2, angle: 180 }, zone, room });

  assert.ok(toward > away);
  assert.ok(toward <= 100 && toward >= 0);
});

test('airflow weakens with distance when direction is unchanged', () => {
  const fan = { x: 1, y: 2, angle: 0 };
  const near = scoreZone({ fan, zone: { x: 2, y: 2 }, room });
  const far = scoreZone({ fan, zone: { x: 4, y: 2 }, room });

  assert.ok(near > far);
});

test('furniture between a fan and a zone reduces estimated airflow', () => {
  const fan = { x: 1, y: 2, angle: 0 };
  const zone = { x: 4, y: 2 };
  const clear = scoreZone({ fan, zone, room });
  const blocked = scoreZone({ fan, zone, room, obstacles: [{ x: 2, y: 1.5, width: 0.6, height: 1 }] });

  assert.ok(blocked < clear);
});

test('placement summary makes area-weighted and minimum comfort legible', () => {
  const result = evaluatePlacement({
    fan: { x: 1, y: 3, angle: -30 },
    zones,
    room,
  });

  assert.equal(result.zones.length, 2);
  assert.ok(result.average > 0);
  assert.equal(result.minimum, Math.min(...result.zones.map((zone) => zone.score)));
  assert.equal(result.underserved.length, result.zones.filter((zone) => zone.score < 55).length);
});

test('recommended placement improves the shared-room score and stays inside the room', () => {
  const current = { x: 0.8, y: 3.15, angle: -35 };
  const recommendation = recommendPlacement({ room, zones, initialFan: current });
  const before = evaluatePlacement({ fan: current, zones, room });
  const after = evaluatePlacement({ fan: recommendation.fan, zones, room });

  assert.ok(after.average > before.average);
  assert.ok(recommendation.fan.x >= 0.5 && recommendation.fan.x <= room.width - 0.5);
  assert.ok(recommendation.fan.y >= 0.5 && recommendation.fan.y <= room.height - 0.5);
  assert.ok(recommendation.fan.angle >= -180 && recommendation.fan.angle < 180);
});
