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
  setObjectIntensity,
  setFanEnabled,
  setWindowFlow,
  setWindowOpen,
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
const roomInputs = {
  width: $('#room-width'),
  depth: $('#room-depth'),
  height: $('#room-height'),
};
const objectList = $('#object-list');
const properties = $('#object-properties');
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
  for (const [name, button] of Object.entries({
    airflow: fieldControls.airflow,
    temperature: fieldControls.temperature,
    light: fieldControls.light,
  })) setPressed(button, mode === name);
  viewportElement.classList.toggle('field-active', Boolean(mode));
  viewportElement.setAttribute('aria-busy', String(loading));
  fieldControls.legend.hidden = !mode || (mode !== 'light' && !result);
  fieldControls.status.textContent = loading ? 'Solving…' : error ? 'Unavailable' : '';
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
  const duration = `${result.durationSeconds.toFixed(1)} s`;
  fieldControls.status.textContent = `${backend} · ${resolution} · ${duration}`;
  const previewNote = result.backend === 'cpu-preview'
    ? ' WebGPU is unavailable, so this lower-resolution CPU preview may miss fine details.'
    : '';
  fieldControls.status.title = `${result.assumptions?.model ?? 'Room field estimate'}. Simulated ${duration}; peak airflow ${result.stats.maxSpeed.toFixed(2)} m/s; peak temperature ${result.stats.maxTemperature.toFixed(1)} °C.${previewNote}`;

  fieldControls.gradient.dataset.mode = mode;
  let legend;
  if (mode === 'airflow') {
    legend = {
      title: 'Airflow · advected gas',
      minimum: '0 m/s',
      maximum: '1.2+ m/s',
    };
  } else if (mode === 'temperature') {
    legend = {
      title: 'Infrared · air temperature estimate',
      minimum: `${(result.ambientTemperature - 4).toFixed(1)} °C`,
      maximum: `${(result.ambientTemperature + 8).toFixed(1)}+ °C`,
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
  objectList.innerHTML = roomScene.objects.map((object) => {
    const model = MODEL_PRESETS[object.model] ?? MODEL_PRESETS.box;
    return `
      <button class="object-row ${object.id === selectedId ? 'selected' : ''}" type="button" data-select-object="${escapeHtml(object.id)}" aria-pressed="${object.id === selectedId}">
        <span class="object-row-icon" aria-hidden="true">${escapeHtml(model.icon)}</span>
        <span class="object-row-name">${escapeHtml(object.name)}</span>
        <span class="object-type">${escapeHtml(model.label)}</span>
      </button>
    `;
  }).join('');
}

function propertyField(label, axis, value, kind, limits = {}) {
  return `<label class="property-field"><span>${label}</span><input class="property-input" type="number" step="0.05" value="${value.toFixed(2)}" data-${kind}="${axis}" aria-label="${kind === 'position' ? 'Position' : 'Dimensions'} ${label}" ${limits.min === undefined ? '' : `min="${limits.min}"`} ${limits.max === undefined ? '' : `max="${limits.max}"`} /></label>`;
}

function renderProperties() {
  const object = selectedObject();
  const isWindow = object?.model === 'window';
  const sourceLabels = { fan: 'Fan output', heater: 'Heat output', lamp: 'Lamp brightness' };
  const sourceLabel = sourceLabels[object?.model];
  const intensity = object?.intensity ?? 1;
  $('#delete-object').disabled = !object;
  if (!object) {
    properties.innerHTML = '<div class="empty-properties">Select an object</div>';
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
      <label class="property-field property-name-field"><span>Name</span><input class="property-input" type="text" maxlength="80" data-object-name aria-label="Object name" /></label>
      ${isWindow ? `
        <label class="window-open-toggle"><input type="checkbox" data-window-open ${object.open ? 'checked' : ''} /><span>${object.open ? 'Open · airflow active' : 'Closed'}</span></label>
        <label class="property-field"><span>Window flow</span><select class="property-input" data-window-flow-direction aria-label="Window airflow direction">
          <option value="exchange">Exchange · in low, out high</option><option value="inlet">Inlet · source</option><option value="outlet">Outlet · sink</option>
        </select></label>
        <div class="property-group">
          <div class="range-heading"><span>Flow speed</span><output data-range-output>${(object.flowRate ?? 0.35).toFixed(2)} m/s</output></div>
          <input class="property-slider" type="range" min="0" max="1.5" step="0.05" value="${object.flowRate ?? 0.35}" data-window-flow-rate aria-label="Window airflow speed in meters per second" />
        </div>
      ` : `<label class="property-field"><span>Model</span><select class="property-input" data-object-model aria-label="Box model">${modelOptions}</select></label>`}
      <div class="property-group">
        <div class="property-label">Position · m</div>
        <div class="property-fields">
          ${propertyField('X', 'x', object.position.x, 'position', { min: 0, max: roomScene.room.width })}
          ${propertyField('Y', 'y', object.position.y, 'position', { min: 0, max: roomScene.room.height })}
          ${propertyField('Z', 'z', object.position.z, 'position', { min: 0, max: roomScene.room.depth })}
        </div>
      </div>
      ${sourceLabel ? `<div class="property-group">
        ${object.model === 'fan' ? `<label class="window-open-toggle"><input type="checkbox" data-fan-enabled ${object.enabled !== false ? 'checked' : ''} /><span>${object.enabled !== false ? 'Fan running' : 'Fan off'}</span></label>` : ''}
        <div class="range-heading"><span>${sourceLabel}</span><output data-range-output>${Math.round(intensity * 100)}%</output></div>
        <input class="property-slider" type="range" min="0" max="2" step="0.05" value="${intensity}" data-source-intensity aria-label="${sourceLabel}" />
      </div>` : ''}
      <div class="property-group">
        <div class="property-label">Size · m</div>
        <div class="property-fields">
          ${propertyField('W', 'width', object.dimensions.width, 'dimension', isWindow ? { min: 0.4, max: maxWindowWidth } : dimensionLimits.width)}
          ${propertyField('H', 'height', object.dimensions.height, 'dimension', isWindow ? { min: 0.4, max: roomScene.room.height - 0.2 } : dimensionLimits.height)}
          ${isWindow ? '' : propertyField('D', 'depth', object.dimensions.depth, 'dimension', dimensionLimits.depth)}
        </div>
      </div>
      ${isWindow ? '' : `<div class="property-group">
        <div class="property-label">Rotation · °</div>
        <div class="property-fields rotation-fields">
          ${propertyField('X', 'x', object.rotation.x, 'rotation', { min: -180, max: 180 })}
          ${propertyField('Y', 'y', object.rotation.y, 'rotation', { min: -180, max: 180 })}
          ${propertyField('Z', 'z', object.rotation.z, 'rotation', { min: -180, max: 180 })}
        </div>
      </div>`}
      <div class="properties-note">${isWindow ? 'Drag the window toward a wall to snap it into place.' : 'Drag the gizmo to move or rotate.'}</div>
    </div>
  `;
  properties.querySelector('[data-object-name]').value = object.name;
  if (isWindow) {
    properties.querySelector('[data-window-flow-direction]').value = object.flowDirection ?? 'exchange';
  }
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
    } else if (input.matches('[data-fan-enabled]')) {
      updateScene(setFanEnabled(roomScene, object.id, input.checked).scene);
    } else if (input.matches('[data-window-flow-direction]')) {
      updateScene(setWindowFlow(roomScene, object.id, input.value, object.flowRate ?? 0.35).scene);
    } else if (input.matches('[data-window-flow-rate]')) {
      updateScene(setWindowFlow(roomScene, object.id, object.flowDirection ?? 'exchange', Number(input.value)).scene);
    } else if (input.matches('[data-source-intensity]')) {
      updateScene(setObjectIntensity(roomScene, object.id, Number(input.value)).scene);
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

properties.addEventListener('input', (event) => {
  const input = event.target;
  if (!input.matches('[data-window-flow-rate], [data-source-intensity]')) return;
  const output = input.closest('.property-group')?.querySelector('[data-range-output]');
  if (!output) return;
  output.textContent = input.matches('[data-window-flow-rate]')
    ? `${Number(input.value).toFixed(2)} m/s`
    : `${Math.round(Number(input.value) * 100)}%`;
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
