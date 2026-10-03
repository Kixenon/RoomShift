import { ROOM_LIMITS } from './room-scene.js';

// Single-view room metrology from a photograph.
//
// Assumptions, all of them load-bearing and all of them surfaced to the user:
//   - the camera is level (no pitch or roll), so the horizon of the horizontal
//     plane passes through the principal point;
//   - the principal point sits on the image centre column, and its row is the
//     estimated horizon;
//   - the room is a rectangular box, and the four clicked floor corners are
//     given in order around it;
//   - the camera height is known, because it is the scale reference. Without
//     it the geometry only yields proportions, never metres.
//
// Absolute scale therefore comes from exactly one user-supplied number. If that
// number is wrong, every dimension is wrong by the same factor.

export const CAMERA_HEIGHT_LIMITS = Object.freeze({ min: 0.4, max: 2.6 });
export const DEFAULT_CAMERA_HEIGHT_METERS = 1.6;
export const ASSUMED_HORIZONTAL_FOV_DEGREES = 65;
// Used only to choose between rival walls for one ceiling click.
const ASSUMED_CEILING_METERS = 2.7;
// Only flag a tie when the two best readings are genuinely close. Rival walls
// normally imply noticeably different heights, so a wide gap is not ambiguity.
const AMBIGUOUS_SCORE_GAP = 0.15;

const MIN_FOCAL_PIXELS = 8;
const PARALLEL_EPSILON = 1e-7;

export class PhotoMetricError extends RangeError {}

function requireFinite(value, label) {
  if (!Number.isFinite(value)) throw new PhotoMetricError(`${label} must be a finite number.`);
  return value;
}

function requirePoint(point, label) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new PhotoMetricError(`${label} must be an image point with finite x and y.`);
  }
  return point;
}

function clampDimension(value, axis) {
  const limits = ROOM_LIMITS[axis];
  const clamped = Math.min(Math.max(value, limits.min), limits.max);
  return { value: clamped, clamped: clamped !== value };
}

/**
 * Estimate the horizon from per-row vertical-edge energy.
 *
 * A level camera puts the principal row at the horizon, and the floor-wall and
 * ceiling-wall junctions of a wall sit near it. Bisecting the strongest pair of
 * well-separated rows is an approximation, not an identity: the two junctions
 * are symmetric about the horizon only when the ceiling is at twice the camera
 * height. So the result is a starting point the caller is expected to confirm,
 * and `strength` reports how much the chosen rows stand out from the average.
 *
 * `profile` is one non-negative number per image row.
 */
export function estimateHorizonFromRowEnergy(profile, {
  minSeparation = 0.12,
  minStrength = 3,
} = {}) {
  if (!Array.isArray(profile) || profile.length < 8) {
    throw new PhotoMetricError('Row energy profile must have at least 8 rows.');
  }
  const rows = profile.length;
  const energy = profile.map((value) => (Number.isFinite(value) && value > 0 ? value : 0));
  const total = energy.reduce((sum, value) => sum + value, 0);
  const mean = total / rows;
  const centre = (rows - 1) / 2;
  if (total <= 0) return { row: centre, confidence: 0, strength: 0, fallback: 'flat' };

  const separation = Math.max(2, Math.round(rows * minSeparation));
  // Score pairs against the average row rather than against the total energy.
  // A real photo has one dominant junction and a weaker partner, and a rule
  // that demands each row clear a share of the total throws that case away.
  let best = null;
  for (let lower = 0; lower < rows; lower += 1) {
    let partner = lower + separation;
    let partnerEnergy = -1;
    for (let upper = lower + separation; upper < rows; upper += 1) {
      if (energy[upper] > partnerEnergy) {
        partnerEnergy = energy[upper];
        partner = upper;
      }
    }
    if (partner >= rows) continue;
    const strength = ((energy[lower] + partnerEnergy) / 2) / mean;
    if (!best || strength > best.strength) {
      best = { row: (lower + partner) / 2, energy: energy[lower] + partnerEnergy, strength };
    }
  }
  if (!best || best.strength < minStrength) {
    return { row: centre, confidence: 0, strength: best?.strength ?? 0, fallback: 'no-strong-edges' };
  }
  return {
    row: best.row,
    // Share of all edge energy in the chosen pair. Kept for callers that want a
    // 0-1 figure; it reads near zero whenever energy is spread over many rows.
    confidence: best.energy / total,
    strength: best.strength,
  };
}

/** Intersection of two image lines given as [x1, y1, x2, y2], or null. */
export function intersectLines(a, b) {
  const [x1, y1, x2, y2] = a;
  const [x3, y3, x4, y4] = b;
  const denominator = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  const scale = Math.max(Math.abs(x1 - x2) * Math.abs(y3 - y4), Math.abs(y1 - y2) * Math.abs(x3 - x4), 1);
  if (Math.abs(denominator) <= PARALLEL_EPSILON * scale) return null;
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denominator;
  return { x: x1 + t * (x2 - x1), y: y1 + t * (y2 - y1) };
}

/**
 * Focal length in pixels from two orthogonal vanishing points, via
 * f^2 = -(v1 - p) . (v2 - p). Returns null when the estimate is not credible.
 */
export function estimateFocalPixels(vanishingA, vanishingB, principal) {
  if (!vanishingA || !vanishingB) return null;
  const ax = vanishingA.x - principal.x;
  const ay = vanishingA.y - principal.y;
  const bx = vanishingB.x - principal.x;
  const by = vanishingB.y - principal.y;
  const value = -(ax * bx + ay * by);
  if (!Number.isFinite(value) || value <= MIN_FOCAL_PIXELS ** 2) return null;
  return Math.sqrt(value);
}

/** Focal length in pixels implied by an assumed horizontal field of view. */
export function focalPixelsFromFov(imageWidth, fovDegrees = ASSUMED_HORIZONTAL_FOV_DEGREES) {
  const half = (fovDegrees * Math.PI) / 360;
  const focal = imageWidth / 2 / Math.tan(half);
  return Number.isFinite(focal) && focal > MIN_FOCAL_PIXELS ? focal : null;
}

/**
 * Project an image point onto the floor plane, in camera-aligned floor
 * coordinates (x right, z forward, origin beneath the camera).
 */
export function imageToFloor(point, { principal, focalPixels, cameraHeightMeters }) {
  requirePoint(point, 'Image point');
  requireFinite(focalPixels, 'Focal length');
  requireFinite(cameraHeightMeters, 'Camera height');
  const vertical = point.y - principal.y;
  if (Math.abs(vertical) < 1e-6) {
    throw new PhotoMetricError('Image point sits on the horizon; it cannot lie on the floor plane.');
  }
  return {
    x: cameraHeightMeters * (point.x - principal.x) / vertical,
    z: cameraHeightMeters * focalPixels / vertical,
  };
}

/** Project a floor-plane point back into the image. Used to verify the inverse. */
export function floorToImage(floorPoint, { principal, focalPixels, cameraHeightMeters }) {
  if (Math.abs(floorPoint.z) < 1e-9) {
    throw new PhotoMetricError('Floor point has zero depth and cannot be projected.');
  }
  return {
    x: principal.x + (focalPixels * floorPoint.x) / floorPoint.z,
    y: principal.y + (focalPixels * cameraHeightMeters) / floorPoint.z,
  };
}

function normalise(vector) {
  const length = Math.hypot(vector.x, vector.z);
  if (length < 1e-12) return null;
  return { x: vector.x / length, z: vector.z / length };
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/**
 * Build the room's floor frame from four image corners given in order around the
 * rectangle, and solve for its footprint and focal length.
 */
export function buildFloorFrame(corners, {
  principal,
  cameraHeightMeters,
  imageWidth,
  assumedFovDegrees = ASSUMED_HORIZONTAL_FOV_DEGREES,
}) {
  if (!Array.isArray(corners) || corners.length !== 4) {
    throw new PhotoMetricError('Exactly four floor corners are required, in order around the room.');
  }
  corners.forEach((corner, index) => requirePoint(corner, `Corner ${index + 1}`));

  const warnings = [];
  const vanishingA = intersectLines(
    [corners[0].x, corners[0].y, corners[1].x, corners[1].y],
    [corners[2].x, corners[2].y, corners[3].x, corners[3].y],
  );
  const vanishingB = intersectLines(
    [corners[1].x, corners[1].y, corners[2].x, corners[2].y],
    [corners[3].x, corners[3].y, corners[0].x, corners[0].y],
  );

  let focalPixels = estimateFocalPixels(vanishingA, vanishingB, principal);
  let focalSource = 'vanishing-points';
  if (focalPixels === null) {
    // Perfectly parallel edges give vanishing points at infinity, so the
    // orthogonality constraint cannot pin the focal length down.
    focalPixels = focalPixelsFromFov(imageWidth, assumedFovDegrees);
    focalSource = 'assumed-fov';
    if (focalPixels === null) throw new PhotoMetricError('Could not determine a focal length from this image.');
    warnings.push('Opposing edges are parallel, so the focal length came from the assumed field of view.');
  }

  const floor = corners.map((corner) => imageToFloor(corner, { principal, focalPixels, cameraHeightMeters }));
  // Average opposite sides so a mis-clicked corner biases both edges equally.
  const sideA = (distance(floor[0], floor[1]) + distance(floor[2], floor[3])) / 2;
  const sideB = (distance(floor[1], floor[2]) + distance(floor[3], floor[0])) / 2;

  const axisA = normalise({ x: floor[1].x - floor[0].x, z: floor[1].z - floor[0].z });
  const axisB = normalise({ x: floor[2].x - floor[1].x, z: floor[2].z - floor[1].z });
  if (!axisA || !axisB) throw new PhotoMetricError('Floor corners are coincident; the room has no extent.');
  if (sideA <= 0 || sideB <= 0) throw new PhotoMetricError('Floor corners describe a room with no footprint.');

  const orthogonality = Math.abs(axisA.x * axisB.x + axisA.z * axisB.z);
  if (orthogonality > 0.25) {
    warnings.push('The clicked floor edges are not close to perpendicular, so this may not be a rectangular room.');
  }

  // Camera position in the rectangle's own frame, whose origin is corner 0.
  const camera = {
    u: axisA.x * -floor[0].x + axisA.z * -floor[0].z,
    v: axisB.x * -floor[0].x + axisB.z * -floor[0].z,
  };

  return {
    floor,
    focalPixels,
    focalSource,
    vanishingA,
    vanishingB,
    axisA,
    axisB,
    sideA,
    sideB,
    orthogonality,
    camera,
    warnings,
  };
}

/**
 * Candidate room heights for one clicked ceiling-wall junction. The click does
 * not say which of the four walls it landed on, and each choice implies a
 * different height, so solve for all of them and let the caller pick.
 */
export function solveRoomHeightCandidates(ceilingPoint, frame, { principal, cameraHeightMeters }) {
  requirePoint(ceilingPoint, 'Ceiling junction');
  const apparentSlope = (ceilingPoint.x - principal.x) / frame.focalPixels;
  const candidates = [];

  for (const axis of ['a', 'b']) {
    // Walking axis `axis` runs along the wall; across is the perpendicular one.
    const along = axis === 'a' ? frame.axisA : frame.axisB;
    const across = axis === 'a' ? frame.axisB : frame.axisA;
    // Walls perpendicular to `across` sit at the two extremes of that axis.
    const acrossExtent = axis === 'a' ? frame.sideB : frame.sideA;
    const cameraAcross = axis === 'a' ? frame.camera.v : frame.camera.u;

    const denominator = along.x - apparentSlope * along.z;
    if (Math.abs(denominator) < 1e-6) continue;

    for (const wallAcross of [0, acrossExtent]) {
      const gap = wallAcross - cameraAcross;
      const alongOffset = gap * (apparentSlope * across.z - across.x) / denominator;
      const depth = alongOffset * along.z + gap * across.z;
      if (!(depth > 1e-6)) continue;
      candidates.push({
        axis,
        wall: wallAcross === 0 ? 'near' : 'far',
        depth,
        height: cameraHeightMeters - ((ceilingPoint.y - principal.y) * depth) / frame.focalPixels,
      });
    }
  }
  if (!candidates.length) {
    throw new PhotoMetricError('Ceiling junction is too close to the vanishing direction to solve for height.');
  }
  return candidates;
}

function round(value, places = 2) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function scoreHeight(height) {
  const limits = ROOM_LIMITS.height;
  if (height < limits.min || height > limits.max) return Number.POSITIVE_INFINITY;
  return Math.abs(height - ASSUMED_CEILING_METERS);
}

/**
 * Rank the candidate walls for a single ceiling click.
 *
 * A click on a ceiling-wall junction does not say which wall it landed on, and
 * every reading is geometrically valid. There is no scale-free way to tell them
 * apart, so `preferredWall` lets the caller state the answer and the ranking is
 * only the fallback suggestion. That suggestion assumes a typical ceiling,
 * which is a prior and not a measurement.
 */
export function rankCeilingCandidates(candidates, preferredWall = null) {
  const ranked = [...candidates].sort((a, b) => scoreHeight(a.height) - scoreHeight(b.height));
  const preferred = preferredWall === null
    ? null
    : candidates.find((candidate) => `${candidate.axis}-${candidate.wall}` === preferredWall);
  const best = preferred ?? ranked[0];
  const runnerUp = ranked.find((candidate) => candidate !== best);
  const ambiguous = preferred === null
    && Number.isFinite(scoreHeight(best.height))
    && runnerUp !== undefined
    && Number.isFinite(scoreHeight(runnerUp.height))
    && scoreHeight(runnerUp.height) - scoreHeight(best.height) < AMBIGUOUS_SCORE_GAP;
  return { best, ranked, ambiguous, usedPrior: preferred === null };
}

/**
 * Full estimate. Returns room dimensions in metres plus the evidence behind
 * them, so the UI can show its work rather than assert numbers.
 */
export function estimateRoomFromPhoto({
  corners,
  ceilingPoint,
  imageSize,
  horizonRow,
  cameraHeightMeters = DEFAULT_CAMERA_HEIGHT_METERS,
  assumedFovDegrees = ASSUMED_HORIZONTAL_FOV_DEGREES,
  preferredWall = null,
}) {
  if (!imageSize || !(imageSize.width > 0) || !(imageSize.height > 0)) {
    throw new PhotoMetricError('Image size must have positive width and height.');
  }
  requireFinite(horizonRow, 'Horizon row');
  if (cameraHeightMeters < CAMERA_HEIGHT_LIMITS.min || cameraHeightMeters > CAMERA_HEIGHT_LIMITS.max) {
    throw new PhotoMetricError(
      `Camera height must be between ${CAMERA_HEIGHT_LIMITS.min} and ${CAMERA_HEIGHT_LIMITS.max} metres.`,
    );
  }

  const principal = { x: imageSize.width / 2, y: horizonRow };
  const frame = buildFloorFrame(corners, {
    principal,
    cameraHeightMeters,
    imageWidth: imageSize.width,
    assumedFovDegrees,
  });
  const candidates = solveRoomHeightCandidates(ceilingPoint, frame, { principal, cameraHeightMeters });
  const { best, ranked, ambiguous, usedPrior } = rankCeilingCandidates(candidates, preferredWall);

  const warnings = [...frame.warnings];
  if (usedPrior) {
    warnings.push(`The ceiling click was read against the ${best.wall} ${best.axis === 'a' ? 'side' : 'end'} wall, chosen by assuming a typical ceiling.`);
  }
  if (ambiguous) {
    warnings.push('Two walls imply almost the same height, so this reading is not trustworthy; confirm the wall.');
  }
  if (best.wall === 'far' && usedPrior) {
    warnings.push('A far-wall reading is the less reliable of the two.');
  }

  // Which footprint side is called width is a presentation choice; keep the
  // longer one on width so the result reads naturally in the inspector.
  const [long, short] = frame.sideA >= frame.sideB ? [frame.sideA, frame.sideB] : [frame.sideB, frame.sideA];
  const width = clampDimension(long, 'width');
  const depth = clampDimension(short, 'depth');
  const clampedHeight = clampDimension(best.height, 'height');
  for (const [axis, result] of [['width', width], ['depth', depth], ['height', clampedHeight]]) {
    if (result.clamped) warnings.push(`${axis} was clamped to the ${axis} limits.`);
  }

  return {
    dimensions: {
      width: round(width.value),
      depth: round(depth.value),
      height: round(clampedHeight.value),
    },
    raw: { width: round(long), depth: round(short), height: round(best.height) },
    cameraHeightMeters,
    principal,
    focalPixels: round(frame.focalPixels, 1),
    focalSource: frame.focalSource,
    ceilingWall: `${best.axis}-${best.wall}`,
    usedCeilingPrior: usedPrior,
    ceilingDepth: round(best.depth, 2),
    candidates: ranked.map((candidate) => ({
      wall: `${candidate.axis}-${candidate.wall}`,
      depth: round(candidate.depth, 2),
      height: round(candidate.height),
      selected: candidate === best,
    })),
    orthogonality: round(frame.orthogonality, 3),
    warnings,
  };
}
