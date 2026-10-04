import { rotationMatrixXYZ } from './room-transform.js';
import { isOpeningObject } from './openings.js';

// Local coordinates are relative to the object's centre, as in the viewport.
export function objectParts(model, { width: w, height: h, depth: d }) {
  const parts = [];
  const box = (width, height, depth, x, y, z, color) => parts.push({
    dimensions: { width, height, depth }, position: { x, y, z }, color,
  });
  if (model === 'desk' || model === 'table') {
    const top = model === 'desk' ? Math.min(0.08, h * 0.12) : Math.min(0.075, h * 0.22);
    box(w, top, d, 0, h / 2 - top / 2, 0, model === 'desk' ? 0xc2a97a : 0xb69b73);
    const leg = Math.min(0.055, w * 0.07, d * 0.1);
    for (const x of [-1, 1]) for (const z of [-1, 1]) {
      box(leg, h - top, leg, x * (w / 2 - leg), -top / 2, z * (d / 2 - leg), 0x8f8069);
    }
    if (model === 'desk') box(w * 0.28, h * 0.06, d * 0.22, -w * 0.08, h * 0.17, -d * 0.12, 0x8a9c91);
  } else if (model === 'lamp') {
    box(w * 0.8, 0.06, d * 0.8, 0, -h / 2 + 0.03, 0, 0x75877d);
    box(0.04, h * 0.79, 0.04, 0, -h * 0.12, 0, 0x75877d);
    // An open shade: leave the bulb and downward emission unobstructed.
    const edge = Math.min(w, d) * 0.04;
    for (const side of [-1, 1]) {
      box(w * 0.48, h * 0.17, edge, 0, h * 0.31, side * d * 0.22, 0xe3dfd0);
      box(edge, h * 0.17, d * 0.48, side * w * 0.22, h * 0.31, 0, 0xe3dfd0);
    }
  } else if (model === 'bed') {
    const frame = h * 0.16;
    const mattress = h * 0.42;
    box(w * 0.94, frame, d * 0.94, 0, -h / 2 + frame / 2, 0, 0x786b5c);
    box(w * 0.9, mattress, d * 0.9, 0, -h / 2 + frame + mattress / 2, 0, 0xe1dfd5);
    box(w * 0.94, h, d * 0.09, 0, 0, -d * 0.43, 0x8b7e70);
  } else if (model === 'sofa') {
    box(w * 0.92, h * 0.53, d * 0.87, 0, -h * 0.13, 0, 0x718f79);
    box(w * 0.82, h * 0.18, d * 0.77, 0, -h * 0.04, d * 0.02, 0x9aaf91);
    box(w * 0.88, h * 0.34, d * 0.2, 0, h * 0.16, -d * 0.34, 0x799681);
    for (const side of [-1, 1]) box(w * 0.09, h * 0.52, d * 0.85, side * w * 0.43, -h * 0.1, 0, 0x688570);
  } else {
    box(w, h, d, 0, 0, 0, 0x75877d);
  }
  return parts;
}

export function roomObstacles(scene, { includeFans = false } = {}) {
  return scene.objects.flatMap((object) => {
    if (isOpeningObject(object) || (!includeFans && object.model === 'fan')) return [];
    const matrix = rotationMatrixXYZ(object.rotation);
    return objectParts(object.model, object.dimensions).map((part) => {
      const offset = [part.position.x, part.position.y, part.position.z];
      const world = matrix.map((row) => row.reduce((sum, value, axis) => sum + value * offset[axis], 0));
      return {
        id: object.id,
        dimensions: part.dimensions,
        rotation: object.rotation,
        position: {
          x: object.position.x + world[0],
          y: object.position.y + object.dimensions.height / 2 + world[1] - part.dimensions.height / 2,
          z: object.position.z + world[2],
        },
      };
    });
  });
}
