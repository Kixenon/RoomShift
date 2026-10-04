import {
  MODEL_PRESETS,
  DEVICE_MODELS,
  addObject,
  addDevice,
  addWindow,
  addDoor,
  moveObject,
  removeObject,
  renameObject,
  resizeObject,
  resizeRoom,
  rotateObject,
  setObjectModel,
  setObjectIntensity,
  setHeaterPower,
  setDeviceEnabled,
  setWindowFlow,
  setWindowOpen,
  setWindowWall,
} from './model/room-scene.js';
import { isOpeningObject } from './model/openings.js';
import { UndoHistory } from './model/undo-history.js';
import { RoomFieldController } from './simulation/room-field-controller.js';
import { readWorkspace, writeWorkspace } from './model/scenarios.js';
import { sampleRoomFields } from './simulation/room-field-analysis.js';
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
  display: $('#field-display-control'),
  displayButton: $('#field-display-button'),
  displayLabel: $('#field-display-label'),
  displayMenu: $('#field-display-menu'),
  sliceControl: $('#slice-height-control'),
  sliceSummary: $('#slice-height-summary'),
  sliceHeight: $('#slice-height'),
  sliceValue: $('#slice-height-value'),
  editorStatus: $('#editor-status'),
  loading: $('#field-loading'),
  legend: $('#field-legend'),
  legendTitle: $('#field-legend-title'),
  gradient: $('#field-gradient'),
  legendMin: $('#field-legend-min'),
  legendMax: $('#field-legend-max'),
};
const timeControls = {
  group: $('#room-daylight-control'),
  clock: $('#clock-label'),
  slider: $('#time-of-day'),
};

let editorState = createEditorState();
const savedWorkspace = readWorkspace(window.localStorage);
let roomScene = savedWorkspace?.scene ?? editorState.scene;
let baseline = savedWorkspace?.baseline ?? null;
let scenarios = savedWorkspace?.scenarios ?? [];
editorState = { ...editorState, scene: roomScene };
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
  persistWorkspace();
}

function renderTimeOfDay() {
  const state = viewport?.daylightState;
  if (!state) return;
  timeControls.slider.value = String(viewport.timeMinutes);
  timeControls.clock.textContent = state.clock;
  timeControls.clock.title = state.sun.altitude > 0
    ? `Sun ${state.sun.altitude.toFixed(0)}° up, bearing ${Math.round(state.sun.azimuth)}°. ${state.site.name}.`
    : `Sun below the horizon. ${state.site.name}.`;
}

timeControls.slider.addEventListener('input', () => {
  viewport.setTimeOfDay({ timeMinutes: Number(timeControls.slider.value) });
  renderTimeOfDay();
});
function renderFieldState({ mode, loading, result, error, stale }) {
  const physical = ['airflow', 'temperature'].includes(mode);
  $('#simulation-settings').hidden = !physical;
  viewport?.setProbe(physical && $('#probe-control').open ? fieldController.probe : null);
  if (physical) {
    $('#simulation-time-value').textContent = `${fieldController.durationSeconds} s`;
    $('#simulation-status').textContent = error ? `Unavailable: ${error.message ?? error}`
      : !result ? 'Calculating…'
      : `${stale ? 'Previous result · ' : ''}Showing ${result.durationSeconds.toFixed(1)} s${loading ? ` · calculating ${fieldController.durationSeconds} s` : ''} · ${result.stats.meanTemperature.toFixed(2)} °C mean${result.stats.boundaryFlowImbalancePercent > 1 ? ` · flow balance error ${result.stats.boundaryFlowImbalancePercent.toFixed(1)}%` : ''}`;
    for (const axis of ['x', 'y', 'z']) $('#probe-' + axis).value = fieldController.probe[axis];
    const point = result && !stale ? sampleRoomFields(result, fieldController.probe) : null;
    $('#probe-reading').textContent = point?.solid ? 'Measurement point is inside an object.' : point ? `${point.speed.toFixed(3)} m/s · ${point.temperature.toFixed(2)} °C` : '—';
    const comparison = !stale && result?.comparison;
    const signed = (value, decimals) => `${value >= 0 ? '+' : ''}${value.toFixed(decimals)}`;
    $('#comparison-reading').textContent = !baseline ? '' : !comparison ? 'Baseline comparison pending…'
      : !comparison.comparable ? comparison.reason
      : comparison.speedDelta === null ? 'Point obstructed in one scenario; choose another point.'
      : `Change at point: ${signed(comparison.speedDelta, 3)} m/s · ${signed(comparison.temperatureDelta, 2)} °C. Room mean: ${signed(comparison.meanTemperatureDelta, 2)} °C.`;
  }
  const viewportElement = $('#viewport');
  const displayStyle = fieldController?.displayStyle;
  for (const [name, button] of Object.entries({
    airflow: fieldControls.airflow,
    temperature: fieldControls.temperature,
    light: fieldControls.light,
  })) setPressed(button, mode === name);
  const availableStyles = {
    airflow: ['volume', 'slice'],
    temperature: ['surfaces', 'volume', 'slice'],
    light: ['preview', 'map'],
  }[mode] ?? [];
  const styleLabels = { volume: 'Volume', slice: 'Slice', surfaces: 'Surfaces', preview: 'Preview', map: 'Lamp map' };
  fieldControls.display.hidden = !mode;
  if (!mode) fieldControls.display.open = false;
  fieldControls.displayButton.setAttribute('aria-label', `Choose ${mode ?? 'field'} view`);
  fieldControls.displayButton.title = displayStyle ? `${styleLabels[displayStyle]} view` : 'Choose view';
  fieldControls.displayButton.setAttribute('aria-expanded', String(fieldControls.display.open));
  fieldControls.displayLabel.textContent = styleLabels[displayStyle] ?? 'View';
  fieldControls.displayMenu.setAttribute('aria-label', `${mode ?? 'Field'} view options`);
  fieldControls.displayMenu.replaceChildren(...availableStyles.map((style) => {
    const option = document.createElement('button');
    option.className = 'field-display-option';
    option.type = 'button';
    option.setAttribute('role', 'menuitemradio');
    option.setAttribute('aria-checked', String(style === displayStyle));
    option.dataset.displayStyle = style;
    option.textContent = styleLabels[style];
    return option;
  }));
  const showSlice = (mode === 'airflow' || mode === 'temperature') && displayStyle === 'slice';
  fieldControls.sliceControl.hidden = !showSlice;
  if (fieldController?.scene) {
    fieldControls.sliceHeight.max = String(fieldController.scene.room.height);
    fieldControls.sliceHeight.value = String(fieldController.sliceHeight);
    fieldControls.sliceValue.textContent = `${fieldController.sliceHeight.toFixed(2)} m`;
    fieldControls.sliceSummary.textContent = `Slice · ${fieldController.sliceHeight.toFixed(2)} m`;
  }
  viewportElement.classList.toggle('field-active', Boolean(mode));
  viewportElement.setAttribute('aria-busy', String(loading));
  fieldControls.loading.hidden = !loading && !error;
  fieldControls.loading.classList.toggle('has-error', Boolean(error));
  fieldControls.loading.title = error?.message ?? '';
  fieldControls.loading.setAttribute('aria-label', error ? `Simulation unavailable: ${error.message}` : 'Updating simulation');
  fieldControls.legend.hidden = !mode || (!result && !(mode === 'light' && displayStyle === 'preview'));
  const showDaylightControls = mode === 'light' && displayStyle === 'preview';
  timeControls.group.hidden = !showDaylightControls;
  if (showDaylightControls) {
    renderTimeOfDay();
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
      title: displayStyle === 'volume' ? 'Airflow speed · 3D volume' : 'Airflow speed · horizontal slice',
      minimum: '0 m/s',
      maximum: '2.50 m/s',
    };
  } else if (mode === 'temperature') {
    const { minimum, maximum } = temperatureDisplayRange(result);
    legend = {
      title: displayStyle === 'volume' ? 'Air temperature · 3D volume' : displayStyle === 'slice' ? `Air temperature · ${fieldController.sliceHeight.toFixed(2)} m slice` : 'Infrared · nearby air temperature',
      minimum: `${minimum.toFixed(1)} °C`,
      maximum: `${maximum.toFixed(1)} °C`,
    };
  } else if (displayStyle === 'map') {
    legend = {
      title: 'Lamp illumination · relative',
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
  $('#initial-temperature').value = roomScene.room.initialTemperature ?? 20;
  $('#envelope-u-value').value = roomScene.room.envelopeUValue ?? 0.7;
  $('#daylight-date').value = roomScene.room.daylightDate ?? '2026-03-21';
  $('#room-heading').value = roomScene.room.headingDegrees ?? 0;
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
  const isOpening = isOpeningObject(object);
  const isDevice = DEVICE_MODELS.includes(object?.model);
  const openingLabel = object?.model === 'door' ? 'Door' : 'Window';
  const sourceLabels = { fan: 'Fan strength · relative', heater: 'Heater output · relative', lamp: 'Lamp brightness · relative' };
  const sourceLabel = sourceLabels[object?.model];
  const intensity = object?.intensity ?? 1;
  $('#delete-object').disabled = !object;
  if (!object) {
    properties.innerHTML = '<div class="empty-properties">Select an object</div>';
    return;
  }

  const maxOpeningWidth = object.wall === 'back' || object.wall === 'front' ? roomScene.room.width - 0.2 : roomScene.room.depth - 0.2;
  const dimensionLimits = {
    width: { min: 0.1, max: roomScene.room.width },
    height: { min: 0.1, max: roomScene.room.height },
    depth: { min: 0.1, max: roomScene.room.depth },
  };
  const modelOptions = Object.entries(MODEL_PRESETS).filter(([key]) => !DEVICE_MODELS.includes(key) && !['window', 'door'].includes(key)).map(([key, model]) => (
    `<option value="${escapeHtml(key)}">${escapeHtml(model.label)}</option>`
  )).join('');
  properties.innerHTML = `
    <div class="properties-form">
      <label class="property-field property-name-field"><span>Name</span><input class="property-input" type="text" maxlength="80" data-object-name aria-label="Object name" /></label>
      ${isOpening ? `
        <label class="property-field"><span>Wall</span><select class="property-input" data-window-wall aria-label="${openingLabel} wall">
          <option value="back">Back</option><option value="front">Front</option><option value="left">Left</option><option value="right">Right</option>
        </select></label>
        <label class="window-open-toggle"><input type="checkbox" data-window-open aria-label="${openingLabel} open" ${object.open ? 'checked' : ''} /><span>Open</span></label>
        <label class="property-field"><span>Exterior pressure</span><select class="property-input" data-window-flow-direction aria-label="Opening exterior pressure direction">
          <option value="exchange">Stack exchange · two-way</option><option value="inlet">Positive pressure · intake bias</option><option value="outlet">Negative pressure · exhaust bias</option>
        </select></label>
        <div class="property-group">
          <div class="range-heading"><span>Wind for intake/exhaust</span><output data-range-output>${(object.flowRate ?? 0.35).toFixed(2)} m/s</output></div>
          <input class="property-slider" type="range" min="0" max="1.5" step="0.05" value="${object.flowRate ?? 0.35}" data-window-flow-rate aria-label="Exterior wind speed in meters per second" />
        </div>
      ` : isDevice ? '' : `<label class="property-field"><span>Type</span><select class="property-input" data-object-model aria-label="Object type">${modelOptions}</select></label>`}
      <div class="property-group">
        <div class="property-label">Position · m</div>
        <div class="property-fields">
          ${propertyField('x', 'x', object.position.x, 'position', { min: 0, max: roomScene.room.width })}
          ${propertyField('y', 'y', object.position.y, 'position', { min: 0, max: roomScene.room.height })}
          ${propertyField('z', 'z', object.position.z, 'position', { min: 0, max: roomScene.room.depth })}
        </div>
      </div>
      ${object.model === 'heater' ? `<label class="property-field"><span>Power · W</span><input class="property-input" data-heater-power type="number" min="0" max="3000" step="50" value="${object.powerWatts ?? 750}" aria-label="Heater power in watts" /></label>` : ''}
      ${sourceLabel ? `<div class="property-group">
        <label class="window-open-toggle"><input type="checkbox" data-device-enabled aria-label="Device on" ${object.enabled !== false ? 'checked' : ''} /><span>On</span></label>
        <div class="range-heading"><span>${sourceLabel}</span><output data-range-output>${intensity.toFixed(2)}×</output></div>
        <input class="property-slider" type="range" min="0" max="2" step="0.05" value="${intensity}" data-source-intensity aria-label="${sourceLabel}" />
      </div>` : ''}
      <div class="property-group">
        <div class="property-label">Size · m</div>
        <div class="property-fields">
          ${propertyField('w', 'width', object.dimensions.width, 'dimension', isOpening ? { min: 0.4, max: maxOpeningWidth } : dimensionLimits.width)}
          ${propertyField('h', 'height', object.dimensions.height, 'dimension', isOpening ? { min: 0.4, max: roomScene.room.height - 0.2 } : dimensionLimits.height)}
          ${isOpening ? '' : propertyField('d', 'depth', object.dimensions.depth, 'dimension', dimensionLimits.depth)}
        </div>
      </div>
      ${isOpening ? '' : `<div class="property-group">
        <div class="property-label">Rotation · °</div>
        <div class="property-fields rotation-fields">
          ${propertyField('x', 'x', object.rotation.x, 'rotation', { min: -180, max: 180 })}
          ${propertyField('y', 'y', object.rotation.y, 'rotation', { min: -180, max: 180 })}
          ${propertyField('z', 'z', object.rotation.z, 'rotation', { min: -180, max: 180 })}
        </div>
      </div>`}
    </div>
  `;
  properties.querySelector('[data-object-name]').value = object.name;
  if (isOpening) {
    properties.querySelector('[data-window-wall]').value = object.wall ?? 'back';
    properties.querySelector('[data-window-flow-direction]').value = object.flowDirection ?? 'exchange';
  }
  else if (!isDevice) properties.querySelector('[data-object-model]').value = object.model;
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
  viewport.setProbe($('#probe-control').open && fieldController?.mode && fieldController.mode !== 'light' ? fieldController.probe : null);
  renderInspector();
  persistWorkspace();
}

function addRoomObject() {
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

function addRoomDevice(model) {
  try {
    const result = addDevice(roomScene, model);
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

function addRoomDoor() {
  try {
    const result = addDoor(roomScene);
    updateScene(result.scene);
    updateSelection(result.object.id);
    setEditorStatus('');
    refreshScene();
  } catch (error) {
    setEditorStatus(error.message);
  }
}

function toggleFieldMode(mode) {
  fieldControls.display.open = false;
  fieldController.setMode(fieldController.mode === mode ? null : mode);
}

$('#add-object').addEventListener('click', addRoomObject);
for (const model of DEVICE_MODELS) {
  $(`#add-${model}`).addEventListener('click', () => addRoomDevice(model));
}
$('#add-window').addEventListener('click', addRoomWindow);
$('#add-door').addEventListener('click', addRoomDoor);
fieldControls.airflow.addEventListener('click', () => toggleFieldMode('airflow'));
fieldControls.temperature.addEventListener('click', () => toggleFieldMode('temperature'));
fieldControls.light.addEventListener('click', () => toggleFieldMode('light'));
fieldControls.displayMenu.addEventListener('click', (event) => {
  const option = event.target.closest('[data-display-style]');
  if (!option) return;
  fieldController.setDisplayStyle(option.dataset.displayStyle);
  fieldControls.display.open = false;
});
fieldControls.display.addEventListener('toggle', () => {
  fieldControls.displayButton.setAttribute('aria-expanded', String(fieldControls.display.open));
});
document.addEventListener('click', (event) => {
  if (!fieldControls.display.contains(event.target)) fieldControls.display.open = false;
});
fieldControls.sliceHeight.addEventListener('input', () => fieldController.setSliceHeight(Number(fieldControls.sliceHeight.value)));

const editorLayout = $('#editor-layout');
const assetRailToggle = $('#toggle-asset-rail');
const inspectorToggle = $('#toggle-inspector');
function togglePanel(button, className, label, collapsedClass) {
  const collapsed = editorLayout.classList.toggle(className);
  button.setAttribute('aria-expanded', String(!collapsed));
  button.setAttribute('aria-label', `${collapsed ? 'Expand' : 'Collapse'} ${label} menu`);
  button.title = `${collapsed ? 'Expand' : 'Collapse'} ${label} menu`;
  button.dataset.collapsed = String(collapsed);
  collapsedClass?.(collapsed);
}
assetRailToggle.addEventListener('click', () => togglePanel(assetRailToggle, 'asset-rail-collapsed', 'asset', (collapsed) => {
  $('#asset-rail').classList.toggle('is-collapsed', collapsed);
}));
inspectorToggle.addEventListener('click', () => togglePanel(inspectorToggle, 'inspector-collapsed', 'properties', (collapsed) => {
  $('.inspector').classList.toggle('is-collapsed', collapsed);
}));

$('.object-list-section').addEventListener('click', (event) => {
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
  $('#initial-temperature').value = roomScene.room.initialTemperature ?? 20;
  $('#envelope-u-value').value = roomScene.room.envelopeUValue ?? 0.7;
  $('#daylight-date').value = roomScene.room.daylightDate ?? '2026-03-21';
  $('#room-heading').value = roomScene.room.headingDegrees ?? 0;
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
    } else if (input.matches('[data-heater-power]')) {
      updateScene(setHeaterPower(roomScene, object.id, Number(input.value)).scene);
    } else if (input.matches('[data-device-enabled]')) {
      updateScene(setDeviceEnabled(roomScene, object.id, input.checked).scene);
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
  if (!$('#scenario-storage').contains(event.target)) $('#scenario-storage').open = false;
  if (!cameraViewPicker.contains(event.target)) cameraViewPicker.open = false;
  if (!viewportInfo.contains(event.target) && !viewportInfo.matches(':hover')) setShortcutHelpOpen(false);
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    $('#scenario-storage').open = false;
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
fieldController.setComparison(baseline);
renderScenarios();
window.addEventListener('pagehide', () => {
  fieldController.dispose();
  viewport.dispose();
}, { once: true });

function persistWorkspace() {
  try { writeWorkspace(window.localStorage, { scene: roomScene, baseline, scenarios }); }
  catch { setEditorStatus('Browser storage unavailable.'); }
}

function renderScenarios() {
  $('#restore-baseline').disabled = !baseline;
  $('#clear-baseline').disabled = !baseline;
  $('#saved-scenarios').innerHTML = '<option value="">Choose saved…</option>' + scenarios.map((scenario, index) => `<option value="${index}">${escapeHtml(scenario.name)}</option>`).join('');
}

$('#simulation-time').addEventListener('input', (event) => {
  fieldController.setSimulationTime(Number(event.target.value));
  $('#simulation-time-value').textContent = `${fieldController.durationSeconds} s`;
});
$('#simulation-resolution').addEventListener('change', (event) => fieldController.setResolution(Number(event.target.value)));
for (const axis of ['x', 'y', 'z']) $('#probe-' + axis).addEventListener('change', () => {
  const point = Object.fromEntries(['x', 'y', 'z'].map((axis) => [axis, Number($('#probe-' + axis).value)]));
  if (!Object.values(point).every(Number.isFinite) || point.x < 0 || point.x > roomScene.room.width || point.y < 0 || point.y > roomScene.room.height || point.z < 0 || point.z > roomScene.room.depth) {
    setEditorStatus('Measurement point must be inside the room.'); return;
  }
  fieldController.setComparison(baseline, point);
  viewport.setProbe($('#probe-control').open ? point : null);
});
for (const id of ['temperature-min', 'temperature-max']) $('#' + id).addEventListener('change', () => {
  const minimum = Number($('#temperature-min').value), maximum = Number($('#temperature-max').value);
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || minimum < -20 || maximum > 60 || minimum >= maximum) { setEditorStatus('Choose a temperature scale between −20 and 60 °C with min below max.'); return; }
  fieldController.setDisplayRanges({ temperature: { minimum, maximum }, speedMaximum: 2.5 });
});
$('#capture-baseline').addEventListener('click', () => {
  baseline = structuredClone(roomScene);
  fieldController.setComparison(baseline);
  renderScenarios(); persistWorkspace();
});
$('#restore-baseline').addEventListener('click', () => {
  if (!baseline) return;
  updateScene(structuredClone(baseline)); updateSelection(null); refreshScene();
});
$('#clear-baseline').addEventListener('click', () => {
  baseline = null; fieldController.setComparison(null); renderScenarios(); persistWorkspace();
});
$('#save-scenario').addEventListener('click', () => {
  const name = $('#scenario-name').value.trim();
  if (!name) { setEditorStatus('Name the scenario first.'); return; }
  const existing = scenarios.findIndex((scenario) => scenario.name === name);
  const entry = { name, scene: structuredClone(roomScene) };
  if (existing >= 0) scenarios[existing] = entry;
  else if (scenarios.length < 20) scenarios.push(entry);
  else { setEditorStatus('Delete a saved scenario before adding another.'); return; }
  renderScenarios(); persistWorkspace(); setEditorStatus(`Saved ${name}`);
});
$('#load-scenario').addEventListener('click', () => {
  const value = $('#saved-scenarios').value;
  if (value === '') return;
  const scenario = scenarios[Number(value)];
  updateScene(structuredClone(scenario.scene)); updateSelection(null); refreshScene();
  $('#scenario-name').value = scenario.name;
});
$('#delete-scenario').addEventListener('click', () => {
  const value = $('#saved-scenarios').value;
  if (value === '') return;
  scenarios.splice(Number(value), 1); renderScenarios(); persistWorkspace();
});

for (const [id, property, min, max] of [['initial-temperature', 'initialTemperature', -20, 40], ['envelope-u-value', 'envelopeUValue', 0, 5], ['room-heading', 'headingDegrees', 0, 360]]) {
  $('#' + id).addEventListener('change', (event) => {
    const value = Number(event.target.value);
    if (!Number.isFinite(value) || value < min || value > max) { setEditorStatus(`Value must be between ${min} and ${max}.`); return; }
    updateScene({ ...roomScene, room: { ...roomScene.room, [property]: value } }); refreshScene();
  });
}

$('#daylight-date').addEventListener('change', (event) => {
  if (!event.target.value || !event.target.validity.valid) return;
  updateScene({ ...roomScene, room: { ...roomScene.room, daylightDate: event.target.value } }); refreshScene();
});

$('#probe-control').addEventListener('toggle', () => {
  viewport.setProbe($('#probe-control').open && ['airflow', 'temperature'].includes(fieldController.mode) ? fieldController.probe : null);
});
$('#scenario-storage').addEventListener('toggle', () => {
  $('#scenario-storage summary').setAttribute('aria-expanded', String($('#scenario-storage').open));
});
$('#reset-room').addEventListener('click', () => {
  updateScene(createEditorState().scene); updateSelection(null); refreshScene();
  $('#scenario-storage').open = false;
});

$('#scenario-storage').addEventListener('click', (event) => {
  if (event.target.closest('button:not(:disabled)')) $('#scenario-storage').open = false;
});
