import {
  ASSUMED_HORIZONTAL_FOV_DEGREES,
  CAMERA_HEIGHT_LIMITS,
  DEFAULT_CAMERA_HEIGHT_METERS,
  PhotoMetricError,
  estimateHorizonFromRowEnergy,
  estimateRoomFromPhoto,
} from '../model/room-photo-metrics.js';

// A photograph cannot yield metric dimensions on its own: the geometry recovers
// proportions, and absolute scale comes from the camera-height reference the
// user supplies. This panel therefore never presents its output as a
// measurement. It shows the evidence, keeps every step editable, and leaves the
// real inputs -- the room W/D/D fields -- in the user's hands.

export const CORNER_COUNT = 4;
const SAMPLE_ROWS = 160;
const SAMPLE_WIDTH = 200;

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));

/**
 * Per-row vertical-edge energy for a downscaled greyscale copy of the photo.
 * The horizon of a level camera bisects the strongest symmetric pair of
 * horizontal junctions, so this is the only automatic step; everything after it
 * is confirmed by the user.
 */
export function rowEdgeEnergy(imageData) {
  const { width, height, data } = imageData;
  const profile = new Array(height).fill(0);
  const luma = (offset) => (
    0.299 * data[offset] + 0.587 * data[offset + 1] + 0.114 * data[offset + 2]
  );
  for (let y = 1; y < height; y += 1) {
    let total = 0;
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const above = index - width * 4;
      total += Math.abs(luma(index) - luma(above));
    }
    profile[y] = total / width;
  }
  return profile;
}

/** Scale a row profile measured on a downscaled copy back to full image rows. */
export function scaleHorizonRow(row, sampleHeight, imageHeight) {
  if (!(sampleHeight > 0)) throw new PhotoMetricError('Sample height must be positive.');
  return (row * imageHeight) / sampleHeight;
}

// A global symbol rather than a window property or a module-local variable: with
// HMR the editor and a test can end up holding two module instances of this
// file, and a module-local handle would only reach one of them.
const REGISTRY = Symbol.for('roomshift.roomPhotoPanel');
let activePanel = globalThis[REGISTRY] ?? null;

/**
 * The most recently created panel. The editor owns one, but exposing it from
 * the module lets a browser test reach the same instance without the editor
 * having to publish test hooks on `window`.
 */
export function getActivePhotoPanel() {
  return globalThis[REGISTRY] ?? activePanel;
}

export function createRoomPhotoPanel({
  mount,
  onApply,
  document: doc = document,
}) {
  const panel = {};
  const state = {
    image: null,
    imageUrl: null,
    corners: [],
    ceilingPoint: null,
    horizonRow: null,
    horizonConfidence: 0,
    horizonStrength: 0,
    cameraHeightMeters: DEFAULT_CAMERA_HEIGHT_METERS,
    preferredWall: null,
    result: null,
    error: null,
    step: 0,
  };

  activePanel = panel;
  globalThis[REGISTRY] = panel;

  const root = doc.createElement('section');
  root.className = 'photo-panel';
  root.hidden = true;
  root.setAttribute('aria-label', 'Estimate room dimensions from a photograph');
  root.innerHTML = `
    <header class="photo-panel-head">
      <h2 class="photo-panel-title">From photograph</h2>
      <button class="quiet-button" data-photo-close type="button" aria-label="Close">Close</button>
    </header>
    <p class="photo-panel-note">
      An estimate, not a measurement. Take the photo from outside the room looking in, with all
      four floor corners visible. Absolute scale comes from the camera height you enter, so every
      dimension is only as good as that number.
    </p>
    <div class="photo-panel-body">
      <div class="photo-stage">
        <canvas data-photo-canvas class="photo-canvas"></canvas>
        <p class="photo-prompt" data-photo-prompt>Load a photograph to begin.</p>
      </div>
      <div class="photo-controls">
        <label class="field">
          <span>Photo</span>
          <input data-photo-file type="file" accept="image/*" aria-label="Room photograph" />
        </label>
        <label class="field">
          <span>Camera height</span>
          <input data-photo-camera-height type="number" step="0.05" min="${CAMERA_HEIGHT_LIMITS.min}"
            max="${CAMERA_HEIGHT_LIMITS.max}" value="${DEFAULT_CAMERA_HEIGHT_METERS}"
            aria-label="Camera height in metres" />
        </label>
        <p class="photo-hint" data-photo-horizon></p>
        <div class="photo-readout" data-photo-readout hidden>
          <div class="photo-readout-row"><span>Width</span><strong data-photo-width></strong></div>
          <div class="photo-readout-row"><span>Depth</span><strong data-photo-depth></strong></div>
          <div class="photo-readout-row"><span>Height</span><strong data-photo-height></strong></div>
          <label class="field">
            <span>Wall</span>
            <select data-photo-wall aria-label="Wall the ceiling click sits on"></select>
          </label>
          <ul class="photo-warnings" data-photo-warnings></ul>
          <button class="quiet-button" data-photo-apply type="button">Apply to room</button>
        </div>
        <p class="photo-error" data-photo-error role="alert" hidden></p>
      </div>
    </div>
  `;
  mount.append(root);

  const canvas = root.querySelector('[data-photo-canvas]');
  const context = canvas.getContext('2d');
  const prompt = root.querySelector('[data-photo-prompt]');
  const fileInput = root.querySelector('[data-photo-file]');
  const cameraHeightInput = root.querySelector('[data-photo-camera-height]');
  const horizonNote = root.querySelector('[data-photo-horizon]');
  const readout = root.querySelector('[data-photo-readout]');
  const wallSelect = root.querySelector('[data-photo-wall]');
  const warningsList = root.querySelector('[data-photo-warnings]');
  const errorNote = root.querySelector('[data-photo-error]');
  const applyButton = root.querySelector('[data-photo-apply]');

  const STEPS = [
    'Click the first floor corner, then go around the room.',
    'Click the second floor corner.',
    'Click the third floor corner.',
    'Click the fourth floor corner to close the floor rectangle.',
    'Click a ceiling-wall junction where the ceiling meets a wall.',
  ];

  function setError(message) {
    state.error = message;
    errorNote.hidden = !message;
    errorNote.textContent = message ?? '';
  }

  function draw() {
    if (!state.image) return;
    const { width, height } = state.image;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    context.clearRect(0, 0, width, height);
    context.drawImage(state.image, 0, 0, width, height);

    // The horizon is a scale reference, so it is drawn as a draggable line.
    if (Number.isFinite(state.horizonRow)) {
      context.strokeStyle = 'rgba(255, 196, 64, 0.95)';
      context.lineWidth = Math.max(1, width / 600);
      context.setLineDash([width / 60, width / 90]);
      context.beginPath();
      context.moveTo(0, state.horizonRow);
      context.lineTo(width, state.horizonRow);
      context.stroke();
      context.setLineDash([]);
    }

    state.corners.forEach((corner, index) => {
      context.fillStyle = 'rgba(88, 190, 255, 0.95)';
      context.beginPath();
      context.arc(corner.x, corner.y, Math.max(4, width / 180), 0, Math.PI * 2);
      context.fill();
      context.fillStyle = 'rgba(10, 14, 20, 0.9)';
      context.font = `${Math.max(10, width / 90)}px system-ui, sans-serif`;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(String(index + 1), corner.x, corner.y);
    });

    if (state.corners.length === CORNER_COUNT) {
      context.strokeStyle = 'rgba(88, 190, 255, 0.75)';
      context.lineWidth = Math.max(1, width / 800);
      context.beginPath();
      context.moveTo(state.corners[0].x, state.corners[0].y);
      for (const corner of state.corners.slice(1)) context.lineTo(corner.x, corner.y);
      context.closePath();
      context.stroke();
    }

    if (state.ceilingPoint) {
      context.strokeStyle = 'rgba(255, 138, 76, 0.95)';
      context.lineWidth = Math.max(1, width / 500);
      context.beginPath();
      context.arc(state.ceilingPoint.x, state.ceilingPoint.y, Math.max(4, width / 160), 0, Math.PI * 2);
      context.stroke();
    }
  }

  function render() {
    draw();
    const complete = state.corners.length === CORNER_COUNT && state.ceilingPoint;
    prompt.textContent = state.image
      ? (state.step < STEPS.length ? STEPS[state.step] : 'Adjust the horizon or the points, then apply.')
      : 'Load a photograph to begin.';
    prompt.hidden = !state.image;
    horizonNote.textContent = Number.isFinite(state.horizonRow)
      ? `Estimated horizon at row ${Math.round(state.horizonRow)} of ${state.image?.height ?? 0}`
        + `, on junctions ${state.horizonStrength.toFixed(1)}\u00d7 stronger than an average row.`
        + ' Drag the line to correct it.'
      : '';

    readout.hidden = !state.result;
    applyButton.disabled = !state.result;
    if (state.result) {
      const { dimensions, candidates, warnings } = state.result;
      root.querySelector('[data-photo-width]').textContent = `${dimensions.width.toFixed(2)} m`;
      root.querySelector('[data-photo-depth]').textContent = `${dimensions.depth.toFixed(2)} m`;
      root.querySelector('[data-photo-height]').textContent = `${dimensions.height.toFixed(2)} m`;
      const chosen = state.preferredWall ?? state.result.ceilingWall;
      wallSelect.innerHTML = candidates.map((candidate) => `<option value="${escapeHtml(candidate.wall)}"`
        + `${candidate.wall === chosen ? ' selected' : ''}>${escapeHtml(candidate.wall)} wall`
        + ` → ${candidate.height.toFixed(2)} m</option>`).join('');
      warningsList.innerHTML = warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join('');
    }
  }

  function recompute() {
    if (!state.image || state.corners.length !== CORNER_COUNT || !state.ceilingPoint) {
      state.result = null;
      setError(null);
      render();
      return;
    }
    try {
      state.result = estimateRoomFromPhoto({
        corners: state.corners,
        ceilingPoint: state.ceilingPoint,
        imageSize: { width: state.image.width, height: state.image.height },
        horizonRow: state.horizonRow,
        cameraHeightMeters: state.cameraHeightMeters,
        preferredWall: state.preferredWall,
      });
      setError(null);
    } catch (error) {
      state.result = null;
      setError(error instanceof PhotoMetricError ? error.message : 'Could not read this photograph.');
    }
    render();
  }

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('That file could not be read as an image.'));
      image.src = url;
    });
  }

  async function analyseHorizon(image) {
    const scratch = document.createElement('canvas');
    const scale = Math.min(1, SAMPLE_WIDTH / image.width, SAMPLE_ROWS / image.height);
    scratch.width = Math.max(8, Math.round(image.width * scale));
    scratch.height = Math.max(8, Math.round(image.height * scale));
    const scratchContext = scratch.getContext('2d', { willReadFrequently: true });
    scratchContext.drawImage(image, 0, 0, scratch.width, scratch.height);
    const data = scratchContext.getImageData(0, 0, scratch.width, scratch.height);
    const horizon = estimateHorizonFromRowEnergy(rowEdgeEnergy(data));
    state.horizonRow = scaleHorizonRow(horizon.row, scratch.height, image.height);
    state.horizonConfidence = horizon.confidence;
    state.horizonStrength = horizon.strength;
  }

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    setError(null);
    if (state.imageUrl) URL.revokeObjectURL(state.imageUrl);
    state.imageUrl = URL.createObjectURL(file);
    try {
      state.image = await loadImage(state.imageUrl);
    } catch (error) {
      state.image = null;
      setError(error.message);
      render();
      return;
    }
    state.corners = [];
    state.ceilingPoint = null;
    state.result = null;
    state.preferredWall = null;
    state.step = 0;
    await analyseHorizon(state.image);
    recompute();
  });

  // Pointer work: drag the horizon, click to place points, drag a placed point.
  let dragging = null;
  const imagePoint = (event) => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  };
  const near = (point, target, tolerance) => (
    target && Math.hypot(point.x - target.x, point.y - target.y) <= tolerance
  );
  const tolerance = () => Math.max(8, canvas.width / 90);

  canvas.addEventListener('pointerdown', (event) => {
    if (!state.image) return;
    const point = imagePoint(event);
    const grab = (target, index) => (near(point, target, tolerance()) ? { index } : null);
    if (near(point, state.ceilingPoint, tolerance())) {
      dragging = { kind: 'ceiling' };
    } else if (state.corners.length < CORNER_COUNT) {
      dragging = { kind: 'add' };
    } else if ((dragging = grab(state.ceilingPoint, 4))) {
      dragging.kind = 'ceiling';
    } else {
      dragging = null;
      for (let index = 0; index < state.corners.length; index += 1) {
        if (near(point, state.corners[index], tolerance())) {
          dragging = { kind: 'corner', index };
          break;
        }
      }
    }
    canvas.setPointerCapture(event.pointerId);
    applyDrag(point);
  });

  canvas.addEventListener('pointermove', (event) => {
    if (dragging) applyDrag(imagePoint(event));
  });
  canvas.addEventListener('pointerup', (event) => {
    canvas.releasePointerCapture(event.pointerId);
    dragging = null;
  });

  function applyDrag(point) {
    if (!dragging) return;
    if (dragging.kind === 'ceiling') {
      state.ceilingPoint = point;
    } else if (dragging.kind === 'corner') {
      state.corners[dragging.index] = point;
    } else {
      const band = tolerance();
      if (state.corners.length === CORNER_COUNT) {
        // With the floor closed, a click near the horizon line re-levels it.
        if (Math.abs(point.y - state.horizonRow) <= band) {
          state.horizonRow = point.y;
          recompute();
          return;
        }
        state.ceilingPoint = point;
      } else {
        state.corners.push(point);
        state.step = Math.min(state.step + 1, STEPS.length - 1);
      }
    }
    recompute();
  }

  cameraHeightInput.addEventListener('input', () => {
    const value = Number(cameraHeightInput.value);
    if (!Number.isFinite(value)) return;
    state.cameraHeightMeters = value;
    recompute();
  });

  wallSelect.addEventListener('change', () => {
    state.preferredWall = wallSelect.value;
    recompute();
  });

  applyButton.addEventListener('click', () => {
    if (!state.result) return;
    onApply({ ...state.result.dimensions });
  });

  root.querySelector('[data-photo-close]').addEventListener('click', () => {
    root.hidden = true;
  });

  Object.assign(panel, {
    root,
    state,
    open() {
      root.hidden = false;
      render();
    },
    close() {
      root.hidden = true;
    },
    get isOpen() {
      return !root.hidden;
    },
    // Exposed for tests: drive the panel without synthesising pointer events.
    setImageForTest(image) {
      state.image = image;
      state.corners = [];
      state.ceilingPoint = null;
      state.step = 0;
      state.result = null;
      render();
    },
    setHorizonForTest(row) {
      state.horizonRow = row;
      recompute();
    },
    setCameraHeightForTest(value) {
      state.cameraHeightMeters = value;
      recompute();
    },
    setPointsForTest({ corners, ceilingPoint, preferredWall = null }) {
      state.corners = corners ? [...corners] : state.corners;
      state.ceilingPoint = ceilingPoint ?? state.ceilingPoint;
      state.preferredWall = preferredWall;
      state.step = CORNER_COUNT;
      recompute();
    },
    applyNow() {
      if (state.result) onApply({ ...state.result.dimensions });
    },
    assumedFovDegrees: ASSUMED_HORIZONTAL_FOV_DEGREES,
  });

  return panel;
}