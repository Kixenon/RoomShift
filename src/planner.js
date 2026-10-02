import { evaluatePlacement } from './simulation.js';

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const round = (value, digits = 2) => Number(value.toFixed(digits));
const SIGNIFICANT_CHANGE = 0.5;

export function boundFanPosition(fan, room, clearance = 0.3) {
  return {
    ...fan,
    x: round(clamp(fan.x, clearance, room.width - clearance)),
    y: round(clamp(fan.y, clearance, room.height - clearance)),
  };
}

export function comparePlacements({ baselineFan, proposedFan, zones, room, obstacles = [] }) {
  const before = evaluatePlacement({ fan: baselineFan, zones, room, obstacles });
  const after = evaluatePlacement({ fan: proposedFan, zones, room, obstacles });
  const changes = after.zones.map((zone) => {
    const original = before.zones.find((entry) => entry.id === zone.id);
    return {
      ...zone,
      before: original?.score ?? 0,
      delta: zone.score - (original?.score ?? 0),
    };
  });
  const improved = changes.filter((zone) => zone.delta >= SIGNIFICANT_CHANGE).sort((a, b) => b.delta - a.delta);
  const reduced = changes.filter((zone) => zone.delta <= -SIGNIFICANT_CHANGE).sort((a, b) => a.delta - b.delta);
  const delta = round(after.average - before.average, 1);

  let message;
  if (improved.length && reduced.length) {
    message = `${improved[0].label} gains ${Math.round(improved[0].delta)} points; ${reduced[0].label} gives up ${Math.abs(Math.round(reduced[0].delta))}.`;
  } else if (improved.length) {
    message = `${improved[0].label} gains ${Math.round(improved[0].delta)} estimated points.`;
  } else if (reduced.length) {
    message = `${reduced[0].label} loses ${Math.abs(Math.round(reduced[0].delta))} estimated points.`;
  } else {
    message = 'This move leaves the occupied areas about the same.';
  }

  return { before, after, delta, changes, improved, reduced, message };
}
