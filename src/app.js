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
  setWindowWall,
} from './model/room-scene.js';
import { UndoHistory } from './model/undo-history.js';
import { RoomFieldController } from './simulation/room-field-controller.js';
import { temperatureDisplayRange } from './simulation/room-field-display.js';
import {
  createEditorState,
  selectObject as selectEditorObject,
  setTransformMode as setEditorTransformMode,
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
const outdoorTemperatureInput = $('#outdoor-temperature');
const objectList = $('#object-list');
const properties = $('#object-properties');
const fieldControls = {
  airflow: $('#show-airflow'),
  temperature: $('#show-temperature'),
  light: $('#show-light'),
  display: $('#field-display-controls'),
  displayButtons: [...document.querySelectorAll('[data-display-style]')],
  sliceControl: $('#slice-height-control'),
  sliceHeight: $('#slice-height'),
  sliceValue: $('#slice-height-value'),
  editorStatus: $('#editor-status'),
  status: $('#field-status'),
  legend: $('#field-legend'),
  legendTitle: $('#field-legend-title'),
  gradient: $('#field-gradient'),
  legendMin: $('#field-legend-min'),
  legendMax: $('#field-legend-max'),
};
const timeControls = {
  group: $('#time-controls'),
  clock: $('#clock-label'),
  slider: $('#time-of-day'),
  lamps: $('#lamps-toggle'),
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

function setEditorStatus(message = '') {
  fieldControls.editorStatus.textContent = message;
}

function updateScene(scene, { record = !isDragging } = {}) {
  if (JSON.stringify(scene) === JSON.stringify(roomScene)) return;
  if (record) recordHistory();
  roomScene = scene;
  editorState = { ...editorState, scene };
  fieldController?.setScene(scene);
}

function renderTimeOfDay() {
  const state = viewport?.daylightState;
  if (!state) return;
  timeControls.clock.textContent = state.clock;
  timeControls.clock.title = state.sun.altitude > 0
    ? `Sun ${state.sun.altitude.toFixed(0)}° up, bearing ${Math.round(state.sun.azimuth)}°. ${state.site.name}.`
    : `Sun below the horizon. ${state.site.name}.`;
  // The button is a lamp switch, so it reads as on whenever the lamps are lit,
  // whether dusk turned them on or the user did. Only the explanation differs.
  setPressed(timeControls.lamps, state.lampsOn);
  timeControls.lamps.setAttribute('aria-label', state.lampsOn ? 'Switch the lamps off' : 'Switch the lamps on');
  const manual = viewport.lampsOverride !== null;
  timeControls.lamps.title = state.lampsOn
    ? `Lamps on${manual ? ', set by hand' : ', following dusk'}. Click to switch them off.`
    : `Lamps off${manual ? ', set by hand' : ''}. Click to switch them on.`;
}

timeControls.slider.addEventListener('input', () => {
  viewport.setTimeOfDay({ timeMinutes: Number(timeControls.slider.value) });
  renderTimeOfDay();
});
timeControls.lamps.addEventListener('click', () => {
  // A plain on/off switch. It flips whatever the lamps are doing now, so it can
  // switch them off at night as well as on during the day; the dusk threshold
  // only decides the state until the first click.
  const next = !(viewport?.daylightState?.lampsOn ?? false);
  viewport.setTimeOfDay({ lampsOverride: next });
  renderTimeOfDay();
});

function renderFieldState({ mode, loading, result, error, stale }) {
  const viewportElement = $('#viewport');
  const displayStyle = fieldController?.displayStyle;
  for (const [name, button] of Object.entries({
    airflow: fieldControls.airflow,
    temperature: fieldControls.temperature,
    light: fieldControls.light,
  })) setPressed(button, mode === name);
  fieldControls.display.hidden = !mode;
  const availableStyles = {
    airflow: ['gas', 'volume', 'slice'],
    temperature: ['surfaces', 'volume', 'slice'],
    light: ['preview', 'map'],
  }[mode] ?? [];
  const styleLabels = { gas: 'Gas', volume: mode === 'airflow' ? 'Speed volume' : 'Volume', slice: 'Slice', surfaces: 'Surfaces', preview: 'Preview', map: 'Irradiance' };
  for (const button of fieldControls.displayButtons) {
    const style = button.dataset.displayStyle;
    button.hidden = !availableStyles.includes(style);
    button.textContent = styleLabels[style] ?? style;
    button.setAttribute('aria-pressed', String(style === displayStyle));
  }
  const showSlice = (mode === 'airflow' || mode === 'temperature') && displayStyle === 'slice';
  fieldControls.sliceControl.hidden = !showSlice;
  if (fieldController?.scene) {
    fieldControls.sliceHeight.max = String(fieldController.scene.room.height);
    fieldControls.sliceHeight.value = String(fieldController.sliceHeight);
    fieldControls.sliceValue.textContent = `${fieldController.sliceHeight.toFixed(2)} m`;
  }
  viewportElement.classList.toggle('field-active', Boolean(mode));
  viewportElement.setAttribute('aria-busy', String(loading));
  fieldControls.legend.hidden = !mode || (!result && !(mode === 'light' && displayStyle === 'preview'));
  fieldControls.status.textContent = loading ? (mode === 'light' ? 'Estimating…' : 'Solving…') : error ? 'Unavailable' : stale ? 'Out of date · updating' : '';
  fieldControls.status.title = error?.message ?? '';
  const showDaylightControls = mode === 'light' && displayStyle === 'preview';
  timeControls.group.hidden = !showDaylightControls;
  if (showDaylightControls) {
    renderTimeOfDay();
    // The active mode is already named by the pressed button and the clock
    // reports the time, so there is nothing worth saying here. Keep the
    // transient states, which are the only part that carries new information.
    fieldControls.status.textContent = loading ? 'Preparing…' : error ? 'Unavailable' : stale ? 'Out of date · updating' : '';
    fieldControls.status.title = error?.message ?? '';
    fieldControls.gradient.dataset.mode = 'light';
    fieldControls.legendTitle.textContent = 'Lighting · shadow preview';
    fieldControls.legendMin.textContent = 'shadow';
    fieldControls.legendMax.textContent = 'lit';
    return;
  }
  if (!result) return;

  fieldControls.gradient.dataset.mode = mode;
  let legend;
  if (mode === 'airflow') {
    legend = {
      title: displayStyle === 'volume' ? 'Air speed · 3D volume' : displayStyle === 'slice' ? 'Air speed · horizontal slice' : 'Airflow · moving gas',
      minimum: '0 m/s',
      maximum: `${(result.stats.maxSpeed ?? 1.2).toFixed(2)} m/s`,
    };
  } else if (mode === 'temperature') {
    const { minimum, maximum } = temperatureDisplayRange(result);
    legend = {
      title: displayStyle === 'volume' ? 'Air temperature · 3D volume' : displayStyle === 'slice' ? `Air temperature · ${fieldController.sliceHeight.toFixed(2)} m slice` : 'Air temperature · surfaces and objects',
      minimum: `${minimum.toFixed(1)} °C`,
      maximum: `${maximum.toFixed(1)} °C`,
    };
  } else if (displayStyle === 'map') {
    legend = {
      title: 'Estimated relative illumination',
      minimum: `${result.ambientLevel.toFixed(2)} normalized`,
      maximum: `${result.stats.maxLevel.toFixed(2)} normalized`,
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

function setProjection(projection) {
  viewport.setProjection(projection);
  const orthographic = viewport.projection === 'orthographic';
  const button = $('#toggle-projection');
  button.dataset.projection = viewport.projection;
  button.setAttribute('aria-pressed', String(orthographic));
}

function setTransformMode(mode) {
  transformMode = mode;
  editorState = setEditorTransformMode(editorState, mode);
  viewport.setMode(mode);
  const rotating = mode === 'rotate';
  const button = $('#transform-mode-toggle');
  button.dataset.mode = mode;
  button.setAttribute('aria-pressed', String(rotating));
  button.setAttribute('aria-label', rotating ? 'Rotate mode' : 'Move mode');
  button.title = `${rotating ? 'Rotate' : 'Move'} mode (${rotating ? 'R' : 'G'}); click to switch`;
}

function undo() {
  const snapshot = history.undo(currentSnapshot());
  if (snapshot) restoreSnapshot(snapshot);
}

function redo() {
  const snapshot = history.redo(currentSnapshot());
  if (snapshot) restoreSnapshot(snapshot);
}

function syncRoomInputs() {
  for (const [dimension, input] of Object.entries(roomInputs)) input.value = roomScene.room[dimension];
  outdoorTemperatureInput.value = roomScene.room.outdoorTemperature ?? 10;
}

function renderObjectList() {
  objectList.innerHTML = roomScene.objects.map((object) => {
    return `
      <button class="object-row ${object.id === selectedId ? 'selected' : ''}" type="button" data-select-object="${escapeHtml(object.id)}" aria-pressed="${object.id === selectedId}">
        <span class="object-row-icon" aria-hidden="true">${escapeHtml((MODEL_PRESETS[object.model] ?? MODEL_PRESETS.box).icon)}</span>
        <span class="object-row-name">${escapeHtml(object.name)}</span>
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
  const sourceLabels = { fan: 'Fan strength · relative', heater: 'Heater output · relative', lamp: 'Lamp brightness · relative' };
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
        <label class="property-field"><span>Wall</span><select class="property-input" data-window-wall aria-label="Window wall">
          <option value="back">Back</option><option value="front">Front</option><option value="left">Left</option><option value="right">Right</option>
        </select></label>
        <label class="window-open-toggle"><input type="checkbox" data-window-open aria-label="Window open" ${object.open ? 'checked' : ''} /><span>${object.open ? 'Open · airflow active' : 'Closed'}</span></label>
        <label class="property-field"><span>Window pressure</span><select class="property-input" data-window-flow-direction aria-label="Window exterior pressure direction">
          <option value="exchange">Stack exchange · two-way</option><option value="inlet">Positive pressure · intake bias</option><option value="outlet">Negative pressure · exhaust bias</option>
        </select></label>
        <div class="property-group">
          <div class="range-heading"><span>Outside wind</span><output data-range-output>${(object.flowRate ?? 0.35).toFixed(2)} m/s</output></div>
          <input class="property-slider" type="range" min="0" max="1.5" step="0.05" value="${object.flowRate ?? 0.35}" data-window-flow-rate aria-label="Exterior wind speed in meters per second" />
        </div>
      ` : `<label class="property-field"><span>Model</span><select class="property-input" data-object-model aria-label="Box model">${modelOptions}</select></label>`}
      <div class="property-group">
        <div class="property-label">Position · m</div>
        <div class="property-fields">
          ${propertyField('x', 'x', object.position.x, 'position', { min: 0, max: roomScene.room.width })}
          ${propertyField('y', 'y', object.position.y, 'position', { min: 0, max: roomScene.room.height })}
          ${propertyField('z', 'z', object.position.z, 'position', { min: 0, max: roomScene.room.depth })}
        </div>
      </div>
      ${sourceLabel ? `<div class="property-group">
        ${object.model === 'fan' ? `<label class="window-open-toggle"><input type="checkbox" data-fan-enabled ${object.enabled !== false ? 'checked' : ''} /><span>${object.enabled !== false ? 'Fan running' : 'Fan off'}</span></label>` : ''}
        <div class="range-heading"><span>${sourceLabel}</span><output data-range-output>${intensity.toFixed(2)}×</output></div>
        <input class="property-slider" type="range" min="0" max="2" step="0.05" value="${intensity}" data-source-intensity aria-label="${sourceLabel}" />
      </div>` : ''}
      <div class="property-group">
        <div class="property-label">Size · m</div>
        <div class="property-fields">
          ${propertyField('w', 'width', object.dimensions.width, 'dimension', isWindow ? { min: 0.4, max: maxWindowWidth } : dimensionLimits.width)}
          ${propertyField('h', 'height', object.dimensions.height, 'dimension', isWindow ? { min: 0.4, max: roomScene.room.height - 0.2 } : dimensionLimits.height)}
          ${isWindow ? '' : propertyField('d', 'depth', object.dimensions.depth, 'dimension', dimensionLimits.depth)}
        </div>
      </div>
      ${isWindow ? '' : `<div class="property-group">
        <div class="property-label">Rotation · °</div>
        <div class="property-fields rotation-fields">
          ${propertyField('x', 'x', object.rotation.x, 'rotation', { min: -180, max: 180 })}
          ${propertyField('y', 'y', object.rotation.y, 'rotation', { min: -180, max: 180 })}
          ${propertyField('z', 'z', object.rotation.z, 'rotation', { min: -180, max: 180 })}
        </div>
      </div>`}
      ${isWindow ? '<div class="properties-note">Drag the window toward a wall to snap it into place.</div>' : ''}
    </div>
  `;
  properties.querySelector('[data-object-name]').value = object.name;
  if (isWindow) {
    properties.querySelector('[data-window-wall]').value = object.wall ?? 'back';
    properties.querySelector('[data-window-flow-direction]').value = object.flowDirection ?? 'exchange';
  }
  else properties.querySelector('[data-object-model]').value = object.model;
}

function renderInspector() {
  syncRoomInputs();
  renderObjectList();
  renderProperties();
}

function handleTransform(objectId, position, rotation) {
  const result = transformMode === 'rotate'
    ? rotateObject(roomScene, objectId, rotation)
    : moveObject(roomScene, objectId, position);
  updateScene(result.scene, { record: false });
  syncRoomInputs();
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
  try {
    const result = addObject(roomScene);
    updateScene(result.scene);
    updateSelection(result.object.id);
    setEditorStatus('');
    refreshScene();
  } catch (error) {
    setEditorStatus(error.message);
  }
}

function addRoomWindow() {
  try {
    const result = addWindow(roomScene);
    updateScene(result.scene);
    updateSelection(result.object.id);
    setEditorStatus('');
    refreshScene();
  } catch (error) {
    setEditorStatus(error.message);
  }
}

function toggleFieldMode(mode) {
  fieldController.setMode(fieldController.mode === mode ? null : mode);
}

$('#add-box').addEventListener('click', addBox);
$('#add-window').addEventListener('click', addRoomWindow);
fieldControls.airflow.addEventListener('click', () => toggleFieldMode('airflow'));
fieldControls.temperature.addEventListener('click', () => toggleFieldMode('temperature'));
fieldControls.light.addEventListener('click', () => toggleFieldMode('light'));
fieldControls.display.addEventListener('click', (event) => {
  const button = event.target.closest('[data-display-style]');
  if (button && !button.hidden) fieldController.setDisplayStyle(button.dataset.displayStyle);
});
fieldControls.sliceHeight.addEventListener('input', () => fieldController.setSliceHeight(Number(fieldControls.sliceHeight.value)));

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
    } catch (error) {
      input.value = roomScene.room[dimension];
      input.setCustomValidity('Enter a room dimension within the allowed range.');
      input.reportValidity();
      input.setCustomValidity('');
      setEditorStatus(error.message);
    }
  });
}

outdoorTemperatureInput.addEventListener('change', () => {
  const temperature = Number(outdoorTemperatureInput.value);
  if (outdoorTemperatureInput.value.trim() === '' || !Number.isFinite(temperature) || temperature < -20 || temperature > 50) {
    outdoorTemperatureInput.value = roomScene.room.outdoorTemperature ?? 10;
    outdoorTemperatureInput.setCustomValidity('Enter an outdoor temperature from -20 °C to 50 °C.');
    outdoorTemperatureInput.reportValidity();
    outdoorTemperatureInput.setCustomValidity('');
    return;
  }
  updateScene({ ...roomScene, room: { ...roomScene.room, outdoorTemperature: temperature } });
  setEditorStatus('');
});

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
  } catch (error) {
    setEditorStatus(error.message);
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
    : `${Number(input.value).toFixed(2)}×`;
});

$('#delete-object').addEventListener('click', () => {
  if (!selectedId) return;
  updateScene(removeObject(roomScene, selectedId));
  updateSelection(null);
  refreshScene();
});

$('#transform-mode-toggle').addEventListener('click', () => {
  setTransformMode(transformMode === 'translate' ? 'rotate' : 'translate');
});

$('#toggle-projection').addEventListener('click', () => {
  setProjection(viewport.projection === 'perspective' ? 'orthographic' : 'perspective');
});
const cameraViewPicker = $('#camera-view-picker');
const cameraViewPickerButton = $('#camera-view-picker-button');
function setCameraViewSelection(view) {
  for (const item of cameraViewPicker.querySelectorAll('[data-camera-view]')) {
    item.setAttribute('aria-checked', String(item.dataset.cameraView === view));
  }
}
cameraViewPicker.addEventListener('toggle', () => {
  cameraViewPickerButton.setAttribute('aria-expanded', String(cameraViewPicker.open));
});
cameraViewPicker.addEventListener('click', (event) => {
  const option = event.target.closest('[data-camera-view]');
  if (!option) return;
  if (option.dataset.cameraView === 'top') viewport.snapToTop();
  else viewport.fitRoom();
  setCameraViewSelection(option.dataset.cameraView);
  cameraViewPicker.open = false;
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
  if (key === 'g') setTransformMode('translate');
  if (key === 'r') setTransformMode('rotate');
  if (key === 'o') $('#toggle-projection').click();
  if ((event.key === 'Delete' || event.key === 'Backspace') && selectedId) $('#delete-object').click();
});

const shortcutHelp = $('#shortcut-help');
const shortcutButton = $('#show-shortcuts');
const viewportInfo = $('.viewport-info');
function setShortcutHelpOpen(open) {
  shortcutHelp.hidden = !open;
  shortcutButton.setAttribute('aria-expanded', String(open));
}
viewportInfo.addEventListener('pointerenter', () => setShortcutHelpOpen(true));
viewportInfo.addEventListener('pointerleave', () => {
  if (!viewportInfo.contains(document.activeElement)) setShortcutHelpOpen(false);
});
viewportInfo.addEventListener('focusin', () => setShortcutHelpOpen(true));
viewportInfo.addEventListener('focusout', (event) => {
  if (!viewportInfo.contains(event.relatedTarget) && !viewportInfo.matches(':hover')) setShortcutHelpOpen(false);
});
document.addEventListener('pointerdown', (event) => {
  if (!cameraViewPicker.contains(event.target)) cameraViewPicker.open = false;
  if (!viewportInfo.contains(event.target) && !viewportInfo.matches(':hover')) setShortcutHelpOpen(false);
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    cameraViewPicker.open = false;
    setShortcutHelpOpen(false);
  }
});

viewport = new RoomViewport($('#viewport'), {
  onSelect(objectId) {
    updateSelection(objectId);
    renderInspector();
  },
  onTransform: handleTransform,
  onPlacementError: setEditorStatus,
  onDragChange(dragging) {
    isDragging = dragging;
    fieldController?.setInteractionActive(dragging);
    if (dragging) {
      dragSnapshot = currentSnapshot();
    } else if (dragSnapshot) {
      if (JSON.stringify(dragSnapshot) !== JSON.stringify(currentSnapshot())) history.record(dragSnapshot);
      dragSnapshot = null;
    }
  },
  onCameraViewChange: setCameraViewSelection,
});
viewport.setScene(roomScene, selectedId);
setProjection('perspective');
setTransformMode(transformMode);
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
