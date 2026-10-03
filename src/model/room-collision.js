import { rotationMatrixXYZ } from './room-transform.js';

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

function frame(object) {
  const matrix = rotationMatrixXYZ(object.rotation);
  return {
    center: [object.position.x, object.position.y + object.dimensions.height / 2, object.position.z],
    half: [object.dimensions.width / 2, object.dimensions.height / 2, object.dimensions.depth / 2],
    axes: [0, 1, 2].map((column) => [matrix[0][column], matrix[1][column], matrix[2][column]]),
  };
}

function overlapsBoxes(a, b) {
  const left = frame(a);
  const right = frame(b);
  const displacement = right.center.map((value, axis) => value - left.center[axis]);
  const axes = [...left.axes, ...right.axes];
  for (const axisA of left.axes) {
    for (const axisB of right.axes) axes.push(cross(axisA, axisB));
  }

  for (const axis of axes) {
    const length = Math.hypot(...axis);
    if (length < 1e-8) continue;
    const normal = axis.map((component) => component / length);
    const radiusA = left.half.reduce((sum, extent, index) => sum + extent * Math.abs(dot(normal, left.axes[index])), 0);
    const radiusB = right.half.reduce((sum, extent, index) => sum + extent * Math.abs(dot(normal, right.axes[index])), 0);
    if (Math.abs(dot(displacement, normal)) >= radiusA + radiusB - 1e-7) return false;
  }
  return true;
}

function overlapsWindows(a, b) {
  if (a.wall !== b.wall) return false;
  const along = a.wall === 'left' || a.wall === 'right' ? 'z' : 'x';
  const alongOverlap = Math.abs(a.position[along] - b.position[along])
    < (a.dimensions.width + b.dimensions.width) / 2 - 1e-7;
  const verticalOverlap = Math.abs(a.position.y - b.position.y)
    < (a.dimensions.height + b.dimensions.height) / 2 - 1e-7;
  return alongOverlap && verticalOverlap;
}

export function findObjectCollision(objects, candidate, ignoreId = candidate.id) {
  for (const other of objects) {
    if (other.id === ignoreId) continue;
    if (candidate.model === 'window' || other.model === 'window') {
      if (candidate.model === 'window' && other.model === 'window' && overlapsWindows(candidate, other)) return other;
      continue;
    }
    if (overlapsBoxes(candidate, other)) return other;
  }
  return null;
}

export function assertPlacementClear(objects, candidate, ignoreId = candidate.id) {
  const collision = findObjectCollision(objects, candidate, ignoreId);
  if (collision) {
    const label = collision.name || collision.id;
    throw new RangeError(`Placement overlaps ${label}.`);
  }
  return candidate;
}
