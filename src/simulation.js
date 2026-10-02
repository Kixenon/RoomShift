const MODEL = Object.freeze({
  distanceScale: 3.8,
  ambientFlow: 0.36,
  directionalFlow: 0.64,
  directionPower: 1.8,
  blockedFlow: 0.58,
  underservedBelow: 55,
});

const SEARCH = Object.freeze({
  edge: 0.55,
  spacing: 0.4,
  angleSteps: 24,
  minimumClearance: 0.72,
  averageWeight: 0.78,
  minimumWeight: 0.22,
  movementCost: 0.16,
});

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const radians = (degrees) => (degrees * Math.PI) / 180;
const round = (value, digits = 1) => Number(value.toFixed(digits));

function lineIntersectsRectangle(start, end, rectangle) {
  const minX = rectangle.x;
  const maxX = rectangle.x + rectangle.width;
  const minY = rectangle.y;
  const maxY = rectangle.y + rectangle.height;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  let near = 0;
  let far = 1;

  for (const [p, q] of [
    [-dx, start.x - minX],
    [dx, maxX - start.x],
    [-dy, start.y - minY],
    [dy, maxY - start.y],
  ]) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }

    const ratio = q / p;
    if (p < 0) near = Math.max(near, ratio);
    else far = Math.min(far, ratio);
    if (near > far) return false;
  }

  return far >= 0 && near <= 1;
}

export function scoreZone({ fan, zone, room, obstacles = [] }) {
  const dx = zone.x - fan.x;
  const dy = zone.y - fan.y;
  const distance = Math.hypot(dx, dy);
  const bearing = Math.atan2(dy, dx);
  const relativeAngle = bearing - radians(fan.angle);
  const alignment = Math.max(0, Math.cos(relativeAngle));
  const directionFactor = MODEL.ambientFlow + MODEL.directionalFlow * alignment ** MODEL.directionPower;
  const distanceFactor = Math.exp(-distance / MODEL.distanceScale);
  const isBlocked = obstacles.some((obstacle) => lineIntersectsRectangle(fan, zone, obstacle));
  const obstructionFactor = isBlocked ? MODEL.blockedFlow : 1;
  const roomFactor = Math.min(1, Math.hypot(room.width, room.height) / 6.5);

  return round(clamp(100 * distanceFactor * directionFactor * obstructionFactor * roomFactor, 0, 100));
}

export function evaluatePlacement({ fan, zones, room, obstacles = [] }) {
  const scoredZones = zones.map((zone) => ({
    ...zone,
    score: scoreZone({ fan, zone, room, obstacles }),
  }));
  const totalWeight = scoredZones.reduce((total, zone) => total + (zone.weight ?? 1), 0);
  const average = totalWeight === 0
    ? 0
    : scoredZones.reduce((total, zone) => total + zone.score * (zone.weight ?? 1), 0) / totalWeight;
  const minimum = scoredZones.length ? Math.min(...scoredZones.map((zone) => zone.score)) : 0;

  return {
    zones: scoredZones,
    average: round(average),
    minimum,
    underserved: scoredZones.filter((zone) => zone.score < MODEL.underservedBelow),
  };
}

export function isPlacementClear(point, zones = [], obstacles = [], minimumClearance = SEARCH.minimumClearance) {
  if (zones.some((zone) => Math.hypot(zone.x - point.x, zone.y - point.y) < minimumClearance)) {
    return false;
  }

  return !obstacles.some((obstacle) => (
    point.x >= obstacle.x - 0.25
    && point.x <= obstacle.x + obstacle.width + 0.25
    && point.y >= obstacle.y - 0.25
    && point.y <= obstacle.y + obstacle.height + 0.25
  ));
}

export function recommendPlacement({ room, zones, obstacles = [], initialFan }) {
  const maxX = room.width - SEARCH.edge;
  const maxY = room.height - SEARCH.edge;
  let best = null;

  for (let x = SEARCH.edge; x <= maxX + 1e-8; x += SEARCH.spacing) {
    for (let y = SEARCH.edge; y <= maxY + 1e-8; y += SEARCH.spacing) {
      const position = { x: round(x, 2), y: round(y, 2) };
      if (!isPlacementClear(position, zones, obstacles)) continue;

      for (let step = 0; step < SEARCH.angleSteps; step += 1) {
        const fan = { ...position, angle: -180 + step * (360 / SEARCH.angleSteps) };
        const result = evaluatePlacement({ fan, zones, room, obstacles });
        const quality = result.average * SEARCH.averageWeight
          + result.minimum * SEARCH.minimumWeight
          - Math.hypot(fan.x - initialFan.x, fan.y - initialFan.y) * SEARCH.movementCost;

        if (!best || quality > best.quality) best = { fan, result, quality };
      }
    }
  }

  if (!best) {
    return { fan: { ...initialFan }, result: evaluatePlacement({ fan: initialFan, zones, room, obstacles }) };
  }

  return { fan: best.fan, result: best.result };
}
