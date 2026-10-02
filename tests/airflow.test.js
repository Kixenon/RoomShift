import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePlacement, isPlacementClear, recommendPlacement, scoreZone } from '../src/simulation.js';
import { boundFanPosition, comparePlacements } from '../src/planner.js';
import { createScenario } from '../src/scenario.js';

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

test('comparison identifies the seat that gains and the one that gives up airflow', () => {
  const comparison = comparePlacements({
    baselineFan: { x: 0.7, y: 1, angle: 0 },
    proposedFan: { x: 4.5, y: 3, angle: 180 },
    zones: [
      { id: 'desk', label: 'Desk', x: 1.4, y: 1, weight: 1 },
      { id: 'sofa', label: 'Sofa', x: 4.2, y: 3, weight: 1 },
    ],
    room,
  });

  assert.ok(comparison.changes.find((zone) => zone.id === 'desk').delta < 0);
  assert.ok(comparison.changes.find((zone) => zone.id === 'sofa').delta > 0);
  assert.equal(comparison.improved[0].id, 'sofa');
  assert.equal(comparison.reduced[0].id, 'desk');
  assert.ok(comparison.message.includes('Sofa'));
});

test('sub-point differences are described as effectively unchanged', () => {
  const comparison = comparePlacements({
    baselineFan: { x: 0.99, y: 1, angle: 45 },
    proposedFan: { x: 1, y: 1, angle: 45 },
    zones: [{ id: 'seat', label: 'Seat', x: 2, y: 2 }],
    room,
  });

  assert.equal(comparison.delta, 0.1);
  assert.deepEqual(comparison.improved, []);
  assert.deepEqual(comparison.reduced, []);
  assert.equal(comparison.message, 'This move leaves the occupied areas about the same.');
});

test('dragged fan positions stay within a small clearance of the room walls', () => {
  assert.deepEqual(
    boundFanPosition({ x: -4, y: 9, angle: 25 }, room),
    { x: 0.3, y: 3.7, angle: 25 },
  );
});

test('fan cannot be placed on furniture or directly in an occupied spot', () => {
  const obstacles = [{ x: 2, y: 1.5, width: 0.8, height: 0.6 }];
  const seats = [{ x: 4, y: 2 }];

  assert.equal(isPlacementClear({ x: 2.4, y: 1.8 }, seats, obstacles), false);
  assert.equal(isPlacementClear({ x: 3.7, y: 2 }, seats, obstacles), false);
  assert.equal(isPlacementClear({ x: 1, y: 2 }, seats, obstacles), true);
});

test('room dimensions scale the occupied spots and furniture with the room', () => {
  const scenario = createScenario({ width: 6, height: 4.6 });

  assert.equal(scenario.room.width, 6);
  assert.equal(scenario.room.height, 4.6);
  assert.ok(scenario.zones.every((zone) => zone.x > 0 && zone.x < scenario.room.width));
  assert.ok(scenario.zones.every((zone) => zone.y > 0 && zone.y < scenario.room.height));
  assert.ok(Math.abs(scenario.zones[0].x / scenario.room.width - 0.82) < 0.001);
  assert.equal(scenario.furniture.length, 3);
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
