import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ASSUMED_HORIZONTAL_FOV_DEGREES,
  CAMERA_HEIGHT_LIMITS,
  DEFAULT_CAMERA_HEIGHT_METERS,
  PhotoMetricError,
  buildFloorFrame,
  estimateFocalPixels,
  estimateHorizonFromRowEnergy,
  estimateRoomFromPhoto,
  focalPixelsFromFov,
  floorToImage,
  imageToFloor,
  intersectLines,
} from '../src/model/room-photo-metrics.js';

// A synthetic room is projected into the image, then the estimate is asked to
// recover it. If the algebra is wrong the round trip fails, which is the whole
// point: real photographs are impossible to assert against.

const DEFAULT_IMAGE = { width: 1200, height: 800 };
const DEFAULT_FOCAL = 900;
const CAMERA_HEIGHT = 1.6;

function projector(image, focal) {
  const principal = { x: image.width / 2, y: image.height / 2 };
  // point3d.y is camera-space with y increasing downward, so the floor sits at
  // +cameraHeight and the ceiling at cameraHeight - roomHeight.
  return {
    principal,
    focal,
    project: (point3d) => ({
      x: principal.x + (focal * point3d.x) / point3d.z,
      y: principal.y + (focal * point3d.y) / point3d.z,
    }),
  };
}

// Room footprint expressed in camera floor coordinates: x right, z forward.
function buildScene({
  width,
  depth,
  height,
  yawDeg = 0,
  inset = 4.5,
  image = DEFAULT_IMAGE,
  focal = DEFAULT_FOCAL,
  cameraHeight = CAMERA_HEIGHT,
}) {
  const { principal, project } = projector(image, focal);
  const yaw = (yawDeg * Math.PI) / 180;
  const across = { x: Math.cos(yaw), z: Math.sin(yaw) };
  const along = { x: -Math.sin(yaw), z: Math.cos(yaw) };
  // Keep the camera strictly inside, so all four corners are in front of it.
  const centre = { x: 0, z: inset + depth / 2 };
  const at = (u, v) => ({
    x: centre.x + across.x * u + along.x * v,
    z: centre.z + across.z * u + along.z * v,
  });
  const half = { u: width / 2, v: depth / 2 };
  const floorCorners = [at(-half.u, -half.v), at(half.u, -half.v), at(half.u, half.v), at(-half.u, half.v)]
    .map((corner) => project({ x: corner.x, y: cameraHeight, z: corner.z }));
  // Ceiling-wall junction on the far wall, at the room's centre line.
  const far = at(0, half.v);
  const ceilingPoint = project({ x: far.x, y: cameraHeight - height, z: far.z });
  return { floorCorners, ceilingPoint, principal, image, focal, cameraHeight };
}

function estimate(scene, overrides = {}) {
  return estimateRoomFromPhoto({
    corners: scene.floorCorners,
    ceilingPoint: scene.ceilingPoint,
    imageSize: scene.image,
    horizonRow: scene.principal.y,
    cameraHeightMeters: scene.cameraHeight,
    preferredWall: 'a-far',
    ...overrides,
  });
}

test('a projected room is recovered from its floor corners and one ceiling click', () => {
  const room = { width: 4, depth: 5, height: 2.7 };
  const scene = buildScene({ ...room, yawDeg: 14 });
  const result = estimate(scene);

  assert.equal(result.focalSource, 'vanishing-points');
  assert.ok(Math.abs(result.focalPixels - DEFAULT_FOCAL) < 1, `focal was ${result.focalPixels}`);
  // The longer footprint side lands on width by design.
  assert.ok(Math.abs(result.dimensions.width - room.depth) < 0.05, `width was ${result.dimensions.width}`);
  assert.ok(Math.abs(result.dimensions.depth - room.width) < 0.05, `depth was ${result.dimensions.depth}`);
  assert.ok(Math.abs(result.dimensions.height - room.height) < 0.05, `height was ${result.dimensions.height}`);
  assert.equal(result.ceilingWall, 'a-far');
  assert.equal(result.usedCeilingPrior, false);
  assert.deepEqual(result.warnings, []);
});

test('room recovery survives a yawed camera and asymmetric dimensions', () => {
  const room = { width: 3.2, depth: 6.5, height: 3.1 };
  const scene = buildScene({ ...room, yawDeg: 23 });
  const result = estimate(scene);

  // The longer footprint side lands on width by design.
  assert.ok(Math.abs(result.dimensions.width - room.depth) < 0.1, `width was ${result.dimensions.width}`);
  assert.ok(Math.abs(result.dimensions.depth - room.width) < 0.1, `depth was ${result.dimensions.depth}`);
  assert.ok(Math.abs(result.dimensions.height - room.height) < 0.05, `height was ${result.dimensions.height}`);
});

test('several room shapes all round-trip within tolerance', () => {
  const rooms = [
    { width: 4, depth: 5, height: 2.7 },
    { width: 2.4, depth: 2.2, height: 2.2 },
    { width: 6.5, depth: 3.1, height: 3.4 },
    { width: 5.1, depth: 4.4, height: 2.5 },
  ];
  for (const room of rooms) {
    for (const yawDeg of [11, -19, 27]) {
      const scene = buildScene({ ...room, yawDeg });
      const result = estimate(scene);
      const expected = [room.width, room.depth].sort((a, b) => b - a);
      assert.ok(Math.abs(result.dimensions.width - expected[0]) < 0.1,
        `${JSON.stringify({ ...room, yawDeg })} width was ${result.dimensions.width}`);
      assert.ok(Math.abs(result.dimensions.depth - expected[1]) < 0.1,
        `${JSON.stringify({ ...room, yawDeg })} depth was ${result.dimensions.depth}`);
      assert.ok(Math.abs(result.dimensions.height - room.height) < 0.06,
        `${JSON.stringify({ ...room, yawDeg })} height was ${result.dimensions.height}`);
    }
  }
});

test('the footprint scales linearly with the camera-height reference', () => {
  const scene = buildScene({ width: 4, depth: 5, height: 2.7, yawDeg: 14, cameraHeight: 1.2 });
  const atReference = estimate(scene).dimensions;
  const doubled = estimate(scene, { cameraHeightMeters: scene.cameraHeight * 2 }).dimensions;

  for (const axis of ['width', 'depth']) {
    assert.ok(Math.abs(doubled[axis] - atReference[axis] * 2) < 0.06,
      `${axis} did not scale: ${atReference[axis]} then ${doubled[axis]}`);
  }
});

test('recovery is correct at several camera-height references', () => {
  const room = { width: 4, depth: 5, height: 2.7 };
  for (const cameraHeight of [1.1, 1.4, 1.6, 2.1]) {
    const scene = buildScene({ ...room, yawDeg: 14, cameraHeight });
    const result = estimate(scene);
    assert.ok(Math.abs(result.dimensions.height - room.height) < 0.06,
      `height at ${cameraHeight}m was ${result.dimensions.height}`);
    assert.ok(Math.abs(result.dimensions.width - room.depth) < 0.06,
      `width at ${cameraHeight}m was ${result.dimensions.width}`);
  }
});

test('a single ceiling click is ambiguous, and the wall can be pinned', () => {
  // Every wall reading is geometrically valid, so the ceiling prior can pick
  // the wrong one. The result must admit that, and honour an explicit choice.
  const room = { width: 3.2, depth: 6.5, height: 3.1 };
  const scene = buildScene({ ...room, yawDeg: 23 });

  const withPrior = estimate(scene, { preferredWall: null });
  assert.equal(withPrior.usedCeilingPrior, true);
  assert.ok(withPrior.candidates.length >= 2);
  assert.ok(withPrior.warnings.some((warning) => /assuming a typical ceiling/.test(warning)));
  // Here the prior genuinely picks the wrong wall, which is the whole reason
  // the caller is allowed to state the wall instead of trusting it.
  assert.notEqual(withPrior.ceilingWall, 'a-far');
  assert.ok(Math.abs(withPrior.dimensions.height - room.height) > 0.06,
    `prior height was ${withPrior.dimensions.height}`);

  const pinned = estimate(scene);
  assert.equal(pinned.ceilingWall, 'a-far');
  assert.equal(pinned.usedCeilingPrior, false);
  assert.ok(Math.abs(pinned.dimensions.height - room.height) < 0.06);

  // Each candidate is offered so the UI can offer the alternatives.
  assert.ok(pinned.candidates.some((candidate) => candidate.selected === true));
  for (const candidate of pinned.candidates) {
    assert.match(candidate.wall, /^[ab]-(near|far)$/);
    assert.ok(Number.isFinite(candidate.height) && Number.isFinite(candidate.depth));
  }
});

test('an unknown preferred wall falls back and says so', () => {
  const scene = buildScene({ width: 4, depth: 5, height: 2.7, yawDeg: 14 });
  const result = estimate(scene, { preferredWall: 'b-near' });
  assert.ok(result.dimensions.height > 0);
  assert.ok(Number.isFinite(result.dimensions.height));
});

test('parallel floor edges fall back to the assumed field of view', () => {
  // A dead-on view makes both edge pairs parallel, so the vanishing points sit
  // at infinity and cannot pin down the focal length.
  const room = { width: 4, depth: 4, height: 2.5 };
  const scene = buildScene({ ...room, inset: 5 });
  const trueFov = (2 * Math.atan(scene.image.width / 2 / DEFAULT_FOCAL) * 180) / Math.PI;
  const result = estimate(scene, { assumedFovDegrees: trueFov });
  assert.equal(result.focalSource, 'assumed-fov');
  assert.ok(result.warnings.some((warning) => /assumed field of view/.test(warning)));
  assert.ok(Math.abs(result.focalPixels - DEFAULT_FOCAL) < 1, `focal was ${result.focalPixels}`);
  assert.ok(Math.abs(result.dimensions.width - room.width) < 0.1, `width was ${result.dimensions.width}`);
  assert.ok(Math.abs(result.dimensions.height - room.height) < 0.1, `height was ${result.dimensions.height}`);
});

test('a wrong assumed field of view scales the whole result', () => {
  // Same pixels, only the assumed FOV differs: recovery is exact when the
  // assumption happens to match the true lens and proportionally wrong
  // otherwise. That is exactly the caveat the warning exists to communicate.
  const room = { width: 4, depth: 4, height: 2.5 };
  const scene = buildScene({ ...room, inset: 5 });
  const trueFov = (2 * Math.atan(scene.image.width / 2 / DEFAULT_FOCAL) * 180) / Math.PI;

  const good = estimate(scene, { assumedFovDegrees: trueFov });
  const bad = estimate(scene);
  assert.equal(good.focalSource, 'assumed-fov');
  assert.equal(bad.focalSource, 'assumed-fov');

  assert.ok(Math.abs(good.focalPixels - DEFAULT_FOCAL) < 1, `good focal was ${good.focalPixels}`);
  assert.ok(Math.abs(good.dimensions.width - room.width) < 0.1, `good width was ${good.dimensions.width}`);
  assert.ok(Math.abs(good.dimensions.height - room.height) < 0.1, `good height was ${good.dimensions.height}`);

  // For a dead-on view the lateral side is fixed by the pixel geometry alone,
  // while the depth side scales with the focal length. That asymmetry is why a
  // wrong assumption distorts the room rather than shifting it uniformly.
  const focalRatio = bad.focalPixels / good.focalPixels;
  assert.ok(Math.abs(bad.dimensions.depth - good.dimensions.depth) < 0.05,
    `lateral side should not move: ${good.dimensions.depth} then ${bad.dimensions.depth}`);
  assert.ok(Math.abs(bad.dimensions.width / good.dimensions.width - focalRatio) < 0.02,
    `expected depth side to scale by ${focalRatio}, got ${bad.dimensions.width / good.dimensions.width}`);
  // The height happens to survive here: the wall depth scales with the focal
  // length in the same step, and the two cancel in H = h - (y - y_h) * Z / f.
  assert.ok(Math.abs(good.dimensions.height - bad.dimensions.height) < 0.05);
});

test('the floor projection round-trips', () => {
  const principal = { x: DEFAULT_IMAGE.width / 2, y: DEFAULT_IMAGE.height / 2 };
  const options = { principal, focalPixels: DEFAULT_FOCAL, cameraHeightMeters: CAMERA_HEIGHT };
  const point = { x: 1.4, z: 3.2 };
  const recovered = imageToFloor(floorToImage(point, options), options);
  assert.ok(Math.abs(recovered.x - point.x) < 1e-9);
  assert.ok(Math.abs(recovered.z - point.z) < 1e-9);
});

test('vanishing points recover the focal length through the orthogonality constraint', () => {
  const principal = { x: DEFAULT_IMAGE.width / 2, y: DEFAULT_IMAGE.height / 2 };
  // f^2 = -(v1 - p) . (v2 - p); with these points the product is -1e6, so f = 1000.
  const focal = estimateFocalPixels({ x: 1600, y: 400 }, { x: -400, y: 400 }, principal);
  assert.ok(Math.abs(focal - 1000) < 1e-9, `expected 1000, got ${focal}`);
  assert.equal(estimateFocalPixels(null, { x: 1, y: 1 }, principal), null);
  // Vanishing points almost on top of each other imply an absurd focal length.
  assert.equal(estimateFocalPixels({ x: 603, y: 400 }, { x: 597, y: 400 }, principal), null);
});

test('parallel lines do not intersect', () => {
  assert.equal(intersectLines([0, 0, 10, 0], [0, 5, 10, 5]), null);
  assert.deepEqual(intersectLines([0, 0, 10, 0], [5, -5, 5, 5]), { x: 5, y: 0 });
});

test('the horizon is bisected from the strongest symmetric row pair', () => {
  const rows = 100;
  const profile = new Array(rows).fill(0.01);
  profile[30] = 1;
  profile[70] = 1;
  const horizon = estimateHorizonFromRowEnergy(profile);
  assert.equal(horizon.row, 50);
  assert.ok(horizon.confidence > 0.6, `confidence was ${horizon.confidence}`);
  // The pair is far stronger than an average row, which is the readable figure.
  assert.ok(horizon.strength > 10, `strength was ${horizon.strength}`);
});

test('a flat or featureless photo falls back to the centre row', () => {
  const flat = estimateHorizonFromRowEnergy(new Array(100).fill(0));
  assert.equal(flat.row, 49.5);
  assert.equal(flat.fallback, 'flat');
  assert.equal(flat.strength, 0);

  const featureless = estimateHorizonFromRowEnergy(new Array(100).fill(0.01));
  assert.equal(featureless.row, 49.5);
  assert.equal(featureless.fallback, 'no-strong-edges');
});

test('a biased horizon biases every recovered dimension', () => {
  // The horizon row is as much a scale reference as the camera height is, so
  // the UI must let the user correct it rather than trust the estimate.
  const scene = buildScene({ width: 4, depth: 5, height: 2.7, yawDeg: 14 });
  const correct = estimate(scene).dimensions;
  const skewed = estimate(scene, { horizonRow: scene.principal.y + 60 }).dimensions;

  assert.notDeepEqual(skewed, correct);
  assert.ok(Math.abs(skewed.height - correct.height) > 0.2);
});

test('dimensions are clamped to the room limits and the clamp is reported', () => {
  // A big room plus a tall reference pushes every axis past its limit.
  const scene = buildScene({ width: 17, depth: 19, height: 4.2, yawDeg: 14, inset: 6 });
  const result = estimate(scene, { cameraHeightMeters: 2.6 });

  assert.equal(result.dimensions.width, 20);
  assert.equal(result.dimensions.depth, 20);
  assert.equal(result.dimensions.height, 6);
  assert.ok(result.warnings.some((warning) => /clamped/.test(warning)));
  assert.ok(result.raw.width > 20, 'raw estimate should still show the unclamped value');
});

test('a small camera-height reference clamps to the minimum instead', () => {
  const scene = buildScene({ width: 4, depth: 5, height: 2.7, yawDeg: 14 });
  const result = estimate(scene, { cameraHeightMeters: 0.5 });

  assert.equal(result.dimensions.width, 2);
  assert.equal(result.dimensions.depth, 2);
  assert.ok(result.warnings.some((warning) => /clamped/.test(warning)));
});

test('implausible input is rejected with an explanatory error', () => {
  const scene = buildScene({ width: 4, depth: 5, height: 2.7, yawDeg: 14 });
  const base = {
    corners: scene.floorCorners,
    ceilingPoint: scene.ceilingPoint,
    imageSize: scene.image,
    horizonRow: scene.principal.y,
  };

  assert.throws(() => estimateRoomFromPhoto({ ...base, corners: scene.floorCorners.slice(0, 3) }), PhotoMetricError);
  assert.throws(() => estimateRoomFromPhoto({ ...base, imageSize: { width: 0, height: 10 } }), PhotoMetricError);
  assert.throws(() => estimateRoomFromPhoto({ ...base, horizonRow: Number.NaN }), PhotoMetricError);
  assert.throws(() => estimateRoomFromPhoto({ ...base, cameraHeightMeters: 99 }), PhotoMetricError);
  assert.throws(() => estimateRoomFromPhoto({ ...base, cameraHeightMeters: 0.01 }), PhotoMetricError);
  assert.throws(
    () => estimateRoomFromPhoto({ ...base, ceilingPoint: { x: Number.NaN, y: 10 } }),
    PhotoMetricError,
  );
  assert.throws(() => estimateHorizonFromRowEnergy([1, 2, 3]), PhotoMetricError);
});

test('a floor corner on the horizon is rejected rather than producing infinity', () => {
  const principal = { x: DEFAULT_IMAGE.width / 2, y: DEFAULT_IMAGE.height / 2 };
  const options = { principal, focalPixels: DEFAULT_FOCAL, cameraHeightMeters: CAMERA_HEIGHT };
  assert.throws(() => imageToFloor({ x: 10, y: principal.y }, options), /horizon/);
  assert.throws(() => floorToImage({ x: 1, z: 0 }, options), /zero depth/);
});

test('non-perpendicular corners are flagged instead of silently accepted', () => {
  const scene = buildScene({ width: 4, depth: 5, height: 2.7, yawDeg: 14 });
  const skewed = scene.floorCorners.map((corner, index) => (
    index === 2 ? { x: corner.x + 120, y: corner.y - 60 } : corner
  ));
  const result = estimate(scene, { corners: skewed });

  assert.ok(Number.isFinite(result.dimensions.width));
  assert.ok(Number.isFinite(result.dimensions.height));
  assert.ok(result.orthogonality >= 0, `orthogonality was ${result.orthogonality}`);
});

test('the frame exposes the evidence the inspector needs', () => {
  const scene = buildScene({ width: 4, depth: 5, height: 2.7, yawDeg: 14 });
  const frame = buildFloorFrame(scene.floorCorners, {
    principal: scene.principal,
    cameraHeightMeters: scene.cameraHeight,
    imageWidth: scene.image.width,
  });

  assert.equal(frame.floor.length, 4);
  assert.ok(Math.abs(frame.sideA - 4) < 0.05, `sideA was ${frame.sideA}`);
  assert.ok(Math.abs(frame.sideB - 5) < 0.05, `sideB was ${frame.sideB}`);
  assert.ok(frame.vanishingA && frame.vanishingB);
  assert.ok(frame.focalPixels > 0);
  // The photo is taken from outside the room looking in, so the camera sits
  // beyond corner 0 on the near-wall side and within the room's width.
  assert.ok(frame.camera.v < 0, `camera.v should be negative, got ${frame.camera.v}`);
  assert.ok(frame.camera.u > 0 && frame.camera.u < frame.sideA,
    `camera.u should sit inside the width, got ${frame.camera.u}`);
});

test('defaults and limits are exported for the UI to bind to', () => {
  assert.equal(DEFAULT_CAMERA_HEIGHT_METERS, 1.6);
  assert.deepEqual(CAMERA_HEIGHT_LIMITS, { min: 0.4, max: 2.6 });
  assert.equal(typeof ASSUMED_HORIZONTAL_FOV_DEGREES, 'number');
  assert.ok(focalPixelsFromFov(DEFAULT_IMAGE.width) > 0);
});
