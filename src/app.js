import {
  MODEL_PRESETS,
  addObject,
  addWindow,
  moveObject,
  removeObject,
  renameObject,
  resizeObject,
  resizeRoom,
  rotateObject,
  setObjectModel,
  setWindowOpen,
  setWindowWall,
} from './model/room-scene.js';
import { UndoHistory } from './model/undo-history.js';
import { RoomFieldController } from './simulation/room-field-controller.js';
import {
  createEditorState,
  resetEditorState,
  selectObject as selectEditorObject,
  setTransformMode as setEditorTransformMode,
  setView as setEditorView,
} from './model/editor-state.js';
import { RoomViewport } from './scene/room-viewport.js';

const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
})[character]);
const svgIcon = (paths, size = 'h-3.5 w-3.5') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="${size}">${paths}</svg>`;
const MODEL_ICONS = Object.freeze({
  box: svgIcon('<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>'),
  fan: svgIcon('<path d="M10.827 16.379a6.082 6.082 0 0 1-8.618-7.002l5.412 1.45a6.082 6.082 0 0 1 7.002-8.618l-1.45 5.412a6.082 6.082 0 0 1 8.618 7.002l-5.412-1.45a6.082 6.082 0 0 1-7.002 8.618l1.45-5.412Z"/><path d="M12 12h.01"/>'),
  sofa: svgIcon('<path d="M20 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v3"/><path d="M2 16a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-5a2 2 0 0 0-4 0v2H6v-2a2 2 0 0 0-4 0Z"/><path d="M4 18v2"/><path d="M20 18v2"/>'),
  bed: svgIcon('<path d="M2 4v16"/><path d="M2 8h18a2 2 0 0 1 2 2v10"/><path d="M2 17h20"/><path d="M6 8v9"/>'),
  desk: svgIcon('<path d="M2 8h20"/><path d="M5 8v12"/><path d="M19 8v12"/><path d="M5 13h14"/>'),
  table: svgIcon('<ellipse cx="12" cy="7" rx="9" ry="2.5"/><path d="M5 9.5V19"/><path d="M19 9.5V19"/><path d="M12 9.5V19"/>'),
  lamp: svgIcon('<path d="M9 3h6l2.5 6h-11L9 3Z"/><path d="M12 9v11"/><path d="M8 20h8"/>'),
  heater: svgIcon('<rect x="3" y="5" width="18" height="11" rx="2"/><path d="M7 5v11"/><path d="M12 5v11"/><path d="M17 5v11"/><path d="M4 20h16"/>'),
  window: svgIcon('<rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M12 3v18"/><path d="M4 12h16"/>'),
});
const modelIcon = (model) => MODEL_ICONS[model] ?? MODEL_ICONS.box;
const roomInputs = {
  width: $('#room-width'),
  depth: $('#room-depth'),
  height: $('#room-height'),
};
const objectList = $('#object-list');
const objectCount = $('#object-count');
const properties = $('#object-properties');
const solvingIndicator = {
  badge: $('#field-solving'),
  label: $('#field-solving-label'),
  progress: $('#field-progress'),
};
const fieldControls = {
  airflow: $('#show-airflow'),
  temperature: $('#show-temperature'),
  light: $('#show-light'),
  status: $('#field-status'),
  legend: $('#field-legend'),
  legendTitle: $('#field-legend-title'),
  gradient: $('#field-gradient'),
  legendMin: $('#field-legend-min'),
  legendMax: $('#field-legend-max'),
};

let editorState = createEditorState();
let roomScene = editorState.scene;
let selectedId = editorState.selectedId;
let transformMode = editorState.transformMode;
let viewport;
let fieldController;
const history = new UndoHistory();
let isDragging = false;
let dragSnapshot = null;

function currentSnapshot() {
  return { scene: roomScene, selectedId };
}

function recordHistory() {
  history.record(currentSnapshot());
}

function setPressed(button, pressed) {
  button.classList.toggle('active', pressed);
  button.setAttribute('aria-pressed', String(pressed));
}

function updateScene(scene, { record = !isDragging } = {}) {
  if (JSON.stringify(scene) === JSON.stringify(roomScene)) return;
  if (record) recordHistory();
  roomScene = scene;
  editorState = { ...editorState, scene };
  fieldController?.setScene(scene);
}

function renderFieldState({ mode, loading, result, error }) {
  const viewportElement = $('#viewport');
  const solvingLabels = {
    airflow: 'Solving airflow…',
    temperature: 'Solving temperature…',
    light: 'Preparing light preview…',
  };
  for (const [name, button] of Object.entries({
    airflow: fieldControls.airflow,
    temperature: fieldControls.temperature,
    light: fieldControls.light,
  })) {
    setPressed(button, mode === name);
    button.classList.toggle('solving', loading && mode === name);
  }
  solvingIndicator.badge.hidden = !loading;
  solvingIndicator.progress.hidden = !loading;
  solvingIndicator.label.textContent = solvingLabels[mode] ?? 'Solving…';
  viewportElement.classList.toggle('field-active', Boolean(mode));
  viewportElement.setAttribute('aria-busy', String(loading));
  fieldControls.legend.hidden = !mode || (mode !== 'light' && !result);
  fieldControls.status.textContent = loading ? 'Solving…' : error ? 'Unavailable' : '';
  fieldControls.status.dataset.state = loading ? 'loading' : error ? 'error' : '';
  fieldControls.status.title = error?.message ?? '';
  if (mode === 'light') {
    fieldControls.status.textContent = loading ? 'Preparing…' : error ? 'Unavailable' : 'Realtime shadows';
    fieldControls.status.title = error?.message ?? 'Monochrome room render with lamp point lights and cast shadows.';
    fieldControls.gradient.dataset.mode = 'light';
    fieldControls.legendTitle.textContent = 'Lighting · shadow preview';
    fieldControls.legendMin.textContent = 'shadow';
    fieldControls.legendMax.textContent = 'lit';
    return;
  }
  if (!result) return;

  const cellSize = result.grid.cellSize ?? Math.max(result.grid.dx, result.grid.dy, result.grid.dz);
  const resolution = cellSize < 0.1 ? `${Math.round(cellSize * 100)} cm` : `${cellSize.toFixed(2)} m`;
  const backend = result.backend === 'webgpu' ? 'GPU' : result.backend === 'cpu-preview' ? 'CPU preview' : 'CPU';
  fieldControls.status.textContent = `${backend} · ${resolution}`;
  fieldControls.status.title = result.backend === 'cpu-preview'
    ? 'WebGPU is unavailable; this lower-resolution CPU preview can miss fine details.'
    : result.assumptions?.model ?? '';

  fieldControls.gradient.dataset.mode = mode;
  let legend;
  if (mode === 'airflow') {
    legend = {
      title: 'Airflow · estimate',
      minimum: '0 m/s',
      maximum: `${result.stats.maxSpeed.toFixed(2)} m/s`,
    };
  } else if (mode === 'temperature') {
    const precision = result.stats.maxTemperature - result.ambientTemperature >= 1 ? 1 : 2;
    legend = {
      title: 'Temperature · estimate',
      minimum: `${result.ambientTemperature.toFixed(precision)} °C`,
      maximum: `${result.stats.maxTemperature.toFixed(precision)} °C`,
    };
  } else {
    legend = {
      title: 'Lighting · shadow preview',
      minimum: 'shadow',
      maximum: 'lit',
    };
  }
  fieldControls.legendTitle.textContent = legend.title;
  fieldControls.legendMin.textContent = legend.minimum;
  fieldControls.legendMax.textContent = legend.maximum;
}

function updateSelection(objectId) {
  selectedId = objectId;
  editorState = selectEditorObject(editorState, objectId);
}

function selectedObject() {
  return roomScene.objects.find((object) => object.id === selectedId) ?? null;
}

function restoreSnapshot(snapshot) {
  roomScene = structuredClone(snapshot.scene);
  selectedId = snapshot.selectedId && roomScene.objects.some((object) => object.id === snapshot.selectedId)
    ? snapshot.selectedId
    : null;
  editorState = { ...editorState, scene: roomScene, selectedId };
  fieldController?.setScene(roomScene);
  refreshScene();
  viewport.setMode(transformMode);
}

function undo() {
  const snapshot = history.undo(currentSnapshot());
  if (snapshot) restoreSnapshot(snapshot);
}

function redo() {
  const snapshot = history.redo(currentSnapshot());
  if (snapshot) restoreSnapshot(snapshot);
}

function updateRoomSummary() {
  const { width, depth, height } = roomScene.room;
  $('#room-summary').textContent = `${width.toFixed(1)} × ${depth.toFixed(1)} × ${height.toFixed(1)} m`;
  for (const [dimension, input] of Object.entries(roomInputs)) input.value = roomScene.room[dimension];
}

function renderObjectList() {
  const rows = roomScene.objects.map((object) => {
    const model = MODEL_PRESETS[object.model] ?? MODEL_PRESETS.box;
    const isSelected = object.id === selectedId;
    return `
      <button type="button" data-select-object="${escapeHtml(object.id)}" aria-pressed="${isSelected}" title="${escapeHtml(object.name)}"
        class="flex h-10 w-full shrink-0 items-center gap-2.5 rounded-lg border px-2 text-left transition-colors duration-100 ${isSelected ? 'border-emerald-200/80 bg-emerald-50/70 text-emerald-900' : 'border-transparent text-slate-600 hover:bg-slate-50 hover:text-slate-900'}">
        <span aria-hidden="true" class="grid h-6 w-6 shrink-0 place-items-center rounded-md ${isSelected ? 'bg-emerald-600/10 text-emerald-700' : 'bg-slate-100 text-slate-400'}">${modelIcon(object.model)}</span>
        <span class="min-w-0 flex-1 truncate text-xs font-medium">${escapeHtml(object.name)}</span>
        <span class="shrink-0 text-[9px] font-semibold uppercase tracking-wide ${isSelected ? 'text-emerald-600/90' : 'text-slate-300'}">${escapeHtml(model.label)}</span>
      </button>
    `;
  }).join('');
  objectList.innerHTML = rows
    || '<div class="rounded-lg border border-dashed border-slate-200 px-2 py-4 text-center text-[10px] leading-snug text-slate-400">No objects yet — add one from the left rail.</div>';
  objectCount.textContent = String(roomScene.objects.length);
}

function propertyField(label, axis, value, kind, limits = {}) {
  return `<label class="property-field"><span>${label}</span><input class="text-field" type="number" step="0.05" value="${value.toFixed(2)}" data-${kind}="${axis}" aria-label="${kind === 'position' ? 'Position' : 'Dimensions'} ${label}" ${limits.min === undefined ? '' : `min="${limits.min}"`} ${limits.max === undefined ? '' : `max="${limits.max}"`} /></label>`;
}

function renderProperties() {
  const object = selectedObject();
  const isWindow = object?.model === 'window';
  $('#delete-object').disabled = !object;
  if (!object) {
    properties.innerHTML = `
      <div class="flex min-h-28 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-200 bg-slate-50/50 px-4 py-6 text-center">
        <svg class="h-6 w-6 text-slate-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/><path d="m13 13 6 6"/></svg>
        <span class="text-xs font-medium text-slate-400">Nothing selected</span>
        <span class="text-[10px] leading-snug text-slate-400">Click an object in the scene, or pick one from the objects list.</span>
      </div>`;
    return;
  }

  const maxWindowWidth = object.wall === 'back' || object.wall === 'front' ? roomScene.room.width - 0.2 : roomScene.room.depth - 0.2;
  const dimensionLimits = {
    width: { min: 0.1, max: roomScene.room.width },
    height: { min: 0.1, max: roomScene.room.height },
    depth: { min: 0.1, max: roomScene.room.depth },
  };
  const modelOptions = Object.entries(MODEL_PRESETS).filter(([key]) => key !== 'window').map(([key, model]) => (
    `<option value="${escapeHtml(key)}">${escapeHtml(model.label)}</option>`
  )).join('');
  properties.innerHTML = `
    <div class="properties-form">
      <label class="flex flex-col gap-1 border-b border-slate-100 pb-3 max-md:pb-2"><span class="text-[10px] font-semibold text-slate-400">Name</span><input class="text-field" type="text" maxlength="80" data-object-name aria-label="Object name" /></label>
      ${isWindow ? `
        <label class="property-field"><span>Wall</span><select class="select-field" data-window-wall aria-label="Window wall">
          <option value="back">Back</option><option value="front">Front</option><option value="left">Left</option><option value="right">Right</option>
        </select></label>
        <div class="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2">
          <span class="flex min-w-0 flex-col">
            <span class="text-xs font-semibold text-slate-700">Open window</span>
            <span class="text-[10px] ${object.open ? 'text-emerald-600' : 'text-slate-400'}">${object.open ? 'Airflow can escape the room' : 'Sealed — blocks airflow'}</span>
          </span>
          <label class="relative inline-flex shrink-0 cursor-pointer items-center">
            <input type="checkbox" data-window-open class="peer sr-only" aria-label="Window open" ${object.open ? 'checked' : ''} />
            <span class="relative h-5 w-9 rounded-full bg-slate-300 shadow-inner transition-colors duration-150 after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:shadow-sm after:transition-all after:duration-150 after:content-[''] peer-checked:bg-emerald-500 peer-checked:after:translate-x-4 peer-focus-visible:ring-2 peer-focus-visible:ring-emerald-500/40 peer-focus-visible:ring-offset-2"></span>
          </label>
        </div>
      ` : `<label class="property-field"><span>Model</span><select class="select-field" data-object-model aria-label="Box model">${modelOptions}</select></label>`}
      <div class="flex flex-col gap-1.5">
        <div class="property-label">Position · m</div>
        <div class="property-fields">
          ${propertyField('X', 'x', object.position.x, 'position', { min: 0, max: roomScene.room.width })}
          ${propertyField('Y', 'y', object.position.y, 'position', { min: 0, max: roomScene.room.height })}
          ${propertyField('Z', 'z', object.position.z, 'position', { min: 0, max: roomScene.room.depth })}
        </div>
      </div>
      <div class="flex flex-col gap-1.5">
        <div class="property-label">Size · m</div>
        <div class="property-fields">
          ${propertyField('W', 'width', object.dimensions.width, 'dimension', isWindow ? { min: 0.4, max: maxWindowWidth } : dimensionLimits.width)}
          ${propertyField('H', 'height', object.dimensions.height, 'dimension', isWindow ? { min: 0.4, max: roomScene.room.height - 0.2 } : dimensionLimits.height)}
          ${isWindow ? '' : propertyField('D', 'depth', object.dimensions.depth, 'dimension', dimensionLimits.depth)}
        </div>
      </div>
      ${isWindow ? '' : `<div class="flex flex-col gap-1.5 max-md:hidden">
        <div class="property-label">Rotation · °</div>
        <div class="property-fields">
          ${propertyField('X', 'x', object.rotation.x, 'rotation', { min: -180, max: 180 })}
          ${propertyField('Y', 'y', object.rotation.y, 'rotation', { min: -180, max: 180 })}
          ${propertyField('Z', 'z', object.rotation.z, 'rotation', { min: -180, max: 180 })}
        </div>
      </div>`}
      <div class="properties-note ${isWindow ? 'bg-emerald-50/80 text-emerald-700' : 'bg-slate-50 text-slate-400'}">${isWindow ? 'Open windows exhaust airflow and heat from the room.' : 'Drag the gizmo to move or rotate.'}</div>
    </div>
  `;
  properties.querySelector('[data-object-name]').value = object.name;
  if (isWindow) properties.querySelector('[data-window-wall]').value = object.wall;
  else properties.querySelector('[data-object-model]').value = object.model;
}

function renderInspector() {
  updateRoomSummary();
  renderObjectList();
  renderProperties();
}

function handleTransform(objectId, position, rotation) {
  const result = transformMode === 'rotate'
    ? rotateObject(roomScene, objectId, rotation)
    : moveObject(roomScene, objectId, position);
  updateScene(result.scene, { record: false });
  updateRoomSummary();
  syncPropertyInputs(result.object);
  return result;
}

function syncPropertyInputs(object) {
  for (const input of properties.querySelectorAll('[data-position]')) {
    input.value = object.position[input.dataset.position].toFixed(2);
  }
  for (const input of properties.querySelectorAll('[data-rotation]')) {
    input.value = object.rotation[input.dataset.rotation].toFixed(1);
  }
}

function refreshScene() {
  viewport.setScene(roomScene, selectedId);
  renderInspector();
}

function addBox() {
  const result = addObject(roomScene);
  updateScene(result.scene);
  updateSelection(result.object.id);
  refreshScene();
}

function addRoomWindow() {
  const result = addWindow(roomScene);
  updateScene(result.scene);
  updateSelection(result.object.id);
  refreshScene();
}

function toggleFieldMode(mode) {
  fieldController.setMode(fieldController.mode === mode ? null : mode);
}

$('#add-box').addEventListener('click', addBox);
$('#add-window').addEventListener('click', addRoomWindow);
fieldControls.airflow.addEventListener('click', () => toggleFieldMode('airflow'));
fieldControls.temperature.addEventListener('click', () => toggleFieldMode('temperature'));
fieldControls.light.addEventListener('click', () => toggleFieldMode('light'));

objectList.addEventListener('click', (event) => {
  const row = event.target.closest('[data-select-object]');
  if (!row) return;
  updateSelection(row.dataset.selectObject);
  viewport.select(selectedId);
  renderInspector();
});

for (const [dimension, input] of Object.entries(roomInputs)) {
  input.addEventListener('change', () => {
    const dimensions = Object.fromEntries(Object.entries(roomInputs).map(([axis, field]) => [axis, Number(field.value)]));
    try {
      updateScene(resizeRoom(roomScene, dimensions));
      refreshScene();
    } catch {
      input.value = roomScene.room[dimension];
      input.setCustomValidity('Enter a room dimension within the allowed range.');
      input.reportValidity();
      input.setCustomValidity('');
    }
  });
}

properties.addEventListener('change', (event) => {
  const input = event.target;
  const object = selectedObject();
  if (!object) return;

  try {
    if (input.matches('[data-object-name]')) {
      const result = renameObject(roomScene, object.id, input.value);
      updateScene(result.scene);
    } else if (input.matches('[data-object-model]')) {
      const result = setObjectModel(roomScene, object.id, input.value);
      updateScene(result.scene);
    } else if (input.matches('[data-window-open]')) {
      updateScene(setWindowOpen(roomScene, object.id, input.checked).scene);
    } else if (input.matches('[data-window-wall]')) {
      updateScene(setWindowWall(roomScene, object.id, input.value).scene);
    } else if (input.type === 'number' && input.dataset.position) {
      const value = Number(input.value);
      if (!Number.isFinite(value)) return renderProperties();
      const result = moveObject(roomScene, object.id, { [input.dataset.position]: value });
      updateScene(result.scene);
    } else if (input.type === 'number' && input.dataset.dimension) {
      const value = Number(input.value);
      if (!Number.isFinite(value)) return renderProperties();
      const result = resizeObject(roomScene, object.id, { [input.dataset.dimension]: value });
      updateScene(result.scene);
    } else if (input.type === 'number' && input.dataset.rotation) {
      const value = Number(input.value);
      if (!Number.isFinite(value)) return renderProperties();
      const result = rotateObject(roomScene, object.id, { [input.dataset.rotation]: value });
      updateScene(result.scene);
    } else {
      return;
    }
    refreshScene();
  } catch {
    renderProperties();
  }
});

$('#delete-object').addEventListener('click', () => {
  if (!selectedId) return;
  updateScene(removeObject(roomScene, selectedId));
  updateSelection(null);
  refreshScene();
});

$('#reset-scene').addEventListener('click', () => {
  recordHistory();
  fieldController.setMode(null);
  editorState = resetEditorState();
  roomScene = editorState.scene;
  selectedId = editorState.selectedId;
  transformMode = editorState.transformMode;
  $('#mode-move').classList.add('active');
  $('#mode-rotate').classList.remove('active');
  viewport.fitRoom(true);
  viewport.setProjection('perspective');
  setCameraView('3d');
  refreshScene();
  viewport.setMode(transformMode);
});

$('#mode-move').addEventListener('click', () => {
  transformMode = 'translate';
  editorState = setEditorTransformMode(editorState, transformMode);
  viewport.setMode(transformMode);
  $('#mode-move').classList.add('active');
  $('#mode-rotate').classList.remove('active');
});

$('#mode-rotate').addEventListener('click', () => {
  transformMode = 'rotate';
  editorState = setEditorTransformMode(editorState, transformMode);
  viewport.setMode(transformMode);
  $('#mode-rotate').classList.add('active');
  $('#mode-move').classList.remove('active');
});

function setCameraView(view) {
  editorState = setEditorView(editorState, view);
  viewport.setView(view);
  $('#view-3d').classList.toggle('active', view === '3d');
  $('#view-top').classList.toggle('active', view === 'top');
  $('#projection-perspective').classList.toggle('active', viewport.projection === 'perspective');
  $('#projection-orthographic').classList.toggle('active', viewport.projection === 'orthographic');
  $('#view-3d').setAttribute('aria-pressed', String(view === '3d'));
  $('#view-top').setAttribute('aria-pressed', String(view === 'top'));
  $('#projection-perspective').setAttribute('aria-pressed', String(viewport.projection === 'perspective'));
  $('#projection-orthographic').setAttribute('aria-pressed', String(viewport.projection === 'orthographic'));
}

$('#view-3d').addEventListener('click', () => setCameraView('3d'));
$('#view-top').addEventListener('click', () => setCameraView('top'));
$('#projection-perspective').addEventListener('click', () => {
  viewport.setProjection('perspective');
  setCameraView(editorState.view);
});
$('#projection-orthographic').addEventListener('click', () => {
  viewport.setProjection('orthographic');
  setCameraView(editorState.view);
});

$('#view-home').addEventListener('click', () => {
  viewport.setProjection('perspective');
  viewport.fitRoom(true);
  setCameraView('3d');
});

document.addEventListener('keydown', (event) => {
  if (event.target.matches('input, textarea, select, [contenteditable="true"]')) return;
  const key = event.key.toLowerCase();
  if ((event.metaKey || event.ctrlKey) && key === 'z') {
    event.preventDefault();
    event.shiftKey ? redo() : undo();
    return;
  }
  if ((event.metaKey || event.ctrlKey) && key === 'y') {
    event.preventDefault();
    redo();
    return;
  }
  if (key === 'g') $('#mode-move').click();
  if (key === 'r') $('#mode-rotate').click();
  if (key === 'o') $('#projection-orthographic').click();
  if ((event.key === 'Delete' || event.key === 'Backspace') && selectedId) $('#delete-object').click();
});

const shortcutHelp = $('#shortcut-help');
$('#show-shortcuts').addEventListener('click', () => {
  shortcutHelp.hidden = !shortcutHelp.hidden;
  $('#show-shortcuts').setAttribute('aria-expanded', String(!shortcutHelp.hidden));
});
document.addEventListener('pointerdown', (event) => {
  if (!event.target.closest('.viewport-info')) {
    shortcutHelp.hidden = true;
    $('#show-shortcuts').setAttribute('aria-expanded', 'false');
  }
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    shortcutHelp.hidden = true;
    $('#show-shortcuts').setAttribute('aria-expanded', 'false');
  }
});

viewport = new RoomViewport($('#viewport'), {
  onSelect(objectId) {
    updateSelection(objectId);
    renderInspector();
  },
  onTransform: handleTransform,
  onDragChange(dragging) {
    isDragging = dragging;
    if (dragging) {
      dragSnapshot = currentSnapshot();
    } else if (dragSnapshot) {
      if (JSON.stringify(dragSnapshot) !== JSON.stringify(currentSnapshot())) history.record(dragSnapshot);
      dragSnapshot = null;
    }
  },
});
viewport.setScene(roomScene, selectedId);
renderInspector();
fieldController = new RoomFieldController({
  worker: new Worker(new URL('./simulation/room-field-worker.js', import.meta.url), { type: 'module' }),
  viewport,
  onState: renderFieldState,
});
fieldController.setScene(roomScene);
window.addEventListener('pagehide', () => {
  fieldController.dispose();
  viewport.dispose();
}, { once: true });
