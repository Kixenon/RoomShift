import {
  INTENSITY,
  MODEL_PRESETS,
  ROOM_SHAPES,
  addObject,
  addWindow,
  duplicateObject,
  isWallItem,
  moveObject,
  objectMaterial,
  objectProps,
  removeObject,
  renameObject,
  resizeObject,
  resizeRoom,
  roomShape,
  rotateObject,
  setObjectMaterial,
  setObjectModel,
  setObjectProp,
  setRoomShape,
  setSurfaceMaterial,
  setWindowOpen,
  setWindowWall,
} from './model/room-scene.js';
import { MATERIALS, SURFACE_MATERIALS, sceneSurfaces } from './model/materials.js';
import { STYLE_OPTIONS, styleOf } from './scene/furniture-builders.js';
import { WINDOW_COVERINGS, WINDOW_TYPES } from './model/room-scene.js';
import { CATALOG } from './model/catalog.js';
import { UndoHistory } from './model/undo-history.js';
import { RoomFieldController } from './simulation/room-field-controller.js';
import { RoomViewport } from './scene/room-viewport.js';
import { createRoomPhotoPanel } from './scene/room-photo-panel.js';
import { analyseSilhouette, classifyFurniture, detectFurniture, loadDetector, placementsFromDetections, shapeFromSilhouette } from './scene/photo-furniture.js';
import {
  TEMPLATES, createProject, deleteProject, duplicateProject, exportProjectFile, getProject, importProjectFile, listProjects, saveProject,
} from './model/projects.js';
import { CITIES, compassLabel, environmentOf, fetchWeather, formatHour, sunlitWalls, ventilation, wallBearings, windwardWall } from './model/environment.js';
import { evaluateLayout, suggestLayout } from './model/layout-advisor.js';
import {
  LIGHT_BANDS, SOUND_BANDS, WIFI_BANDS, bandFor, computePlaneField, computeVolumeField, lightContext, luxAt, profileAlong, roomAcoustics, sampleListeningSpots, soundAt, wifiAt,
} from './simulation/room-propagation.js';

// ─── Helpers ──────────────────────────────────────────────────────────────
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
const mod = isMac ? '⌘' : 'Ctrl ';
const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
const fmt = (value, digits = 0) => Number(value).toFixed(digits);

const LENSES = { airflow: 'Air', temperature: 'Heat', light: 'Light', wifi: 'WiFi', sound: 'Sound' };
const SOLVER_LENSES = new Set(['airflow', 'temperature']);
const VOLUME_LENSES = new Set(['wifi', 'sound']);
const CATEGORY_LABELS = { furniture: 'Furniture', desk: 'On the desk', appliance: 'Appliances', climate: 'Climate', light: 'Lights', signal: 'WiFi & sound', opening: 'Doors & windows', basic: 'Basic' };
const DOCK_TABS = [...Object.keys(CATEGORY_LABELS), 'catalog', 'photo'];
const SWATCHES = ['#e8e4dc', '#b9a58a', '#8a6a4b', '#3e3a36', '#7d8b96', '#5f7f6a', '#2f4f6f', '#b5524a', '#d8a24a'];
const SIZE_PRESETS = {
  bed: [['Single', { width: 0.9, depth: 2.0 }], ['Double', { width: 1.4, depth: 1.9 }], ['Queen', { width: 1.5, depth: 2.0 }], ['King', { width: 1.8, depth: 2.0 }]],
  sofa: [['Armchair', { width: 0.85, depth: 0.85 }], ['2-seat', { width: 1.5, depth: 0.85 }], ['3-seat', { width: 2.0, depth: 0.9 }]],
  desk: [['Compact', { width: 1.0, depth: 0.5 }], ['Standard', { width: 1.2, depth: 0.6 }], ['Large', { width: 1.6, depth: 0.8 }]],
  table: [['Coffee', { width: 0.9, depth: 0.5, height: 0.4 }], ['Dining 4', { width: 1.2, depth: 0.8, height: 0.75 }], ['Dining 6', { width: 1.8, depth: 0.9, height: 0.75 }]],
  wardrobe: [['1 door', { width: 0.5 }], ['2 doors', { width: 1.0 }], ['3 doors', { width: 1.5 }]],
  tv: [['43″', { width: 0.97, height: 0.56 }], ['55″', { width: 1.23, height: 0.71 }], ['65″', { width: 1.45, height: 0.83 }]],
  fridge: [['Under-counter', { width: 0.6, depth: 0.6, height: 0.85 }], ['Standard', { width: 0.6, depth: 0.65, height: 1.75 }], ['Side-by-side', { width: 0.9, depth: 0.7, height: 1.8 }]],
  window: [['Narrow', { width: 0.8 }], ['Standard', { width: 1.4 }], ['Wide', { width: 2.2 }]],
};
// Parts that take the second colour (legs, frames, handles).
const SECOND_COLOUR = { table: 'Legs', desk: 'Base', sofa: 'Feet', chair: 'Legs', bed: 'Frame', wardrobe: 'Handles', shelf: 'Back', lamp: 'Stand', tv: 'Stand', fridge: 'Handles', fan: 'Stand' };
const STACKABLE = new Set(['deskLamp', 'router', 'speaker', 'tv', 'plant', 'lamp', 'box', 'monitor', 'laptop', 'bottle', 'books']);
const SURFACES = new Set(['desk', 'table', 'shelf', 'wardrobe', 'fridge']);
const SHAPE_ICONS = {
  rect: '<path d="M4 4h32v22H4z"/>',
  L: '<path d="M4 4h32v10H22v12H4z"/>',
  rounded: '<path d="M12 4h16a8 8 0 0 1 8 8v6a8 8 0 0 1-8 8H12a8 8 0 0 1-8-8v-6a8 8 0 0 1 8-8z"/>',
};

// ─── State ────────────────────────────────────────────────────────────────
let project = null;
let roomScene = null;
let selectedId = null;
let transformMode = 'translate';
let lens = null;
let fieldResult = null;
let planeField = null;
let volumeField = null;
let viewport = null;
let fieldController = null;
let history = new UndoHistory();
let isDragging = false;
let dragSnapshot = null;
let saveTimer = null;
let lastThumbnailAt = 0;
let layoutReport = null;
let weather = null;
let dockTab = 'furniture';
let filesView = 'rooms';
let filesLayout = 'list';
const filesSelection = new Set();
let lastClickedFile = null;

// Shared with feature modules (variants, report, scan import, AR export).
export const app = {
  get project() { return project; },
  get scene() { return roomScene; },
  get viewport() { return viewport; },
  get weather() { return weather; },
  get layoutReport() { return layoutReport; },
  apply: (result, options) => apply(result, options),
  setProject: (patch) => { project = { ...project, ...patch }; scheduleSave(); },
  toast: (...args) => toast(...args),
  addPaletteCommands: (provider) => paletteProviders.push(provider),
  addDockItems: (provider) => dockProviders.push(provider),
  addFileMenuItems: (items) => fileMenuItems.push(...items),
  undo: () => undo(),
  renderAll: () => renderAll(),
};
const paletteProviders = [];
const dockProviders = [];
const fileMenuItems = [];

// ─── Theme ────────────────────────────────────────────────────────────────
function themePreference() {
  try { return localStorage.getItem('roomshift.theme') ?? 'system'; } catch { return 'system'; }
}
function resolvedTheme() {
  const preference = themePreference();
  if (preference !== 'system') return preference;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
function applyTheme() {
  const preference = themePreference();
  if (preference === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = preference;
  for (const icon of $$('.theme-icon')) icon.textContent = { system: '◐', light: '☀', dark: '☾' }[preference];
  for (const label of $$('.theme-label')) label.textContent = `Theme: ${preference[0].toUpperCase()}${preference.slice(1)}`;
  viewport?.setTheme(resolvedTheme());
}
function cycleTheme() {
  const next = { system: 'light', light: 'dark', dark: 'system' }[themePreference()];
  try { localStorage.setItem('roomshift.theme', next); } catch { /* private mode */ }
  applyTheme();
  toast(`Theme: ${next}`);
}
window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);

// ─── Toasts ───────────────────────────────────────────────────────────────
function toast(message, { action, onAction, tone = 'info', timeout = 3200 } = {}) {
  const element = document.createElement('div');
  element.className = `toast ${tone}`;
  element.innerHTML = `<span>${escapeHtml(message)}</span>${action ? `<button type="button">${escapeHtml(action)}</button>` : ''}`;
  if (action) element.querySelector('button').addEventListener('click', () => { onAction?.(); element.remove(); });
  $('#toasts').append(element);
  const live = $$('#toasts .toast:not(.leaving)');
  for (const old of live.slice(0, Math.max(0, live.length - 3))) old.remove();
  setTimeout(() => {
    element.classList.add('leaving');
    setTimeout(() => element.remove(), 250);
  }, timeout);
}

// ─── Menus ────────────────────────────────────────────────────────────────
function closeMenus(except) {
  for (const menu of $$('.menu')) if (menu !== except) menu.hidden = true;
}
function toggleMenu(menu) {
  const open = menu.hidden;
  closeMenus();
  menu.hidden = !open;
}
document.addEventListener('pointerdown', (event) => {
  if (!event.target.closest('.menu, [data-action="file-menu"], [data-action="new-menu"]')) closeMenus();
});

// ─── Routing ──────────────────────────────────────────────────────────────
function replaceHash(hash) { window.history.replaceState(null, '', hash); }

function route() {
  const match = (location.hash || '#/').match(/^#\/p\/(.+)$/);
  if (!match) {
    closeEditor();
    renderFiles();
    return;
  }
  let id = decodeURIComponent(match[1]);
  if (id === 'demo') {
    const demo = listProjects().find((item) => item.name === 'Demo living room') ?? createProject({ name: 'Demo living room', templateId: 'living' });
    id = demo.id;
    replaceHash(`#/p/${id}`);
  }
  const found = getProject(id);
  if (!found) {
    toast('That room no longer exists.', { tone: 'warn' });
    location.hash = '#/';
    return;
  }
  openEditor(found);
}

// ═══ Files page ═══════════════════════════════════════════════════════════
function relativeTime(timestamp) {
  const seconds = Math.round((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} h ago`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
const templateGlyph = (id) => ({ living: '▰', hall: '⌂', studio: '◫', office: '▤', empty: '□' })[id] ?? '□';

function visibleProjects() {
  const query = $('#files-search').value.trim().toLowerCase();
  const sort = $('#files-sort').value;
  const items = listProjects().filter((item) => !query || item.name.toLowerCase().includes(query));
  if (sort === 'name') items.sort((a, b) => a.name.localeCompare(b.name));
  else if (sort === 'area') items.sort((a, b) => b.scene.room.width * b.scene.room.depth - a.scene.room.width * a.scene.room.depth);
  return items;
}

function renderFiles() {
  $('#files').hidden = false;
  $('#editor').hidden = true;
  document.title = 'RoomShift';
  for (const item of $$('[data-files-view]')) item.classList.toggle('active', item.dataset.filesView === filesView);
  for (const item of $$('[data-files-layout]')) item.classList.toggle('active', item.dataset.filesLayout === filesLayout);
  $('#files-rooms').hidden = filesView !== 'rooms';
  $('#files-templates').hidden = filesView !== 'templates';
  renderNewMenu();
  if (filesView === 'templates') {
    $('#files-templates').innerHTML = `<h2 class="files-heading">Start from a template</h2><div class="template-grid">${TEMPLATES.map((template) => `
      <button class="template-card" type="button" data-template="${template.id}"><span class="glyph">${templateGlyph(template.id)}</span><strong>${escapeHtml(template.label)}</strong><span>${escapeHtml(template.description)}</span></button>`).join('')}</div>`;
    renderSelectionBar();
    return;
  }
  const items = visibleProjects();
  const ids = new Set(items.map((item) => item.id));
  for (const id of filesSelection) if (!ids.has(id)) filesSelection.delete(id);
  if (!items.length) {
    $('#files-rooms').innerHTML = `<div class="empty-files"><strong>${$('#files-search').value ? 'No rooms match' : 'No rooms yet'}</strong><span>Create one with <b>New</b>, or pick a template.</span><button class="btn primary" type="button" data-action="open-demo">Open the demo room</button></div>`;
    renderSelectionBar();
    return;
  }
  const meta = (item) => `${fmt(item.scene.room.width, 1)} × ${fmt(item.scene.room.depth, 1)} m`;
  const thumb = (item) => (item.thumbnail ? `style="background-image:url(${item.thumbnail})"` : '');
  if (filesLayout === 'grid') {
    $('#files-rooms').innerHTML = `<h2 class="files-heading">My rooms</h2><div class="room-grid ${filesSelection.size ? 'selecting' : ''}">${items.map((item, index) => `
      <article class="room-card ${filesSelection.has(item.id) ? 'selected' : ''}" data-file="${escapeHtml(item.id)}" style="--i:${index}">
        <input type="checkbox" data-file-check="${escapeHtml(item.id)}" ${filesSelection.has(item.id) ? 'checked' : ''} aria-label="Select ${escapeHtml(item.name)}" />
        <div class="thumb" ${thumb(item)}>${item.thumbnail ? '' : '⌂'}</div>
        <div class="meta"><strong>${escapeHtml(item.name)}</strong><span>${meta(item)} · ${relativeTime(item.updatedAt)}</span></div>
      </article>`).join('')}</div>`;
  } else {
    const all = items.every((item) => filesSelection.has(item.id));
    $('#files-rooms').innerHTML = `<table class="room-table"><thead><tr>
      <th class="check-cell"><input type="checkbox" data-file-check-all ${all ? 'checked' : ''} aria-label="Select all" /></th><th>Name</th><th>Size</th><th>Objects</th><th>Modified</th></tr></thead><tbody>
      ${items.map((item) => `<tr class="row ${filesSelection.has(item.id) ? 'selected' : ''}" data-file="${escapeHtml(item.id)}">
        <td class="check-cell"><input type="checkbox" data-file-check="${escapeHtml(item.id)}" ${filesSelection.has(item.id) ? 'checked' : ''} aria-label="Select ${escapeHtml(item.name)}" /></td>
        <td><div class="room-name"><span class="mini-thumb" ${thumb(item)}>${item.thumbnail ? '' : '⌂'}</span><a href="#/p/${encodeURIComponent(item.id)}">${escapeHtml(item.name)}</a></div></td>
        <td class="mono">${meta(item)}</td><td class="mono">${item.scene.objects.length}</td><td>${relativeTime(item.updatedAt)}</td></tr>`).join('')}
      </tbody></table>`;
  }
  renderSelectionBar();
}

function renderSelectionBar() {
  $('#selection-bar').hidden = !filesSelection.size || filesView !== 'rooms';
  $('#selection-count').textContent = `${filesSelection.size} selected`;
}

function renderNewMenu() {
  $('#new-menu').innerHTML = `<div class="menu-label">New room</div>${TEMPLATES.map((template) => `
    <button type="button" class="tpl" data-template="${template.id}"><span>${templateGlyph(template.id)} ${escapeHtml(template.label)}</span><small>${escapeHtml(template.description)}</small></button>`).join('')}
    <hr /><button type="button" data-action="import-project">Upload room file…</button>`;
}

function toggleFile(id, { range = false } = {}) {
  if (range && lastClickedFile) {
    const ids = visibleProjects().map((item) => item.id);
    const [a, b] = [ids.indexOf(lastClickedFile), ids.indexOf(id)].sort((x, y) => x - y);
    for (const item of ids.slice(a, b + 1)) filesSelection.add(item);
  } else if (filesSelection.has(id)) filesSelection.delete(id);
  else filesSelection.add(id);
  lastClickedFile = id;
  renderFiles();
}

$('#files').addEventListener('click', (event) => {
  const template = event.target.closest('[data-template]');
  if (template) {
    const created = createProject({ templateId: template.dataset.template });
    location.hash = `#/p/${created.id}`;
    return;
  }
  const view = event.target.closest('[data-files-view]');
  if (view) { filesView = view.dataset.filesView; filesSelection.clear(); renderFiles(); return; }
  const layout = event.target.closest('[data-files-layout]');
  if (layout) { filesLayout = layout.dataset.filesLayout; renderFiles(); return; }
  const all = event.target.closest('[data-file-check-all]');
  if (all) {
    if (all.checked) for (const item of visibleProjects()) filesSelection.add(item.id);
    else filesSelection.clear();
    renderFiles();
    return;
  }
  const check = event.target.closest('[data-file-check]');
  if (check) { toggleFile(check.dataset.fileCheck, { range: event.shiftKey }); return; }
  if (event.target.closest('a')) return;
  const row = event.target.closest('[data-file]');
  if (!row) return;
  // Like OneDrive: with a selection active, clicks extend it; otherwise open.
  if (filesSelection.size || event.shiftKey || event.metaKey || event.ctrlKey) toggleFile(row.dataset.file, { range: event.shiftKey });
  else location.hash = `#/p/${row.dataset.file}`;
});
$('#files-search').addEventListener('input', renderFiles);
$('#files-sort').addEventListener('change', renderFiles);

function deleteSelectedFiles() {
  const backups = [...filesSelection].map(getProject).filter(Boolean);
  for (const item of backups) deleteProject(item.id);
  filesSelection.clear();
  renderFiles();
  toast(`Deleted ${backups.length} room${backups.length === 1 ? '' : 's'}`, {
    action: 'Undo', timeout: 7000,
    onAction: () => { for (const item of backups) saveProject(item); renderFiles(); },
  });
}
function downloadBlob(blob, filename) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1500);
}
app.downloadBlob = downloadBlob;
const fileSlug = (name) => name.replace(/[^\w-]+/g, '-').toLowerCase() || 'room';
app.fileSlug = fileSlug;
function downloadFile(item) {
  downloadBlob(new Blob([exportProjectFile(item)], { type: 'application/json' }), `${fileSlug(item.name)}.roomshift.json`);
}

// ═══ Editor ═══════════════════════════════════════════════════════════════
function ensureViewport() {
  if (viewport) return;
  viewport = new RoomViewport($('#viewport'), {
    onSelect(objectId) { select(objectId, { fromViewport: true }); },
    onTransform: handleTransform,
    onDragChange(dragging) {
      isDragging = dragging;
      if (dragging) {
        dragSnapshot = currentSnapshot();
        $('#inspector-card').style.opacity = '0.35';
      } else {
        $('#inspector-card').style.opacity = '';
        if (dragSnapshot && JSON.stringify(dragSnapshot) !== JSON.stringify(currentSnapshot())) {
          history.record(dragSnapshot);
          afterChange();
          renderCard();
        }
        dragSnapshot = null;
      }
    },
    onProbe: renderProbe,
    onRoomResize(dimensions) {
      try {
        apply(resizeRoom(roomScene, dimensions));
        toast(`Room is now ${fmt(roomScene.room.width, 2)} × ${fmt(roomScene.room.depth, 2)} m`, { action: 'Undo', onAction: undo });
      } catch (error) { toast(error.message, { tone: 'warn' }); }
    },
    onContextMenu: openContextMenu,
  });
  viewport.onActivate = (objectId) => {
    const object = roomScene.objects.find((item) => item.id === objectId);
    if (isWallItem(object)) toggleOpen(object.id);
  };
  viewport.onViewChange = syncViewButtons;
  viewport.onFrame = () => { positionCard(); if (pins.length) positionPins(); };
  viewport.onEmptyClick = (point) => (selectedId ? false : addPin(point));
  viewport.setTheme(resolvedTheme());
  fieldController = new RoomFieldController({
    worker: new Worker(new URL('./simulation/room-field-worker.js', import.meta.url), { type: 'module' }),
    viewport: solverViewport(),
    onState: (state) => { if (state.mode) renderFieldState(state); },
  });
  window.addEventListener('pagehide', () => {
    flushSave();
    fieldController.dispose();
    viewport.dispose();
  }, { once: true });
}

function openEditor(next) {
  if (project?.id === next.id && !$('#editor').hidden) return;
  flushSave();
  $('#files').hidden = true;
  $('#editor').hidden = false;
  ensureViewport();
  project = next;
  roomScene = next.scene;
  selectedId = null;
  history = new UndoHistory();
  weather = null;
  setLens(null);
  document.title = `${project.name} · RoomShift`;
  $('#project-name').value = project.name;
  viewport.setEnvironment(environmentOf(project));
  pushSolverScene();
  viewport.setScene(roomScene, null);
  viewport.fitRoom(true);
  closeSheet();
  renderAll();
  renderDock();
  scheduleLayoutReport();
  setSaveStatus('saved');
  app.onOpen?.forEach((handler) => handler(project));
  if (!localStorage.getItem('roomshift.onboarded.v2')) {
    setTimeout(() => toast(`Drag furniture up from the dock · ${mod}K for everything`, { timeout: 6500 }), 700);
    try { localStorage.setItem('roomshift.onboarded.v2', '1'); } catch { /* private mode */ }
  }
}
app.onOpen = [];

function closeEditor() {
  if (!project) return;
  flushSave();
  setLens(null);
  project = null;
}

// ─── Saving ───────────────────────────────────────────────────────────────
function setSaveStatus(state) {
  const dot = $('#save-status');
  dot.className = `save-dot ${state === 'saved' ? '' : state}`;
  dot.title = { saved: 'All changes saved', saving: 'Saving…', error: 'Not saved — browser storage is full' }[state];
}
function scheduleSave() {
  setSaveStatus('saving');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 600);
}
function flushSave() {
  if (!project || !saveTimer) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  let next = { ...project, scene: roomScene };
  if (app.beforeSave) next = app.beforeSave(next);
  if (viewport && Date.now() - lastThumbnailAt > 4000 && !lens) {
    try {
      next.thumbnail = viewport.captureThumbnail();
      lastThumbnailAt = Date.now();
    } catch { /* optional */ }
  }
  const saved = saveProject(next);
  if (saved) {
    project = saved;
    setSaveStatus('saved');
  } else setSaveStatus('error');
}

// ─── Scene updates ────────────────────────────────────────────────────────
const currentSnapshot = () => ({ scene: roomScene, selectedId });
const selectedObject = () => roomScene?.objects.find((object) => object.id === selectedId) ?? null;

// The CFD solver knows fans, heaters and windows: a door is an opening and an AC
// unit drives a jet like a fan.
function solverScene() {
  return {
    ...roomScene,
    objects: roomScene.objects.map((object) => {
      if (object.model === 'door') return { ...object, model: 'window' };
      // The jet follows the fan head (yaw, tilt) or the AC louver.
      if (object.model === 'fan') {
        return { ...object, rotation: { ...object.rotation, x: (object.rotation.x ?? 0) - (object.props?.tilt ?? 0), y: object.rotation.y + (object.props?.yaw ?? 0) } };
      }
      // An AC unit is a jet from its outlet, aimed down by the louver; model it as
      // a small fan there so the tilt never pushes it through the ceiling.
      if (object.model === 'ac') {
        const size = 0.2;
        return {
          ...object,
          model: 'fan',
          dimensions: { width: size, height: size, depth: size },
          position: { x: object.position.x, y: Math.min(roomScene.room.height - size - 0.05, object.position.y + object.dimensions.height / 2 - size / 2), z: object.position.z + object.dimensions.depth / 2 },
          rotation: { x: object.props?.louver ?? 30, y: object.rotation.y, z: 0 },
        };
      }
      return object;
    }),
  };
}
function pushSolverScene() {
  fieldController?.setOptions({ ambientTemperature: environmentOf(project).baselineTemperature });
  fieldController?.setScene(solverScene());
}

function afterChange() {
  pushSolverScene();
  scheduleSave();
  scheduleLayoutReport();
  refreshLensFields();
}

function updateScene(scene, { record = !isDragging } = {}) {
  if (JSON.stringify(scene) === JSON.stringify(roomScene)) return;
  if (record) history.record(currentSnapshot());
  roomScene = scene;
  if (!isDragging) afterChange();
  else if (VOLUME_LENSES.has(lens) || lens === 'light') scheduleLensFrame();
}

function apply(result, { select: nextSelection } = {}) {
  updateScene(result.scene ?? result);
  if (nextSelection !== undefined) selectedId = nextSelection;
  viewport.setScene(roomScene, selectedId);
  renderAll();
}

function restoreSnapshot(snapshot) {
  roomScene = structuredClone(snapshot.scene);
  selectedId = snapshot.selectedId && roomScene.objects.some((object) => object.id === snapshot.selectedId) ? snapshot.selectedId : null;
  viewport.setScene(roomScene, selectedId);
  viewport.setMode(transformMode);
  renderAll();
  afterChange();
}
function undo() {
  const snapshot = history.undo(currentSnapshot());
  if (snapshot) restoreSnapshot(snapshot);
  else toast('Nothing to undo');
}
function redo() {
  const snapshot = history.redo(currentSnapshot());
  if (snapshot) restoreSnapshot(snapshot);
}

function handleTransform(objectId, position, rotation) {
  const result = transformMode === 'rotate' ? rotateObject(roomScene, objectId, rotation) : moveObject(roomScene, objectId, position);
  updateScene(result.scene, { record: false });
  syncExactInputs(result.object);
  return result;
}

function select(objectId, { fromViewport = false } = {}) {
  selectedId = objectId;
  if (!fromViewport) viewport.select(objectId);
  renderOutline();
  renderCard();
}

function renderAll() {
  renderChips();
  renderOutline();
  renderCard();
  renderRoomSheet();
  renderSiteSheet();
  renderNarrator();
}

// ─── Chips & narrator ─────────────────────────────────────────────────────
function renderChips() {
  const { width, depth, height } = roomScene.room;
  const shape = roomShape(roomScene.room).type;
  $('#room-summary').textContent = `${fmt(width, 1)} × ${fmt(depth, 1)} × ${fmt(height, 1)} m${shape === 'rect' ? '' : ` · ${ROOM_SHAPES[shape].split(' /')[0]}`}`;
  const environment = environmentOf(project);
  const city = CITIES.find((item) => item.id === environment.city)?.label ?? 'Site';
  $('#site-summary').textContent = `${city} · faces ${compassLabel(environment.backWallBearing)} · ${formatHour(environment.hour)}`;
}

function spotsSentence(spots, unit, digits = 0) {
  if (!spots.length) return '';
  const best = spots.reduce((a, b) => (b.value > a.value ? b : a));
  const worst = spots.reduce((a, b) => (b.value < a.value ? b : a));
  return best === worst
    ? ` · <strong>${escapeHtml(best.object.name)}</strong> ${fmt(best.value, digits)} ${unit}`
    : ` · best at <strong>${escapeHtml(best.object.name)}</strong> (${fmt(best.value, digits)} ${unit}), weakest at <strong>${escapeHtml(worst.object.name)}</strong> (${fmt(worst.value, digits)} ${unit})`;
}

function renderNarrator() {
  const narrator = $('#narrator');
  if (!roomScene) return;
  if (!lens) {
    if (!layoutReport) { narrator.innerHTML = ''; return; }
    const high = layoutReport.issues.filter((issue) => issue.severity !== 'low').length;
    narrator.innerHTML = high
      ? `Livability <strong>${layoutReport.score}</strong> · ${high} thing${high > 1 ? 's' : ''} to fix — click the score`
      : `Livability <strong>${layoutReport.score}</strong> · pick a lens to see air, heat, light, WiFi or sound`;
    return;
  }
  if (VOLUME_LENSES.has(lens)) {
    if (!planeField?.values) { narrator.innerHTML = '<span class="spinner"></span> Computing…'; return; }
    if (lens === 'wifi') {
      const finite = [...planeField.values].filter(Number.isFinite);
      const good = finite.filter((value) => value >= -67).length / Math.max(1, finite.length);
      narrator.innerHTML = `<strong>${Math.round(good * 100)}%</strong> of the room has good signal${spotsSentence(sampleListeningSpots(roomScene, 'wifi'), 'dBm')}`;
    } else {
      const acoustics = roomAcoustics(roomScene);
      narrator.innerHTML = `Echo <strong>${fmt(acoustics.rt60, 2)} s</strong> (${acoustics.rt60 < 0.35 ? 'dry' : acoustics.rt60 < 0.7 ? 'balanced' : acoustics.rt60 < 1.1 ? 'lively' : 'echoey'})${spotsSentence(sampleListeningSpots(roomScene, 'sound'), 'dB')}`;
    }
    return;
  }
  if (lens === 'light') {
    const { sun, walls } = sunlitWalls(environmentOf(project));
    const sunny = roomScene.objects.filter((object) => object.model === 'window' && walls.includes(object.wall));
    const sunText = sun.altitude <= 0 ? 'Sun is down' : sunny.length ? `Sun comes in through <strong>${escapeHtml(sunny[0].name)}</strong>` : `Sun ${fmt(sun.altitude)}° in the ${compassLabel(sun.azimuth)}, no window faces it`;
    narrator.innerHTML = `${sunText}${planeField?.light ? spotsSentence(sampleListeningSpots(roomScene, 'light', planeField.light), 'lux') : ''}`;
    return;
  }
  if (!fieldResult) { narrator.innerHTML = '<span class="spinner"></span> Solving the airflow…'; return; }
  if (lens === 'airflow') {
    const air = ventilation(roomScene, { windSpeed: weather?.windSpeed ?? null, people: environmentOf(project).people ?? 1 });
    narrator.innerHTML = `Fastest air <strong>${fmt(fieldResult.stats.maxSpeed, 2)} m/s</strong> · fresh air <strong>${fmt(air.ach, 1)} changes/h</strong>${air.mode === 'closed' ? ' (all closed)' : ''}`;
  } else {
    narrator.innerHTML = `Hottest <strong>${fmt(fieldResult.stats.maxTemperature, 1)} °C</strong> · room average <strong>${fmt(fieldResult.stats.meanTemperature ?? fieldResult.ambientTemperature, 1)} °C</strong>`;
  }
}

// ─── Outline ──────────────────────────────────────────────────────────────
function renderOutline() {
  $('#object-count').textContent = roomScene.objects.length || '';
  const issueIds = new Set((layoutReport?.issues ?? []).filter((issue) => issue.severity !== 'low').map((issue) => issue.objectId));
  const groups = {};
  for (const object of roomScene.objects) (groups[MODEL_PRESETS[object.model]?.category ?? 'basic'] ??= []).push(object);
  $('#object-list').innerHTML = Object.keys(CATEGORY_LABELS).filter((category) => groups[category]).map((category) => `
    <div class="object-group-label">${CATEGORY_LABELS[category]}</div>
    ${groups[category].map((object) => `
      <button class="object-row ${object.id === selectedId ? 'selected' : ''}" type="button" data-select-object="${escapeHtml(object.id)}" aria-pressed="${object.id === selectedId}">
        <span class="object-row-icon">${escapeHtml(MODEL_PRESETS[object.model]?.icon ?? '□')}</span>
        <span class="object-row-name">${escapeHtml(object.name)}</span>
        ${object.color ? `<span class="swatch-dot" style="background:${escapeHtml(object.color)}"></span>` : ''}
        ${isWallItem(object) && object.open ? '<span class="object-flag">open</span>' : ''}
        ${object.locked ? '<span class="object-flag">🔒</span>' : ''}
        ${issueIds.has(object.id) ? '<span class="object-flag warn" title="Has a layout issue">!</span>' : ''}
      </button>`).join('')}`).join('');
  $('#empty-hint').hidden = roomScene.objects.length > 0;
}
$('#object-list').addEventListener('click', (event) => {
  const row = event.target.closest('[data-select-object]');
  if (row) select(row.dataset.selectObject);
});

// ─── Floating card ────────────────────────────────────────────────────────
function renderCard() {
  const card = $('#inspector-card');
  const object = selectedObject();
  card.hidden = !object;
  updateInsets();
  if (!object) return;
  const preset = MODEL_PRESETS[object.model];
  const opening = isWallItem(object);
  $('#card-icon').textContent = preset.icon;
  $('#card-type').textContent = preset.label;
  $('#lock-object').textContent = object.locked ? '🔒' : '🔓';
  $('#lock-object').title = object.locked ? 'Unlock · K' : 'Lock — Suggest layout won\'t move it · K';
  $('#lock-object').hidden = opening;
  const spec = INTENSITY[object.model];
  const props = objectProps(object);
  const value = props[spec?.key] ?? spec?.default;
  const sizes = SIZE_PRESETS[object.model];
  const isLight = ['lamp', 'deskLamp', 'ceilingLight'].includes(object.model);
  const on = object.props?.on !== 0;
  const activeSize = sizes?.find(([, dims]) => Object.entries(dims).every(([axis, size]) => Math.abs(object.dimensions[axis] - size) < 0.011))?.[0];
  const intensityLabel = spec?.labels ? spec.labels[Math.round(value) - 1] : `${value} ${spec?.unit ?? ''}`;
  const product = object.product?.image || object.product?.url ? `<div class="product-row">${object.product.image ? `<img src="${escapeHtml(object.product.image)}" alt="" referrerpolicy="no-referrer" />` : ''}<div>${object.product.price ? `<b>${escapeHtml(object.product.price)}</b>` : ''}${object.product.url ? `<a href="${escapeHtml(object.product.url)}" target="_blank" rel="noopener">View product ↗</a>` : ''}</div></div>` : '';
  $('#object-properties').innerHTML = `
    <input class="name-input" data-object-name aria-label="Name" maxlength="80" />
    ${product}
    ${opening ? `
      <button class="toggle" type="button" data-toggle-open><span>${object.open ? 'Open' : 'Closed'} <kbd>Space</kbd></span><span class="switch ${object.open ? 'on' : ''}"></span></button>
      <div><div class="prop-label">Wall</div><div class="chip-row">${['back', 'front', 'left', 'right'].map((wall) => `<button type="button" class="chip-option ${object.wall === wall ? 'active' : ''}" data-wall="${wall}">${wall[0].toUpperCase()}${wall.slice(1)}</button>`).join('')}</div></div>` : ''}
    ${isLight ? `<button class="toggle" type="button" data-toggle-on><span>${on ? 'Light on' : 'Light off'}</span><span class="switch ${on ? 'on' : ''}"></span></button>` : ''}
    ${spec && !(isLight && !on) ? `<div><div class="prop-label">${spec.label}<b data-intensity-label>${escapeHtml(intensityLabel)}</b></div>
      <input class="range" type="range" min="${spec.min}" max="${spec.max}" step="${spec.step}" value="${value}" data-prop="${spec.key}" /></div>` : ''}
    ${object.model === 'router' ? `<div><div class="prop-label">Band</div><div class="chip-row">${[2.4, 5].map((band) => `<button type="button" class="chip-option ${(props.band ?? 5) === band ? 'active' : ''}" data-band="${band}">${band} GHz</button>`).join('')}</div></div>` : ''}
    ${sizes ? `<div><div class="prop-label">Size</div><div class="chip-row">${sizes.map(([label]) => `<button type="button" class="chip-option ${label === activeSize ? 'active' : ''}" data-size="${escapeHtml(label)}">${escapeHtml(label)}</button>`).join('')}</div></div>` : ''}
    ${styleControls(object)}
    ${openingControls(object)}
    ${fanControls(object)}
    ${opening ? '' : `${colourRow(object, 'color', SECOND_COLOUR[object.model] ? 'Main colour' : 'Colour')}
      ${SECOND_COLOUR[object.model] ? colourRow(object, 'color2', SECOND_COLOUR[object.model]) : ''}
      <div><div class="prop-label">Material <b>${escapeHtml(MATERIALS[objectMaterial(object)]?.label ?? '')}</b></div><div class="chip-row">${Object.entries(MATERIALS).map(([key, item]) => `<button type="button" class="chip-option ${objectMaterial(object) === key ? 'active' : ''}" data-material="${key}" title="WiFi −${item.wifiLossDb} dB · absorbs ${Math.round(item.absorption * 100)}% of sound · reflects ${Math.round(item.reflectance * 100)}% of light">${escapeHtml(item.label.split(' ')[0])}</button>`).join('')}</div></div>`}
    <details class="exact" ${localStorage.getItem('roomshift.exact') === '1' ? 'open' : ''}>
      <summary>Exact position &amp; size</summary>
      <div class="xyz"><span>Position</span>${['x', 'y', 'z'].map((axis) => `<input type="number" step="0.05" data-position="${axis}" value="${fmt(object.position[axis], 2)}" aria-label="Position ${axis}" />`).join('')}</div>
      <div class="xyz"><span>Size</span>${['width', 'height', 'depth'].map((axis) => (opening && axis === 'depth' ? '<span></span>' : `<input type="number" step="0.05" data-dimension="${axis}" value="${fmt(object.dimensions[axis], 2)}" aria-label="${axis}" />`)).join('')}</div>
      ${opening ? '' : `<div class="xyz"><span>Rotate °</span>${['x', 'y', 'z'].map((axis) => `<input type="number" step="15" data-rotation="${axis}" value="${fmt(object.rotation[axis], 0)}" aria-label="Rotation ${axis}" />`).join('')}</div>
      <div class="xyz"><span>Type</span><select class="select" data-object-model style="grid-column: span 3">${Object.entries(MODEL_PRESETS).filter(([, item]) => !item.wall).map(([key, item]) => `<option value="${key}">${escapeHtml(item.label)}</option>`).join('')}</select></div>`}
    </details>
    <p class="card-note">${cardNote(object)}</p>`;
  $('[data-object-name]').value = object.name;
  const modelSelect = $('[data-object-model]');
  if (modelSelect) modelSelect.value = object.model;
  positionCard();
}

function colourRow(object, key, label) {
  const current = object[key];
  return `<div><div class="prop-label">${label}</div><div class="swatches">
    <button type="button" class="swatch none ${current ? '' : 'active'}" data-colour-key="${key}" data-color="" title="Default"></button>
    ${SWATCHES.map((color) => `<button type="button" class="swatch ${current === color ? 'active' : ''}" style="background:${color}" data-colour-key="${key}" data-color="${color}" title="${color}"></button>`).join('')}
    <label class="swatch custom" title="Custom colour"><input type="color" data-color-custom="${key}" value="${current ?? '#888888'}" /></label></div></div>`;
}

function chipGroup(label, attribute, choices, current) {
  return `<div><div class="prop-label">${label}</div><div class="chip-row">${choices.map(([value, text]) => `<button type="button" class="chip-option ${String(current) === String(value) ? 'active' : ''}" ${attribute}="${escapeHtml(value)}">${escapeHtml(text)}</button>`).join('')}</div></div>`;
}

function styleControls(object) {
  const options = STYLE_OPTIONS[object.model];
  if (!options) return '';
  const style = styleOf(object);
  return options.map(([key, label, choices]) => chipGroup(label, `data-style-${key}`, choices, style[key] === 'auto' ? '' : style[key])).join('');
}

function sliderRow(label, prop, value, min, max, step, unit) {
  return `<div><div class="prop-label">${label}<b data-slider-label="${prop}">${value}${unit}</b></div><input class="range" type="range" min="${min}" max="${max}" step="${step}" value="${value}" data-slider="${prop}" data-unit="${unit}" /></div>`;
}

function openingControls(object) {
  const props = object.props ?? {};
  if (object.model === 'window') {
    const type = props.type ?? 'sliding';
    return `${chipGroup('Type', 'data-window-type', Object.entries(WINDOW_TYPES).map(([key, item]) => [key, item.label]), type)}
      ${type === 'fixed' ? '' : sliderRow('Opened', 'amount', Math.round((props.amount ?? 1) * 100), 0, 100, 5, '%')}
      ${chipGroup('Covering', 'data-covering', Object.entries(WINDOW_COVERINGS).map(([key, item]) => [key, item.label]), props.covering ?? 'none')}`;
  }
  if (object.model === 'door') {
    return `${sliderRow('Opened to', 'angle', props.angle ?? 90, 10, 110, 5, '°')}
      ${chipGroup('Hinge', 'data-hinge', [['left', 'Left'], ['right', 'Right']], props.hinge ?? 'left')}
      ${chipGroup('Swings', 'data-swing', [['in', 'Into the room'], ['out', 'Outwards']], props.swing ?? 'in')}`;
  }
  return '';
}

function fanControls(object) {
  const props = object.props ?? {};
  if (object.model === 'fan') {
    return `${sliderRow('Head turned', 'yaw', props.yaw ?? 0, -90, 90, 5, '°')}
      ${sliderRow('Head tilted up', 'tilt', props.tilt ?? 0, -20, 30, 5, '°')}
      <button class="toggle" type="button" data-toggle-prop="oscillate"><span>Oscillate</span><span class="switch ${props.oscillate ? 'on' : ''}"></span></button>`;
  }
  if (object.model === 'ac') return sliderRow('Louver aimed down', 'louver', props.louver ?? 30, 0, 60, 5, '°');
  return '';
}

function cardNote(object) {
  return {
    window: 'Double-click it in the room to open or close. Sun enters through the glass; air leaves when open.',
    door: 'Double-click to swing it. Keep the swing clear — the layout check watches it.',
    fan: 'Pushes a jet out of its front. Aim it at where people sit.',
    ac: 'Modelled as an airflow jet. Don’t aim it at a bed.',
    heater: 'Heat output follows its watts. Keep 90 cm from fabric, 60 cm from where people sit.',
    router: 'Raise it 1–2 m and keep metal (fridges, radiators) out of the line of sight.',
    speaker: 'Soft furnishings shorten the echo; hard rooms ring.',
    lamp: 'Floor lamps light the room; a desk lamp gives 300–500 lux for work.',
    deskLamp: 'Drop it on a desk or table and it sits on top.',
    ceilingLight: 'General light from above. Check desk lux with the Light lens.',
  }[object.model] ?? 'Drag the gizmo, arrows nudge, [ ] rotate, right-click for more.';
}

// Keep the view cube clear of whatever is docked on the right.
function updateInsets() {
  if (!viewport) return;
  viewport.rightInset = ($('#sheet').hidden ? 0 : 336) + ($('#inspector-card').hidden ? 0 : 300);
}

// The card docks on the right, beside the insights sheet when that is open, so
// it never covers the object being edited.
function positionCard() {
  const card = $('#inspector-card');
  if (card.hidden || !selectedId) return;
  const width = $('#viewport').clientWidth;
  const sheetWidth = $('#sheet').hidden ? 0 : 336;
  const x = width - sheetWidth - card.offsetWidth - 12;
  const transform = `translate(${Math.round(x)}px, 66px)`;
  if (card.style.transform !== transform) card.style.transform = transform;
}

function syncExactInputs(object) {
  for (const input of $$('[data-position]')) input.value = fmt(object.position[input.dataset.position], 2);
  for (const input of $$('[data-rotation]')) input.value = fmt(object.rotation[input.dataset.rotation], 0);
}

const properties = $('#object-properties');
const patchObject = (id, patch) => ({ ...roomScene, objects: roomScene.objects.map((item) => (item.id === id ? { ...item, ...patch } : item)) });
properties.addEventListener('click', (event) => {
  const object = selectedObject();
  const target = event.target.closest('button');
  if (!object || !target) return;
  try {
    if (target.matches('[data-toggle-open]')) toggleOpen(object.id);
    else if (target.matches('[data-toggle-on]')) apply(setObjectProp(roomScene, object.id, 'on', object.props?.on === 0 ? 1 : 0));
    else if (target.dataset.band) apply(setObjectProp(roomScene, object.id, 'band', Number(target.dataset.band)));
    else if (target.dataset.wall) apply(setWindowWall(roomScene, object.id, target.dataset.wall));
    else if (target.dataset.size) apply(resizeObject(roomScene, object.id, SIZE_PRESETS[object.model].find(([label]) => label === target.dataset.size)[1]));
    else if (target.dataset.color !== undefined) apply(patchObject(object.id, { [target.dataset.colourKey ?? 'color']: target.dataset.color || undefined }));
    else if (Object.keys(target.dataset).some((key) => key.startsWith('style'))) {
      const key = Object.keys(target.dataset).find((name) => name.startsWith('style'));
      const option = key.slice(5).toLowerCase();
      apply(patchObject(object.id, { style: { ...(object.style ?? {}), [option]: target.dataset[key] } }));
    } else if (target.dataset.windowType) apply(patchObject(object.id, { props: { ...(object.props ?? {}), type: target.dataset.windowType }, open: target.dataset.windowType === 'fixed' ? false : object.open }));
    else if (target.dataset.covering) apply(patchObject(object.id, { props: { ...(object.props ?? {}), covering: target.dataset.covering } }));
    else if (target.dataset.hinge) apply(patchObject(object.id, { props: { ...(object.props ?? {}), hinge: target.dataset.hinge } }));
    else if (target.dataset.swing) apply(patchObject(object.id, { props: { ...(object.props ?? {}), swing: target.dataset.swing } }));
    else if (target.dataset.toggleProp) apply(patchObject(object.id, { props: { ...(object.props ?? {}), [target.dataset.toggleProp]: !object.props?.[target.dataset.toggleProp] } }));
    else if (target.dataset.material) apply(setObjectMaterial(roomScene, object.id, target.dataset.material));
  } catch (error) {
    toast(error.message, { tone: 'warn' });
  }
});
properties.addEventListener('input', (event) => {
  const input = event.target;
  const object = selectedObject();
  if (input.dataset.slider) {
    $(`[data-slider-label="${input.dataset.slider}"]`).textContent = `${input.value}${input.dataset.unit}`;
    return;
  }
  if (!object || !input.dataset.prop) return;
  const spec = INTENSITY[object.model];
  $('[data-intensity-label]').textContent = spec.labels ? spec.labels[Number(input.value) - 1] : `${input.value} ${spec.unit}`;
  // Lights, WiFi and sound respond live; the CFD re-solves on release.
  if (['lumens', 'level', 'power'].includes(input.dataset.prop)) {
    roomScene = setObjectProp(roomScene, object.id, input.dataset.prop, Number(input.value)).scene;
    scheduleLensFrame();
  }
});
properties.addEventListener('toggle', (event) => {
  if (event.target.matches('details.exact')) try { localStorage.setItem('roomshift.exact', event.target.open ? '1' : '0'); } catch { /* ignore */ }
}, true);
properties.addEventListener('change', (event) => {
  const input = event.target;
  const object = selectedObject();
  if (!object) return;
  try {
    if (input.matches('[data-object-name]')) apply(renameObject(roomScene, object.id, input.value));
    else if (input.matches('[data-object-model]')) apply(setObjectModel(roomScene, object.id, input.value));
    else if (input.matches('[data-color-custom]')) apply(patchObject(object.id, { [input.dataset.colorCustom || 'color']: input.value }));
    else if (input.dataset.slider) {
      const raw = Number(input.value);
      const value = input.dataset.slider === 'amount' ? raw / 100 : raw;
      const patch = { props: { ...(object.props ?? {}), [input.dataset.slider]: value } };
      // Opening a window or door by any amount opens it; zero closes it.
      if (input.dataset.slider === 'amount' || input.dataset.slider === 'angle') patch.open = raw > 0;
      apply(patchObject(object.id, patch));
    }
    else if (input.dataset.prop) {
      history.record({ scene: getProject(project.id)?.scene ?? roomScene, selectedId });
      roomScene = setObjectProp(roomScene, object.id, input.dataset.prop, Number(input.value)).scene;
      viewport.setScene(roomScene, selectedId);
      afterChange();
      renderOutline();
    } else if (input.type === 'number') {
      const value = Number(input.value);
      if (!Number.isFinite(value)) return renderCard();
      if (input.dataset.position) apply(moveObject(roomScene, object.id, { [input.dataset.position]: value }));
      else if (input.dataset.dimension) apply(resizeObject(roomScene, object.id, { [input.dataset.dimension]: value }));
      else if (input.dataset.rotation) apply(rotateObject(roomScene, object.id, { [input.dataset.rotation]: value }));
    }
  } catch (error) {
    toast(error.message, { tone: 'warn' });
    renderCard();
  }
});

function deleteSelected() {
  const object = selectedObject();
  if (!object) return;
  apply(removeObject(roomScene, object.id), { select: null });
  toast(`Deleted ${object.name}`, { action: 'Undo', onAction: undo });
}
function duplicateSelected() {
  if (!selectedId) return;
  try {
    const result = duplicateObject(roomScene, selectedId);
    apply(result, { select: result.object.id });
    flashRow(result.object.id);
  } catch (error) { toast(error.message, { tone: 'warn' }); }
}
function toggleLock() {
  const object = selectedObject();
  if (!object || isWallItem(object)) return;
  apply(patchObject(object.id, { locked: !object.locked }));
  toast(object.locked ? `${object.name} unlocked` : `${object.name} locked in place`);
}
function toggleOpen(objectId = selectedId) {
  const object = roomScene.objects.find((item) => item.id === objectId);
  if (!isWallItem(object)) return false;
  apply(setWindowOpen(roomScene, object.id, !object.open));
  return true;
}
function spin(degrees) {
  const object = selectedObject();
  if (!object || isWallItem(object)) return;
  try { apply(rotateObject(roomScene, object.id, { y: object.rotation.y + degrees })); } catch (error) { toast(error.message, { tone: 'warn' }); }
}
function flashRow(objectId) {
  const row = $(`[data-select-object="${CSS.escape(objectId)}"]`);
  row?.classList.add('flash');
  row?.scrollIntoView({ block: 'nearest', behavior: reducedMotion ? 'auto' : 'smooth' });
}
$('#delete-object').addEventListener('click', deleteSelected);
$('#duplicate-object').addEventListener('click', duplicateSelected);
$('#lock-object').addEventListener('click', toggleLock);

// ─── Dock: drag furniture into the room ───────────────────────────────────
function renderDock() {
  $('#dock-tabs').innerHTML = DOCK_TABS.map((tab) => `<button type="button" class="dock-tab ${tab === dockTab ? 'active' : ''}" data-dock-tab="${tab}">${tab === 'catalog' ? 'Catalog' : tab === 'photo' ? 'Photo & scan' : CATEGORY_LABELS[tab]}</button>`).join('');
  let items;
  if (dockTab === 'photo') {
    items = `<button class="dock-item photo" type="button" data-dock-action="room-photo"><span class="glyph">⛶</span>Room size</button>
      <button class="dock-item photo" type="button" data-dock-action="furniture-photo"><span class="glyph">◫</span>Furniture</button>
      ${dockProviders.map((provider) => provider()).join('')}`;
  } else if (dockTab === 'catalog') {
    items = CATALOG.map((item, index) => `<button class="dock-item" type="button" data-catalog="${index}" title="${escapeHtml(item.name)} · ${fmt(item.dimensions.width * 100)}×${fmt(item.dimensions.depth * 100)} cm"><span class="glyph">${escapeHtml(MODEL_PRESETS[item.model].icon)}</span>${escapeHtml(item.name.replace(/^IKEA /, '').split(',')[0].slice(0, 14))}</button>`).join('');
  } else {
    items = Object.entries(MODEL_PRESETS).filter(([, preset]) => preset.category === dockTab)
      .map(([key, preset]) => `<button class="dock-item" type="button" data-add-model="${key}" title="Drag into the room, or click to add"><span class="glyph">${escapeHtml(preset.icon)}</span>${escapeHtml(preset.label)}</button>`).join('');
  }
  $('#dock-items').innerHTML = items;
}
$('#dock-tabs').addEventListener('click', (event) => {
  const tab = event.target.closest('[data-dock-tab]');
  if (!tab) return;
  dockTab = tab.dataset.dockTab;
  renderDock();
});

function placeModel(model, { position, catalog } = {}) {
  try {
    let result;
    if (MODEL_PRESETS[model].wall) {
      result = addWindow(roomScene, position ? nearestWall(position) : 'back', model);
      if (position) result = moveObject(result.scene, result.object.id, position);
    } else {
      const options = { model };
      if (catalog) Object.assign(options, { dimensions: { ...catalog.dimensions }, name: catalog.name.replace(/^IKEA /, '') });
      result = addObject(roomScene, options);
      // Clicked (not dragged) desk items go onto the first desk or table, side by side.
      if (!position && MODEL_PRESETS[model].category === 'desk') {
        const surface = roomScene.objects.find((object) => object.model === 'desk') ?? roomScene.objects.find((object) => object.model === 'table');
        if (surface) {
          const already = roomScene.objects.filter((object) => MODEL_PRESETS[object.model]?.category === 'desk'
            && Math.abs(object.position.x - surface.position.x) < surface.dimensions.width / 2 && Math.abs(object.position.z - surface.position.z) < surface.dimensions.depth / 2).length;
          const slot = ((already % 3) - 1) * surface.dimensions.width * 0.3;
          position = { x: surface.position.x + slot, z: surface.position.z };
        }
      }
      if (position) {
        // Small items dropped on a desk, table or shelf sit on top of it.
        const surface = STACKABLE.has(model) && roomScene.objects.find((object) => SURFACES.has(object.model)
          && Math.abs(position.x - object.position.x) < object.dimensions.width / 2 && Math.abs(position.z - object.position.z) < object.dimensions.depth / 2);
        result = moveObject(result.scene, result.object.id, { ...position, ...(surface ? { y: surface.position.y + surface.dimensions.height } : {}) });
      }
      if (catalog?.color || catalog?.props) {
        const extra = { ...(catalog.color ? { color: catalog.color } : {}), ...(catalog.props ? { props: catalog.props } : {}) };
        result = { object: { ...result.object, ...extra }, scene: { ...result.scene, objects: result.scene.objects.map((item) => (item.id === result.object.id ? { ...item, ...extra } : item)) } };
      }
    }
    apply(result, { select: result.object.id });
    flashRow(result.object.id);
    return result.object;
  } catch (error) {
    toast(error.message, { tone: 'warn' });
    return null;
  }
}
app.placeModel = placeModel;

function nearestWall({ x, z }) {
  const { width, depth } = roomScene.room;
  const distances = { front: z, back: depth - z, left: x, right: width - x };
  return Object.entries(distances).sort((a, b) => a[1] - b[1])[0][0];
}

let dockDrag = null;
$('#dock-items').addEventListener('pointerdown', (event) => {
  const item = event.target.closest('[data-add-model], [data-catalog]');
  if (!item || event.button !== 0) return;
  const catalog = item.dataset.catalog ? CATALOG[Number(item.dataset.catalog)] : null;
  dockDrag = { model: item.dataset.addModel ?? catalog.model, catalog, startX: event.clientX, startY: event.clientY, moved: false };
  item.setPointerCapture(event.pointerId);
});
$('#dock-items').addEventListener('pointermove', (event) => {
  if (!dockDrag) return;
  if (!dockDrag.moved && Math.hypot(event.clientX - dockDrag.startX, event.clientY - dockDrag.startY) < 6) return;
  dockDrag.moved = true;
  const ghost = $('#drop-ghost');
  const bounds = $('#viewport').getBoundingClientRect();
  const point = viewport.roomPointAt(event.clientX, event.clientY);
  ghost.hidden = false;
  ghost.classList.toggle('invalid', !point);
  ghost.innerHTML = `${escapeHtml(MODEL_PRESETS[dockDrag.model].icon)}<small>${point ? `${fmt(point.x, 2)}, ${fmt(point.z, 2)} m` : 'Drop on the floor'}</small>`;
  ghost.style.transform = `translate(${event.clientX - bounds.left - 29}px, ${event.clientY - bounds.top - 29}px)`;
});
$('#dock-items').addEventListener('pointerup', (event) => {
  if (!dockDrag) return;
  const { model, catalog, moved } = dockDrag;
  dockDrag = null;
  $('#drop-ghost').hidden = true;
  if (!moved) return placeModel(model, { catalog });
  const point = viewport.roomPointAt(event.clientX, event.clientY);
  if (point) placeModel(model, { position: point, catalog });
});
$('#dock-items').addEventListener('click', (event) => {
  const action = event.target.closest('[data-dock-action]')?.dataset.dockAction;
  if (action === 'room-photo') photoPanel.open();
  else if (action === 'furniture-photo') openFurniturePhoto();
  else if (action) app.dockActions?.[action]?.();
});
$('#add-box').addEventListener('click', () => placeModel('box'));
$('#add-window').addEventListener('click', () => placeModel('window'));

// ─── Lenses ───────────────────────────────────────────────────────────────
// Lenses can be combined: `lenses` is everything showing, `lens` the primary one
// (the legend, probe and narrator follow it). Shift-click adds or removes a lens.
const lenses = new Set();
const lensFields = {};
let solverResult = null;

function setLens(mode, { additive = false } = {}) {
  if (!fieldController) return;
  if (mode === 'wifi' && !roomScene.objects.some((object) => object.model === 'router')) autoPlace('router');
  if (mode === 'sound' && !roomScene.objects.some((object) => object.model === 'speaker')) autoPlace('speaker');
  if (!additive) lenses.clear();
  if (mode) {
    if (additive && lenses.has(mode)) lenses.delete(mode);
    else lenses.add(mode);
  }
  lens = mode && lenses.has(mode) ? mode : [...lenses].at(-1) ?? null;
  applyLenses();
}

function applyLenses() {
  document.body.dataset.lens = lens ?? 'none';
  for (const button of $$('.lens[data-mode]')) {
    const on = lenses.has(button.dataset.mode);
    button.classList.toggle('active', on);
    button.classList.toggle('secondary', on && button.dataset.mode !== lens);
    button.setAttribute('aria-pressed', String(on));
  }
  $('#lens-clear').hidden = !lenses.size;
  clearPins();
  viewport.setProbeLine(null);
  viewport.probeHeight = lens ? Math.min(roomScene.room.height - 0.1, probeHeights[lens] ?? DEFAULT_PROBE_HEIGHT[lens]) : undefined;
  viewport.clearPlaneField();
  viewport.setOverlayField(null);
  // One airflow solve feeds both Air and Heat.
  const wantsSolver = lenses.has('airflow') || lenses.has('temperature');
  if (!wantsSolver) {
    solverResult = null;
    viewport.clearLayer('airflow');
    viewport.clearLayer('temperature');
  }
  if (wantsSolver && fieldController.mode !== 'airflow') fieldController.setMode('airflow');
  else if (!wantsSolver && fieldController.mode) fieldController.setMode(null);
  else if (solverResult) showSolverLayers();
  viewport.setLightingPreview(lenses.has('light'));
  if (!lenses.size) legend.box.hidden = true;
  $('#sun-dock').hidden = !lenses.has('light');
  $('#probe').hidden = true;
  if (lenses.has('light')) renderSunDock();
  fieldResult = SOLVER_LENSES.has(lens) ? solverResult : null;
  refreshLensFields();
  if (SOLVER_LENSES.has(lens)) renderSolverLegend();
  renderNarrator();
  renderModeInsights();
}

const toggleLens = (mode, additive = false) => setLens(!additive && lens === mode && lenses.size === 1 ? null : mode, { additive });
for (const button of $$('.lens[data-mode]')) {
  button.title = `${button.title} · Shift-click to combine`;
  button.addEventListener('click', (event) => toggleLens(button.dataset.mode, event.shiftKey || event.metaKey));
}
$('#lens-clear').addEventListener('click', () => setLens(null));

// A lens needs its source: put one somewhere sensible and say so.
function autoPlace(model) {
  const desk = roomScene.objects.find((object) => ['desk', 'table', 'shelf'].includes(object.model));
  const { width, depth } = roomScene.room;
  const position = desk
    ? { x: desk.position.x + desk.dimensions.width * 0.3, z: desk.position.z, y: desk.position.y + desk.dimensions.height }
    : { x: width * 0.15, z: depth * 0.5, y: model === 'router' ? 1.0 : 0 };
  const result = addObject(roomScene, { model });
  history.record(currentSnapshot());
  roomScene = moveObject(result.scene, result.object.id, position).scene;
  viewport.setScene(roomScene, selectedId);
  renderOutline();
  afterChange();
  toast(`Added a ${MODEL_PRESETS[model].label.toLowerCase()} — drag it and watch the ${model === 'router' ? 'signal' : 'sound'} follow`, { action: 'Undo', onAction: undo, timeout: 5000 });
}

let lensFrame = 0;
function scheduleLensFrame() {
  cancelAnimationFrame(lensFrame);
  lensFrame = requestAnimationFrame(refreshLensFields);
}

function refreshLensFields() {
  if (!roomScene) return;
  for (const mode of VOLUME_LENSES) {
    if (lenses.has(mode)) {
      const volume = computeVolumeField(roomScene, mode, { cellSize: isDragging ? 0.16 : 0.12 });
      lensFields[mode] = { volume, plane: computePlaneField(roomScene, mode, { cellSize: 0.15 }) };
      if (volume) viewport.setLayer(mode, volume);
    } else {
      delete lensFields[mode];
      viewport.clearLayer(mode);
    }
  }
  if (lenses.has('light')) {
    const environment = environmentOf(project);
    const lampsOn = viewport?.lampsOnState() ?? true;
    const plane = computePlaneField(roomScene, 'light', { environment, cloudCover: weather?.cloudCover, cellSize: 0.2, lampsOn });
    const context = plane.light;
    lensFields.light = { plane, volume: { light: context, min: plane.min, max: plane.max } };
    // Repaint the lux map when a drag ends; mid-drag the last map stays put.
    if (luxMapOn && !isDragging) viewport.setSurfaceMap((point, normal) => luxAt(context, point, normal));
    else if (!luxMapOn) viewport.setSurfaceMap(null);
  } else {
    delete lensFields.light;
    viewport.setSurfaceMap(null);
  }
  planeField = lensFields[lens]?.plane ?? null;
  volumeField = lensFields[lens]?.volume ?? null;
  if (VOLUME_LENSES.has(lens)) renderVolumeLegend();
  else if (lens === 'light') renderLightLegend();
  refreshPins();
  renderNarrator();
  renderModeInsights();
}

const legend = {
  box: $('#field-legend'), title: $('#field-legend-title'), gradient: $('#field-gradient'), min: $('#field-legend-min'), max: $('#field-legend-max'), status: $('#field-status'),
};
function showLegend(mode, title, min, max, status) {
  legend.box.hidden = false;
  legend.gradient.dataset.mode = mode;
  legend.title.textContent = title;
  legend.min.textContent = min;
  legend.max.textContent = max;
  legend.status.innerHTML = status;
  let probe = $('#probe-controls');
  if (!probe) {
    probe = document.createElement('div');
    probe.id = 'probe-controls';
    probe.className = 'probe-controls';
    legend.box.append(probe);
  }
  probe.innerHTML = `<label><span>Measure at</span><input type="range" min="0.1" max="${fmt(roomScene.room.height - 0.1, 1)}" step="0.05" value="${probeHeight()}" id="probe-height" /><b class="mono">${fmt(probeHeight(), 2)} m</b></label>
    <span class="muted">Hover to trace from the source · click the floor to pin${pins.length ? ` · <button type="button" class="link-btn" id="clear-pins">clear ${pins.length} pin${pins.length > 1 ? 's' : ''}</button>` : ''}</span>`;
}
legend.box.addEventListener('input', (event) => {
  if (event.target.id !== 'probe-height') return;
  probeHeights[lens] = Number(event.target.value);
  viewport.probeHeight = probeHeights[lens];
  event.target.nextElementSibling.textContent = `${fmt(probeHeights[lens], 2)} m`;
  refreshPins();
});
legend.box.addEventListener('click', (event) => {
  if (event.target.id === 'clear-pins') { clearPins(); refreshLensFields(); }
});
function renderVolumeLegend() {
  if (!volumeField) return;
  showLegend(lens, lens === 'wifi' ? 'WiFi signal · ITU-R P.1238' : 'Sound pressure level', `${fmt(volumeField.min)} ${volumeField.unit}`, `${fmt(volumeField.max)} ${volumeField.unit}`,
    `Wavefronts fade as the ${lens === 'wifi' ? 'signal' : 'sound'} weakens · hover to measure`);
}
let luxMapOn = true;
function renderLightLegend() {
  if (!volumeField?.light) return;
  showLegend('light', 'Illuminance · lux', '50', '1500+',
    `<div class="segmented legend-toggle"><button type="button" data-luxmap="off" class="${luxMapOn ? '' : 'active'}">Rendered</button><button type="button" data-luxmap="on" class="${luxMapOn ? 'active' : ''}">Lux map</button></div>
    <span>Desk work wants 300–500 lux. ${fmt(volumeField.light.indirect)} lux in the middle of the room is light reflected off your walls, floor and ceiling.</span>`);
}
legend.box.addEventListener('click', (event) => {
  const toggle = event.target.closest('[data-luxmap]');
  if (!toggle) return;
  luxMapOn = toggle.dataset.luxmap === 'on';
  refreshLensFields();
});

function showSolverLayers() {
  for (const mode of SOLVER_LENSES) {
    if (lenses.has(mode) && solverResult) viewport.setLayer(mode, solverResult);
    else viewport.clearLayer(mode);
  }
}

let solverState = { loading: false, error: null };
function renderFieldState({ loading, result, error }) {
  solverState = { loading, error };
  $('#viewport').setAttribute('aria-busy', String(loading));
  if (loading || error) {
    solverResult = null;
    viewport.clearLayer('airflow');
    viewport.clearLayer('temperature');
  } else if (result) {
    solverResult = result;
    showSolverLayers();
    refreshPins();
  }
  fieldResult = SOLVER_LENSES.has(lens) ? solverResult : null;
  if (SOLVER_LENSES.has(lens)) renderSolverLegend();
  renderNarrator();
  renderModeInsights();
}

// The controller drives one solve; the app decides which layers show it.
function solverViewport() {
  return {
    setFields: (result) => renderFieldState({ loading: false, result, error: null }),
    clearFields: () => {},
    setLightingPreview: () => {},
  };
}

function renderSolverLegend() {
  const mode = lens;
  const { loading, error } = solverState;
  const result = solverResult;
  if (loading || (!result && !error)) {
    showLegend(mode, `${LENSES[mode]} · solving`, '', '', '<span class="spinner"></span> Running the 3D Navier–Stokes solver…');
    return;
  }
  if (error || !result) {
    showLegend(mode, LENSES[mode], '', '', `Unavailable${error?.message ? ` — ${escapeHtml(error.message)}` : ''}`);
    return;
  }
  const cellSize = result.grid.cellSize ?? Math.max(result.grid.dx, result.grid.dy, result.grid.dz);
  const backend = result.backend === 'webgpu' ? 'GPU' : 'CPU preview';
  const status = `${backend} · ${cellSize < 0.1 ? `${Math.round(cellSize * 100)} cm` : `${fmt(cellSize, 2)} m`} grid${lenses.size > 1 ? ` · also showing ${[...lenses].filter((item) => item !== mode).map((item) => LENSES[item]).join(', ')}` : ''}`;
  if (mode === 'airflow') showLegend(mode, 'Air speed · streaks follow the flow', '0 m/s', `${fmt(result.stats.maxSpeed, 2)} m/s`, status);
  else {
    const digits = result.stats.maxTemperature - result.ambientTemperature >= 1 ? 1 : 2;
    showLegend(mode, 'Air temperature', `${fmt(result.ambientTemperature, digits)} °C`, `${fmt(result.stats.maxTemperature, digits)} °C`, status);
  }
}

// Value under the cursor
function sampleVolume(result, point, field) {
  const { grid } = result;
  const i = Math.min(grid.nx - 1, Math.max(0, Math.floor(point.x / grid.dx)));
  const j = Math.min(grid.ny - 1, Math.max(0, Math.floor(point.y / grid.dy)));
  const k = Math.min(grid.nz - 1, Math.max(0, Math.floor(point.z / grid.dz)));
  const index = (j * grid.nz + k) * grid.nx + i;
  if (result.fields.solid?.[index]) return null;
  if (field === 'speed') return Math.hypot(result.fields.u[index], result.fields.v[index], result.fields.w[index]);
  return result.fields[field]?.[index] ?? null;
}

// ─── Probe: trace the level from the source to the cursor ─────────────────
const DEFAULT_PROBE_HEIGHT = { airflow: 1.1, temperature: 1.1, light: 0.75, wifi: 1.0, sound: 1.2 };
const probeHeights = {};
const probeHeight = () => Math.min(roomScene.room.height - 0.1, probeHeights[lens] ?? DEFAULT_PROBE_HEIGHT[lens] ?? 1);
const LENS_RAMPS = {
  wifi: [[0.86, 0.29, 0.25], [0.95, 0.66, 0.26], [0.45, 0.82, 0.48], [0.1, 0.62, 0.95]],
  sound: [[0.16, 0.2, 0.5], [0.62, 0.32, 0.72], [1, 0.55, 0.3], [1, 0.92, 0.62]],
  light: [[0.16, 0.12, 0.3], [0.95, 0.55, 0.22], [1, 0.86, 0.5], [1, 0.98, 0.9]],
  airflow: [[0.02, 0.22, 0.95], [0, 0.86, 1], [0.12, 0.92, 0.46], [1, 0.08, 0.02]],
  temperature: [[0, 0.65, 1], [1, 0.88, 0.03], [1, 0.12, 0.02], [1, 1, 1]],
};
function rampAt(ramp, t) {
  const scaled = Math.min(0.999, Math.max(0, t)) * (ramp.length - 1);
  const index = Math.floor(scaled);
  return ramp[index].map((value, channel) => value + (ramp[index + 1][channel] - value) * (scaled - index));
}

function lensSampler() {
  if (lens === 'wifi' && volumeField) return { unit: 'dBm', digits: 0, bands: WIFI_BANDS, sample: (point) => wifiAt(roomScene, point) };
  if (lens === 'sound' && volumeField) {
    const acoustics = roomAcoustics(roomScene);
    return { unit: 'dB', digits: 0, bands: SOUND_BANDS, sample: (point) => soundAt(roomScene, point, acoustics) };
  }
  if (lens === 'light' && volumeField?.light) return { unit: 'lux', digits: 0, bands: LIGHT_BANDS, log: true, sample: (point) => luxAt(volumeField.light, point) };
  if (lens === 'airflow' && fieldResult) return { unit: 'm/s', digits: 2, sample: (point) => sampleVolume(fieldResult, point, 'speed') };
  if (lens === 'temperature' && fieldResult) return { unit: '°C', digits: 1, sample: (point) => sampleVolume(fieldResult, point, 'temperature') };
  return null;
}

// Nearest thing that produces what the lens shows.
function nearestSource(point) {
  const kinds = { wifi: ['router'], sound: ['speaker'], light: ['lamp', 'deskLamp', 'ceilingLight'], airflow: ['fan', 'ac'], temperature: ['heater'] }[lens] ?? [];
  const candidates = roomScene.objects.filter((object) => kinds.includes(object.model)).map((object) => ({
    object,
    point: {
      x: object.position.x,
      z: object.position.z,
      y: object.model === 'ceilingLight' ? object.position.y - 0.03 : object.position.y + object.dimensions.height * ({ router: 0.9, speaker: 0.6, lamp: 0.75, deskLamp: 0.7, fan: 0.74, ac: 0.4, heater: 0.6 }[object.model] ?? 0.5),
    },
  }));
  return candidates.sort((a, b) => Math.hypot(a.point.x - point.x, a.point.z - point.z) - Math.hypot(b.point.x - point.x, b.point.z - point.z))[0] ?? null;
}

function describeValue(sampler, value) {
  const band = sampler.bands ? bandFor(sampler.bands, value) : null;
  if (lens === 'airflow') return value > 0.5 ? 'Strong breeze' : value > 0.2 ? 'You’d feel it' : value > 0.05 ? 'Gentle' : 'Still';
  if (lens === 'temperature') return `+${fmt(value - fieldResult.ambientTemperature, 1)} °C over baseline`;
  return band ? `${band.label} · ${band.hint}` : '';
}

function sparkline(profile, sampler) {
  const finite = profile.values.filter((entry) => entry.value !== null && Number.isFinite(entry.value));
  if (finite.length < 2) return '';
  const transform = (value) => (sampler.log ? Math.log10(Math.max(1, value)) : value);
  const values = finite.map((entry) => transform(entry.value));
  const low = Math.min(...values);
  const high = Math.max(...values);
  const span = Math.max(1e-6, high - low);
  const path = finite.map((entry, index) => `${index ? 'L' : 'M'}${(entry.distance / profile.length * 196 + 2).toFixed(1)},${(40 - (transform(entry.value) - low) / span * 34).toFixed(1)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 200 46" aria-hidden="true"><path d="${path}" /><circle cx="198" cy="${(40 - (values.at(-1) - low) / span * 34).toFixed(1)}" r="3" /></svg>
    <div class="spark-axis"><span>source</span><span>${fmt(profile.length, 2)} m</span></div>`;
}

function renderProbe(point) {
  const probe = $('#probe');
  if (!point || !lens || isDragging) {
    probe.hidden = true;
    viewport.setProbeLine(null);
    return;
  }
  const sampler = lensSampler();
  if (!sampler) { probe.hidden = true; return; }
  const at = { x: point.x, z: point.z, y: probeHeight() };
  const value = sampler.sample(at);
  if (value === null || !Number.isFinite(value)) { probe.hidden = true; viewport.setProbeLine(null); return; }
  const source = nearestSource(at);
  let trace = '';
  if (source) {
    const profile = profileAlong(source.point, at, sampler.sample, 40);
    const finite = profile.values.map((entry) => entry.value).filter((entry) => entry !== null && Number.isFinite(entry));
    const transform = (entry) => (sampler.log ? Math.log10(Math.max(1, entry)) : entry);
    const low = Math.min(...finite.map(transform));
    const high = Math.max(...finite.map(transform));
    viewport.setProbeLine(source.point, at, profile.values.map((entry) => rampAt(LENS_RAMPS[lens], entry.value === null ? 0 : (transform(entry.value) - low) / Math.max(1e-6, high - low))));
    trace = `${sparkline(profile, sampler)}<small>${fmt(profile.length, 2)} m from ${escapeHtml(source.object.name)}</small>`;
  } else viewport.setProbeLine(null);
  probe.innerHTML = `<div class="probe-value"><strong>${fmt(value, sampler.digits)} ${sampler.unit}</strong><span>${describeValue(sampler, value)}</span></div>${trace}<small class="probe-hint">at ${fmt(at.y, 2)} m · click to pin</small>`;
  const bounds = $('#viewport').getBoundingClientRect();
  const x = Math.min(point.clientX - bounds.left + 18, bounds.width - 240);
  const y = Math.min(point.clientY - bounds.top + 18, bounds.height - 150);
  probe.style.transform = `translate(${x}px, ${y}px)`;
  probe.hidden = false;
}

// ─── Pins: measurements that stay put and update live ─────────────────────
let pins = [];
function addPin(point) {
  if (!lens || !point || !lensSampler()) return false;
  pins.push({ id: `pin${Date.now()}`, x: point.x, z: point.z });
  refreshPins();
  if (pins.length === 1) toast('Pinned. Move furniture or sources and watch the number change.');
  return true;
}
function clearPins() {
  pins = [];
  for (const element of $$('.pin')) element.remove();
}
function refreshPins() {
  const sampler = lensSampler();
  for (const pin of pins) {
    let element = $(`#${pin.id}`);
    if (!element) {
      element = document.createElement('button');
      element.type = 'button';
      element.className = 'pin';
      element.id = pin.id;
      element.title = 'Click to remove';
      element.addEventListener('click', () => { pins = pins.filter((item) => item.id !== pin.id); element.remove(); });
      $('#viewport').append(element);
    }
    const value = sampler?.sample({ x: pin.x, z: pin.z, y: probeHeight() });
    element.textContent = value === null || value === undefined || !Number.isFinite(value) ? '—' : `${fmt(value, sampler.digits)} ${sampler.unit}`;
  }
  positionPins();
}
function positionPins() {
  for (const pin of pins) {
    const element = $(`#${pin.id}`);
    const screen = viewport.projectRoomPoint({ x: pin.x, z: pin.z, y: probeHeight() });
    if (!element || !screen) continue;
    element.hidden = !screen.visible;
    element.style.transform = `translate(${Math.round(screen.x)}px, ${Math.round(screen.y)}px) translate(-50%, -100%)`;
  }
}

$('#viewport').addEventListener('pointerleave', () => { $('#probe').hidden = true; viewport?.setProbeLine(null); });

// ─── Sun ──────────────────────────────────────────────────────────────────
let sunPlaying = null;
function renderSunDock() {
  const environment = environmentOf(project);
  $('#sun-hour').value = environment.hour;
  $('#sun-time').textContent = formatHour(environment.hour);
  const { sun, walls } = sunlitWalls(environment);
  $('#sun-info').textContent = sun.altitude > 0 ? `Sun ${fmt(sun.altitude)}° high in the ${compassLabel(sun.azimuth)}${walls.length ? ` · on the ${walls.join(' & ')} wall${walls.length > 1 ? 's' : ''}` : ''}` : 'Night';
  // The lamps switch reads as on whenever the lamps are lit, whether dusk
  // turned them on or the user did. Only the explanation differs.
  const lampsOn = viewport?.lampsOnState() ?? true;
  const manual = viewport?.lampsOverride !== null && viewport?.lampsOverride !== undefined;
  const lampsButton = $('#lamps-toggle');
  lampsButton.classList.toggle('active', lampsOn);
  lampsButton.setAttribute('aria-pressed', String(lampsOn));
  lampsButton.setAttribute('aria-label', lampsOn ? 'Switch the lamps off' : 'Switch the lamps on');
  lampsButton.title = `Lamps ${lampsOn ? 'on' : 'off'}${manual ? ', set by hand' : ', following dusk'}. Click to switch them ${lampsOn ? 'off' : 'on'}.`;
}
$('#lamps-toggle').addEventListener('click', () => {
  // A plain on/off switch. It flips whatever the lamps are doing now, so it can
  // switch them off at night as well as on during the day; the dusk threshold
  // only decides the state until the first click.
  viewport.setLampsOverride(!viewport.lampsOnState());
  renderSunDock();
  scheduleLensFrame();
});
function setHour(hour) {
  project = { ...project, environment: { ...environmentOf(project), hour } };
  viewport.setEnvironment(environmentOf(project));
  renderSunDock();
  renderChips();
  scheduleLensFrame();
  scheduleSave();
}
$('#sun-hour').addEventListener('input', (event) => setHour(Number(event.target.value)));
function toggleSunPlay() {
  if (sunPlaying) {
    cancelAnimationFrame(sunPlaying);
    sunPlaying = null;
    $('#sun-play').textContent = '▶';
    return;
  }
  $('#sun-play').textContent = '❚❚';
  let last = performance.now();
  const step = (time) => {
    const hour = environmentOf(project).hour + (time - last) / 1000;
    last = time;
    setHour(hour > 20 ? 5 : Number(hour.toFixed(3)));
    sunPlaying = requestAnimationFrame(step);
  };
  sunPlaying = requestAnimationFrame(step);
}
$('#sun-play').addEventListener('click', toggleSunPlay);

// ─── Sheet: insights, room, site ──────────────────────────────────────────
function openSheet(panel, { toggle = true } = {}) {
  const sheet = $('#sheet');
  if (toggle && !sheet.hidden && sheet.dataset.panel === panel) { closeSheet(); return; }
  sheet.hidden = false;
  sheet.dataset.panel = panel;
  $('#editor').classList.add('sheet-open');
  updateInsets();
  for (const item of $$('.sheet-panel')) item.hidden = item.dataset.panel !== panel;
  for (const tab of $$('.sheet-tabs [data-sheet]')) tab.classList.toggle('active', tab.dataset.sheet === panel);
  if (panel === 'insights') { renderLayoutReport(); renderModeInsights(); }
  app.onSheet?.forEach((handler) => handler(panel));
  positionCard();
}
app.openSheet = openSheet;
app.onSheet = [];
function closeSheet() {
  $('#sheet').hidden = true;
  $('#editor').classList.remove('sheet-open');
  updateInsets();
}
document.addEventListener('click', (event) => {
  const trigger = event.target.closest('[data-sheet]');
  if (!trigger || $('#editor').hidden) return;
  openSheet(trigger.dataset.sheet, { toggle: !trigger.closest('.sheet-tabs') });
});

let layoutTimer = null;
function scheduleLayoutReport() {
  clearTimeout(layoutTimer);
  layoutTimer = setTimeout(renderLayoutReport, 220);
}
const scoreTone = (score) => (score >= 85 ? 'good' : score >= 60 ? 'ok' : 'bad');
function scoreRing(score) {
  const circumference = 2 * Math.PI * 22;
  return `<svg class="score-ring ${scoreTone(score)}" viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="22" class="track"/><circle cx="26" cy="26" r="22" class="value" stroke-dasharray="${circumference}" stroke-dashoffset="${circumference * (1 - score / 100)}"/><text x="26" y="31">${score}</text></svg>`;
}
app.scoreRing = scoreRing;
function issueList(report) {
  return `${report.issues.length ? `<ul class="issue-list">${report.issues.map((issue) => `<li class="issue ${issue.severity}" ${issue.objectId ? `data-issue-object="${escapeHtml(issue.objectId)}" tabindex="0" role="button"` : ''}><span class="dot"></span>${escapeHtml(issue.text)}</li>`).join('')}</ul>`
    : '<p class="ok-line">Nothing to fix — this room works.</p>'}
    ${report.wins.length ? `<ul class="win-list">${report.wins.slice(0, 5).map((win) => `<li>✓ ${escapeHtml(win)}</li>`).join('')}</ul>` : ''}`;
}
function renderLayoutReport() {
  if (!roomScene) return;
  layoutReport = evaluateLayout(roomScene, { environment: environmentOf(project), weather });
  const score = layoutReport.score;
  $('#orb-score').textContent = score;
  const orb = $('#orb-value');
  orb.style.strokeDashoffset = String(100.5 * (1 - score / 100));
  orb.style.stroke = `var(--${score >= 85 ? 'good' : score >= 60 ? 'warn' : 'bad'})`;
  const filtered = categoryFilter ? { ...layoutReport, issues: layoutReport.issues.filter((issue) => issue.category === categoryFilter) } : layoutReport;
  $('#layout-report').innerHTML = `
    <div class="score-row">${scoreRing(score)}<div><strong>${score >= 85 ? 'Easy to live in' : score >= 60 ? 'Workable, with snags' : 'Hard to live in'}</strong>
      <span>${Math.round(layoutReport.openFloor * 100)}% of the floor is walkable at 60 cm</span></div></div>
    <div class="category-grid">${Object.entries(layoutReport.categories).map(([key, category]) => `
      <button type="button" class="category ${categoryFilter === key ? 'active' : ''} ${scoreTone(category.score)}" data-category="${key}" title="${category.issues} issue${category.issues === 1 ? '' : 's'}">
        <span class="category-icon">${category.icon}</span><span class="category-label">${category.label}</span>
        <span class="category-bar"><i style="width:${category.score}%"></i></span><b class="mono">${category.score}</b></button>`).join('')}</div>
    ${categoryFilter ? `<p class="note">Showing ${layoutReport.categories[categoryFilter].label.toLowerCase()} only · <button type="button" class="link-btn" data-category="">show all</button></p>` : ''}
    ${issueList(filtered)}`;
  renderOutline();
  if (!lens) renderNarrator();
}
let categoryFilter = '';
$('#layout-report').addEventListener('click', (event) => {
  const category = event.target.closest('[data-category]');
  if (!category) return;
  categoryFilter = categoryFilter === category.dataset.category ? '' : category.dataset.category;
  renderLayoutReport();
});

function selectFromIssue(event) {
  const item = event.target.closest('[data-issue-object]');
  if (item) select(item.dataset.issueObject);
}
$('#layout-report').addEventListener('click', selectFromIssue);
$('#suggest-body').addEventListener('click', selectFromIssue);

function spotsTable(spots, unit, bands, digits = 0) {
  if (!spots.length) return '<p>Add a bed, desk or sofa to see values where people sit.</p>';
  return `<table class="spot-table">${spots.map((spot) => `<tr><td>${escapeHtml(spot.object.name)}</td><td class="num">${fmt(spot.value, digits)} ${unit}</td><td><span class="band">${bandFor(bands, spot.value).label}</span></td></tr>`).join('')}</table>`;
}

function renderModeInsights() {
  const body = $('#mode-insights');
  if (!roomScene) return;
  $('#mode-insight-title').textContent = lens ? `${LENSES[lens]} lens` : 'Lens';
  if (!lens) {
    body.innerHTML = '<p>Pick a lens at the top (keys 1–5) to see what it means for this room.</p>';
    return;
  }
  const environment = environmentOf(project);
  if (lens === 'wifi' && planeField?.values) {
    const finite = [...planeField.values].filter(Number.isFinite);
    const counts = WIFI_BANDS.map((band, index) => ({ band, count: finite.filter((value) => value >= band.min && (index === 0 || value < WIFI_BANDS[index - 1].min)).length }));
    body.innerHTML = `<div class="band-bar">${counts.filter((entry) => entry.count).map((entry) => `<span class="b-${entry.band.label.toLowerCase().replace(' ', '-')}" style="flex:${entry.count}" title="${entry.band.label}"></span>`).join('')}</div>
      ${spotsTable(sampleListeningSpots(roomScene, 'wifi'), 'dBm', WIFI_BANDS)}
      <p>ITU-R P.1238 indoor path loss (residential, distance power-loss coefficient 28) plus each object's penetration loss on the direct path: metal ≈ 22 dB, stone 12, wood 3, fabric 2.</p>`;
  } else if (lens === 'sound') {
    const acoustics = roomAcoustics(roomScene);
    const rt = acoustics.rt60;
    const verdict = rt < 0.35 ? 'Very absorbent: speech is clear, music sounds flat.' : rt < 0.7 ? 'A comfortable living-room range.' : rt < 1.1 ? 'Some echo. A rug, curtains or a fabric sofa will calm it.' : 'Hard surfaces dominate. Add soft furnishings or acoustic panels.';
    body.innerHTML = `<div class="metric-row"><div class="metric"><span class="metric-value">${fmt(rt, 2)} s</span><span class="metric-label">Echo (RT60)</span></div><div class="metric"><span class="metric-value">${fmt(acoustics.absorption, 1)}</span><span class="metric-label">Absorption m²</span></div><div class="metric"><span class="metric-value">${Math.round(acoustics.meanAbsorption * 100)}%</span><span class="metric-label">Avg absorb</span></div></div>
      <p>${verdict}</p>${spotsTable(sampleListeningSpots(roomScene, 'sound'), 'dB', SOUND_BANDS)}
      <p>${acoustics.formula} reverberation from floor, wall and furniture materials. Level = direct field (with barrier loss behind objects) + diffuse field 4/R.</p>`;
  } else if (lens === 'light') {
    const { sun } = sunlitWalls(environment);
    const context = planeField?.light ?? lightContext(roomScene, environment, weather?.cloudCover);
    body.innerHTML = `<div class="metric-row"><div class="metric"><span class="metric-value">${sun.altitude > 0 ? `${fmt(sun.altitude)}°` : '—'}</span><span class="metric-label">Sun height</span></div><div class="metric"><span class="metric-value">${fmt(context.indirect)}</span><span class="metric-label">Bounce lux</span></div><div class="metric"><span class="metric-value">${Math.round(context.reflectance * 100)}%</span><span class="metric-label">Reflectance</span></div></div>
      ${spotsTable(sampleListeningSpots(roomScene, 'light', context), 'lux', LIGHT_BANDS)}
      <p>Point-source lamps (inverse-square and cosine law, shadowed), direct sun through glass (70% transmission), sky light through windows, and the lumen-method inter-reflection from your finishes. Desk work wants 300–500 lux (EN 12464-1).</p>`;
  } else if (lens === 'airflow') {
    const people = environment.people ?? 1;
    const air = ventilation(roomScene, { windSpeed: weather?.windSpeed ?? null, people });
    const verdict = air.litresPerPerson >= 10 ? 'Plenty of fresh air.' : air.litresPerPerson >= 5 ? 'Adequate fresh air.' : 'Stuffy — open a window, ideally on two walls for a cross-breeze.';
    const seats = roomScene.objects.filter((object) => ['bed', 'desk', 'sofa', 'chair'].includes(object.model));
    const rows = fieldResult ? seats.map((object) => {
      const speed = sampleVolume(fieldResult, { x: object.position.x, y: Math.min(1.1, object.position.y + object.dimensions.height + 0.25), z: object.position.z }, 'speed');
      return `<tr><td>${escapeHtml(object.name)}</td><td class="num">${speed === null ? '—' : `${fmt(speed, 2)} m/s`}</td><td><span class="band">${speed === null ? '' : speed > 0.2 ? 'Breezy' : speed > 0.05 ? 'Gentle' : 'Still'}</span></td></tr>`;
    }).join('') : '';
    body.innerHTML = `<div class="metric-row"><div class="metric"><span class="metric-value">${fmt(air.ach, 1)}</span><span class="metric-label">Air changes / h</span></div><div class="metric"><span class="metric-value">${Number.isFinite(air.litresPerPerson) ? fmt(air.litresPerPerson) : '—'}</span><span class="metric-label">L/s per person</span></div><div class="metric"><span class="metric-value">${air.co2}</span><span class="metric-label">CO₂ ppm (est.)</span></div></div>
      <p>${verdict} ${air.mode === 'cross' ? 'Cross-ventilation between two walls.' : air.mode === 'single' ? 'Single-sided ventilation — far weaker than cross.' : 'All openings closed; only leakage.'} Wind ${air.assumedWind ? 'assumed 2 m/s — fetch live weather in Site' : `${fmt(weather.windSpeed, 1)} m/s live`}, ${people} ${people === 1 ? 'person' : 'people'}.</p>
      ${rows ? `<table class="spot-table">${rows}</table>` : ''}
      <p>Air speeds from the 3D incompressible Navier–Stokes solve; fresh-air rate from the BS 5925 natural-ventilation formulas; CO₂ from a steady-state mass balance.</p>`;
  } else if (lens === 'temperature' && fieldResult) {
    const seats = roomScene.objects.filter((object) => ['bed', 'desk', 'sofa', 'chair'].includes(object.model));
    body.innerHTML = `<div class="metric-row"><div class="metric"><span class="metric-value">${fmt(fieldResult.stats.maxTemperature, 1)}°</span><span class="metric-label">Hottest</span></div><div class="metric"><span class="metric-value">${fmt(fieldResult.stats.meanTemperature ?? fieldResult.ambientTemperature, 1)}°</span><span class="metric-label">Average</span></div></div>
      <table class="spot-table">${seats.map((object) => {
        const temperature = sampleVolume(fieldResult, { x: object.position.x, y: Math.min(1.1, object.position.y + object.dimensions.height + 0.25), z: object.position.z }, 'temperature');
        return `<tr><td>${escapeHtml(object.name)}</td><td class="num">${temperature === null ? '—' : `${fmt(temperature, 1)} °C`}</td></tr>`;
      }).join('')}</table>
      <p>Heaters inject their watts as heat (P / ρcₚ into the plume), warm air rises by Boussinesq buoyancy, is carried by the flow and leaves through open windows. Baseline ${fmt(fieldResult.ambientTemperature, 1)} °C is set in Site.</p>`;
  } else {
    body.innerHTML = '<p><span class="spinner"></span> Working…</p>';
  }
}

// Room sheet
function renderRoomSheet() {
  for (const axis of ['width', 'depth', 'height']) {
    const input = $(`#room-${axis}`);
    if (document.activeElement !== input) input.value = roomScene.room[axis];
  }
  const shape = roomShape(roomScene.room);
  $('#shape-picker').innerHTML = Object.entries(ROOM_SHAPES).map(([key, label]) => `<button type="button" class="shape-option ${shape.type === key ? 'active' : ''}" data-shape="${key}"><svg viewBox="0 0 40 30">${SHAPE_ICONS[key]}</svg>${label.split(' /')[0]}</button>`).join('');
  $('#shape-params').innerHTML = shape.type === 'L'
    ? `<label class="field"><span>Cut W</span><input class="mono" type="number" step="0.1" min="0.5" data-shape-param="cutWidth" value="${fmt(shape.cutWidth, 2)}" /></label><label class="field"><span>Cut D</span><input class="mono" type="number" step="0.1" min="0.5" data-shape-param="cutDepth" value="${fmt(shape.cutDepth, 2)}" /></label>`
    : shape.type === 'rounded'
      ? `<label class="field" style="grid-column: span 2"><span>Corner radius</span><input class="mono" type="number" step="0.1" min="0.1" data-shape-param="radius" value="${fmt(shape.radius, 2)}" /></label>`
      : '';
  if (!$('#floor-material').options.length) {
    $('#floor-material').innerHTML = Object.entries(SURFACE_MATERIALS.floor).map(([key, value]) => `<option value="${key}">${value.label}</option>`).join('');
    $('#wall-material').innerHTML = Object.entries(SURFACE_MATERIALS.walls).map(([key, value]) => `<option value="${key}">${value.label}</option>`).join('');
  }
  const surfaces = sceneSurfaces(roomScene);
  $('#floor-material').value = surfaces.floor;
  $('#wall-material').value = surfaces.walls;
  app.onRoomSheet?.forEach((handler) => handler());
}
app.onRoomSheet = [];
for (const axis of ['width', 'depth', 'height']) {
  $(`#room-${axis}`).addEventListener('change', (event) => {
    try { apply(resizeRoom(roomScene, { [axis]: Number(event.target.value) })); } catch (error) {
      event.target.value = roomScene.room[axis];
      toast(error.message, { tone: 'warn' });
    }
  });
}
$('#shape-picker').addEventListener('click', (event) => {
  const option = event.target.closest('[data-shape]');
  if (!option) return;
  const type = option.dataset.shape;
  const { width, depth } = roomScene.room;
  const shape = type === 'L' ? { type, cutWidth: +(width * 0.4).toFixed(2), cutDepth: +(depth * 0.4).toFixed(2) } : type === 'rounded' ? { type, radius: +(Math.min(width, depth) * 0.25).toFixed(2) } : { type };
  apply(setRoomShape(roomScene, shape));
});
$('#shape-params').addEventListener('change', (event) => {
  const input = event.target.closest('[data-shape-param]');
  if (input) apply(setRoomShape(roomScene, { ...roomShape(roomScene.room), [input.dataset.shapeParam]: Number(input.value) }));
});
$('#floor-material').addEventListener('change', (event) => apply(setSurfaceMaterial(roomScene, 'floor', event.target.value)));
$('#wall-material').addEventListener('change', (event) => apply(setSurfaceMaterial(roomScene, 'walls', event.target.value)));

// Site sheet
function renderSiteSheet() {
  const environment = environmentOf(project);
  if (!$('#env-city').options.length) {
    $('#env-city').innerHTML = CITIES.map((city) => `<option value="${city.id}">${city.label}</option>`).join('');
    $('#env-bearing').innerHTML = [0, 45, 90, 135, 180, 225, 270, 315].map((bearing) => `<option value="${bearing}">${compassLabel(bearing)}</option>`).join('');
  }
  $('#env-city').value = environment.city;
  $('#env-bearing').value = String(environment.backWallBearing);
  $('#env-month').value = environment.month;
  $('#env-day').value = environment.day;
  $('#env-baseline').value = environment.baselineTemperature;
  $('#env-people').value = environment.people ?? 1;
  const bearings = wallBearings(environment.backWallBearing);
  $('#compass').innerHTML = `<div class="compass-room"><span class="w back">Back · ${compassLabel(bearings.back)}</span><span class="w front">Front · ${compassLabel(bearings.front)}</span><span class="w left">${compassLabel(bearings.left)}</span><span class="w right">${compassLabel(bearings.right)}</span></div>`;
  renderWeather();
}
function updateEnvironment(patch) {
  project = { ...project, environment: { ...environmentOf(project), ...patch } };
  viewport.setEnvironment(environmentOf(project));
  pushSolverScene();
  renderSiteSheet();
  renderChips();
  if (lens === 'light') renderSunDock();
  scheduleLensFrame();
  scheduleLayoutReport();
  scheduleSave();
}
app.updateEnvironment = updateEnvironment;
$('#env-city').addEventListener('change', (event) => {
  const city = CITIES.find((item) => item.id === event.target.value);
  weather = null;
  updateEnvironment({ city: city.id, lat: city.lat, lon: city.lon, tz: city.tz });
});
$('#env-bearing').addEventListener('change', (event) => updateEnvironment({ backWallBearing: Number(event.target.value) }));
$('#env-month').addEventListener('change', (event) => updateEnvironment({ month: Math.min(12, Math.max(1, Number(event.target.value) || 1)) }));
$('#env-day').addEventListener('change', (event) => updateEnvironment({ day: Math.min(31, Math.max(1, Number(event.target.value) || 1)) }));
$('#env-people').addEventListener('change', (event) => updateEnvironment({ people: Math.min(12, Math.max(0, Math.round(Number(event.target.value) || 0))) }));
$('#env-baseline').addEventListener('change', (event) => updateEnvironment({ baselineTemperature: Math.min(40, Math.max(0, Number(event.target.value) || 20)) }));

function renderWeather() {
  if (!weather) return;
  const environment = environmentOf(project);
  const windward = windwardWall(environment, weather.windFrom);
  const openings = roomScene.objects.filter((object) => isWallItem(object) && object.wall === windward);
  $('#weather').innerHTML = `<div class="metric-row">
      <div class="metric"><span class="metric-value">${fmt(weather.temperature, 1)}°</span><span class="metric-label">Outside</span></div>
      <div class="metric"><span class="metric-value">${fmt(weather.windSpeed, 1)}</span><span class="metric-label">m/s from ${compassLabel(weather.windFrom)}</span></div>
      <div class="metric"><span class="metric-value">${weather.cloudCover}%</span><span class="metric-label">Cloud</span></div></div>
    <p class="note">${weather.windSpeed < 0.5 ? 'Almost still. Fans and temperature differences do the ventilating.'
      : openings.length ? `Wind hits your <b>${windward}</b> wall, where ${openings.map((item) => escapeHtml(item.name)).join(', ')} ${openings.length > 1 ? 'are' : 'is'}. Open it and one on another wall for a cross-breeze.`
        : `Wind hits your <b>${windward}</b> wall, which has no opening.`}</p>
    <button class="btn" type="button" id="use-outdoor">Use ${fmt(weather.temperature, 1)} °C as baseline</button>`;
  $('#use-outdoor').addEventListener('click', () => updateEnvironment({ baselineTemperature: Math.round(weather.temperature * 2) / 2 }));
}
$('#weather-refresh').addEventListener('click', async () => {
  $('#weather').innerHTML = '<span class="muted"><span class="spinner"></span> Fetching…</span>';
  try {
    weather = await fetchWeather(environmentOf(project));
    renderWeather();
    scheduleLensFrame();
  } catch (error) {
    $('#weather').innerHTML = `<span class="muted">${escapeHtml(error.message || 'Weather unavailable offline.')}</span>`;
  }
});

// ─── Camera ───────────────────────────────────────────────────────────────
function setTransformMode(mode) {
  transformMode = mode;
  viewport.setMode(mode);
  $('#mode-move').classList.toggle('active', mode === 'translate');
  $('#mode-rotate').classList.toggle('active', mode === 'rotate');
}
$('#mode-move').addEventListener('click', () => setTransformMode('translate'));
$('#mode-rotate').addEventListener('click', () => setTransformMode('rotate'));
function syncViewButtons(view = viewport.isTopView ? 'top' : '3d') {
  const pressed = (id, value) => { $(id).classList.toggle('active', value); $(id).setAttribute('aria-pressed', String(value)); };
  pressed('#view-3d', view === '3d');
  pressed('#view-top', view === 'top');
  pressed('#projection-perspective', viewport.projection === 'perspective');
  pressed('#projection-orthographic', viewport.projection === 'orthographic');
}
function setCameraView(view) {
  viewport.setViewAnimated(view);
  syncViewButtons(view);
}
$('#view-3d').addEventListener('click', () => setCameraView('3d'));
$('#view-top').addEventListener('click', () => setCameraView('top'));
$('#projection-perspective').addEventListener('click', () => { viewport.setProjection('perspective'); syncViewButtons(); });
$('#projection-orthographic').addEventListener('click', () => {
  viewport.setProjection(viewport.projection === 'orthographic' ? 'perspective' : 'orthographic');
  syncViewButtons();
});
$('#view-home').addEventListener('click', () => { viewport.setProjection('perspective'); setCameraView('3d'); });

// ─── Context menu ─────────────────────────────────────────────────────────
function openContextMenu({ objectId, clientX, clientY }) {
  const menu = $('#context-menu');
  const object = roomScene.objects.find((item) => item.id === objectId);
  const items = object ? [
    isWallItem(object) ? ['toggle-open', object.open ? 'Close' : 'Open', 'Space'] : null,
    isWallItem(object) ? null : ['rotate-90', 'Rotate 90°', ']'],
    ['duplicate', 'Duplicate', `${mod}D`],
    isWallItem(object) ? null : ['lock', object.locked ? 'Unlock' : 'Lock in place', 'K'],
    ['delete', 'Delete', '⌫', 'danger'],
  ] : [
    ['frame', 'Frame room', 'F'], ['top', 'Top view', 'T'], ['room', 'Room size & shape…', ''], ['suggest', 'Suggest a better layout', ''],
  ];
  menu.innerHTML = items.filter(Boolean).map(([action, label, keys, tone]) => `<button type="button" class="${tone ?? ''}" data-context="${action}"><span>${label}</span>${keys ? `<kbd>${keys}</kbd>` : ''}</button>`).join('');
  menu.hidden = false;
  const bounds = $('#editor').getBoundingClientRect();
  menu.style.left = `${Math.min(clientX - bounds.left, bounds.width - 210)}px`;
  menu.style.top = `${Math.min(clientY - bounds.top, bounds.height - menu.offsetHeight - 10)}px`;
}
$('#context-menu').addEventListener('click', (event) => {
  const action = event.target.closest('[data-context]')?.dataset.context;
  $('#context-menu').hidden = true;
  ({
    'toggle-open': () => toggleOpen(), 'rotate-90': () => spin(90), duplicate: duplicateSelected, lock: toggleLock, delete: deleteSelected,
    frame: () => $('#view-home').click(), top: () => setCameraView('top'), room: () => openSheet('room', { toggle: false }), suggest: runSuggestion,
  })[action]?.();
});

// ─── Layout suggestion ────────────────────────────────────────────────────
let suggestion = null;
let suggestRun = 0;
async function runSuggestion() {
  const dialog = $('#suggest-dialog');
  if (!dialog.open) dialog.showModal();
  const run = ++suggestRun;
  $('#suggest-apply').disabled = true;
  const locked = roomScene.objects.filter((object) => object.locked).length;
  $('#suggest-body').innerHTML = `<p class="muted">Trying arrangements that keep walkways, the door swing and windows clear${locked ? `, leaving ${locked} locked object${locked > 1 ? 's' : ''} alone` : ''}…</p><div class="progress"><span id="suggest-progress"></span></div>`;
  const result = await suggestLayout(roomScene, {
    environment: environmentOf(project),
    weather,
    seed: Date.now() + run,
    isCancelled: () => run !== suggestRun || !dialog.open,
    onProgress: (fraction) => { const bar = $('#suggest-progress'); if (bar) bar.style.width = `${Math.round(fraction * 100)}%`; },
  });
  if (run !== suggestRun || !dialog.open) return;
  suggestion = result;
  const moved = result.scene.objects.filter((object, index) => JSON.stringify(object) !== JSON.stringify(roomScene.objects[index]));
  $('#suggest-body').innerHTML = `<div class="compare"><div>${scoreRing(result.before.score)}<span class="muted">Now</span></div><span class="arrow">→</span><div>${scoreRing(result.after.score)}<span class="muted">Suggested</span></div></div>
    ${result.improved ? `<p>Moves ${moved.length}: ${moved.map((object) => escapeHtml(object.name)).join(', ')}.</p>${issueList(result.after)}` : '<p>Your layout is already as good as anything found. Try again, or unlock objects.</p>'}`;
  $('#suggest-apply').disabled = !result.improved;
}
$('#suggest-apply').addEventListener('click', () => {
  if (!suggestion?.improved) return;
  apply(suggestion.scene);
  $('#suggest-dialog').close();
  toast('Layout applied', { action: 'Undo', onAction: undo });
});
$('#suggest-again').addEventListener('click', runSuggestion);

// ─── Photos ───────────────────────────────────────────────────────────────
const photoPanel = createRoomPhotoPanel({
  mount: $('#editor'),
  onApply(dimensions) {
    try {
      apply(resizeRoom(roomScene, dimensions));
      photoPanel.close();
      toast('Room size set from your photo', { action: 'Undo', onAction: undo });
    } catch (error) { toast(error.message, { tone: 'warn' }); }
  },
});

let detections = [];
function openFurniturePhoto() {
  $('#furniture-dialog').showModal();
  loadDetector().catch(() => {});
}
async function handleFurniturePhoto(file) {
  if (!file?.type.startsWith('image/')) return;
  const image = new Image();
  image.src = URL.createObjectURL(file);
  await image.decode();
  $('#furniture-preview').replaceChildren(image);
  $('#furniture-results').innerHTML = '<p class="muted"><span class="spinner"></span> Looking for furniture (the first run downloads the models)…</p>';
  try {
    detections = await detectFurniture(image);
    // A close shot of one item often has no "objects" for the detector; ask the
    // whole-photo classifier instead.
    if (!detections.length) detections = (await classifyFurniture(image)).slice(0, 3).map((item, index) => ({ ...item, checked: index === 0 }));
  } catch (error) {
    $('#furniture-results').innerHTML = `<p class="warn-text">${escapeHtml(error.message)}</p>`;
    return;
  }
  for (const [index, detection] of detections.entries()) {
    if (detection.whole) continue;
    const box = document.createElement('span');
    box.className = 'detect-box';
    Object.assign(box.style, { left: `${detection.box.x * 100}%`, top: `${detection.box.y * 100}%`, width: `${detection.box.w * 100}%`, height: `${detection.box.h * 100}%` });
    box.textContent = `${index + 1}`;
    $('#furniture-preview').append(box);
  }
  const options = (selected) => Object.entries(MODEL_PRESETS).filter(([, preset]) => !preset.wall).map(([key, preset]) => `<option value="${key}" ${key === selected ? 'selected' : ''}>${escapeHtml(preset.label)}</option>`).join('');
  if (!detections.length) detections = [{ model: 'table', detectedAs: 'unknown', confidence: 0, box: { x: 0.3, y: 0.3, w: 0.4, h: 0.4 }, whole: true }];
  $('#furniture-results').innerHTML = `<p class="note">${detections[0].confidence === 0 ? 'Couldn’t recognise it — pick what it is:' : detections[0].whole ? 'Best guesses for the main object — keep the right one:' : `Found ${detections.length}. Fix any type, untick mistakes:`}</p>${detections.map((detection, index) => `
      <label class="detect-row"><input type="checkbox" ${detection.checked === false ? '' : 'checked'} data-detection="${index}" /> ${detection.whole ? '' : `${index + 1}.`}
      <select class="select" data-detection-model="${index}">${options(detection.model)}</select>
      ${detection.confidence ? `<span class="muted">${escapeHtml(detection.detectedAs)} · ${Math.round(detection.confidence * 100)}%</span>` : ''}</label>`).join('')}`;
  $('#furniture-add').disabled = false;
  furnitureImage = image;
}
let furnitureImage = null;
$('#furniture-file').addEventListener('change', (event) => handleFurniturePhoto(event.target.files[0]));
$('#furniture-drop').addEventListener('dragover', (event) => { event.preventDefault(); event.currentTarget.classList.add('over'); });
$('#furniture-drop').addEventListener('dragleave', (event) => event.currentTarget.classList.remove('over'));
$('#furniture-drop').addEventListener('drop', (event) => {
  event.preventDefault();
  event.currentTarget.classList.remove('over');
  handleFurniturePhoto(event.dataTransfer.files[0]);
});
$('#furniture-add').addEventListener('click', () => {
  const chosen = $$('[data-detection]').filter((input) => input.checked).map((input) => {
    const index = Number(input.dataset.detection);
    const model = $(`[data-detection-model="${index}"]`).value;
    // Read proportions, colours and leg style from the photo itself.
    const silhouette = furnitureImage ? analyseSilhouette(furnitureImage, detections[index].whole ? undefined : detections[index].box) : null;
    return { ...detections[index], model, shape: shapeFromSilhouette(model, silhouette) };
  });
  let scene = roomScene;
  for (const placement of placementsFromDetections(chosen, roomScene.room)) {
    try { scene = addObject(scene, placement).scene; } catch { /* skip what can't fit */ }
  }
  apply(scene);
  $('#furniture-dialog').close();
  toast(`Added ${chosen.length} — check sizes in each card`, { action: 'Undo', onAction: undo, timeout: 6000 });
});
for (const dialog of $$('dialog')) {
  dialog.addEventListener('click', (event) => {
    if (event.target.closest('[data-close]') || event.target === dialog) dialog.close();
  });
}

// ─── New / import / export ────────────────────────────────────────────────
function openNewDialog() {
  $('#new-name').value = '';
  $('#new-templates').innerHTML = TEMPLATES.map((template, index) => `<label class="template-option"><input type="radio" name="template" value="${template.id}" ${index === 1 ? 'checked' : ''} /><span><strong>${templateGlyph(template.id)} ${escapeHtml(template.label)}</strong><small>${escapeHtml(template.description)}</small></span></label>`).join('');
  $('#new-dialog').showModal();
}
$('#new-dialog').addEventListener('close', () => {
  if ($('#new-dialog').returnValue !== 'create') return;
  const created = createProject({ name: $('#new-name').value, templateId: $('input[name="template"]:checked')?.value ?? 'living' });
  location.hash = `#/p/${created.id}`;
});
function exportProject() {
  flushSave();
  downloadFile({ ...project, scene: roomScene });
  toast('Room file downloaded');
}
$('#import-file').addEventListener('change', async (event) => {
  const files = [...event.target.files];
  event.target.value = '';
  let last = null;
  for (const file of files) {
    try { last = importProjectFile(await file.text()); } catch (error) { toast(`${file.name}: ${error.message}`, { tone: 'warn' }); }
  }
  if (!last) return;
  if (files.length === 1) location.hash = `#/p/${last.id}`;
  else { renderFiles(); toast(`Uploaded ${files.length} rooms`); }
});
$('#project-name').addEventListener('change', (event) => {
  project = { ...project, name: event.target.value.trim() || 'Untitled room' };
  event.target.value = project.name;
  document.title = `${project.name} · RoomShift`;
  scheduleSave();
});
$('#project-name').addEventListener('keydown', (event) => { if (event.key === 'Enter') event.target.blur(); });
$('#reset-scene').addEventListener('click', () => {
  closeMenus();
  const template = TEMPLATES.find((item) => item.id === project.template) ?? TEMPLATES[0];
  history.record(currentSnapshot());
  setLens(null);
  roomScene = template.create();
  selectedId = null;
  setTransformMode('translate');
  viewport.setProjection('perspective');
  viewport.setScene(roomScene, null);
  viewport.fitRoom(true);
  syncViewButtons('3d');
  renderAll();
  afterChange();
  toast(`Reset to the ${template.label} template`, { action: 'Undo', onAction: undo });
});
$('#undo-button').addEventListener('click', undo);
$('#redo-button').addEventListener('click', redo);

// ─── Command palette ──────────────────────────────────────────────────────
function commands() {
  const inEditor = Boolean(project) && !$('#editor').hidden;
  const list = [
    { label: 'New room…', group: 'Rooms', run: openNewDialog, keys: 'N' },
    { label: 'All rooms', group: 'Rooms', run: () => { location.hash = '#/'; } },
    { label: 'Upload room files…', group: 'Rooms', run: () => $('#import-file').click() },
    { label: 'Cycle theme (system / light / dark)', group: 'App', run: cycleTheme },
  ];
  if (!inEditor) return list;
  list.push(
    { label: 'Download room file', group: 'Rooms', run: exportProject, keys: `${mod}E` },
    { label: 'Insights & livability', group: 'Layout', run: () => openSheet('insights', { toggle: false }), keys: 'I' },
    { label: 'Suggest a better layout', group: 'Layout', run: runSuggestion },
    { label: 'Room size & shape', group: 'Room', run: () => openSheet('room', { toggle: false }) },
    { label: 'Site, sun & weather', group: 'Room', run: () => openSheet('site', { toggle: false }) },
    { label: 'Fetch live weather', group: 'Room', run: () => { openSheet('site', { toggle: false }); $('#weather-refresh').click(); } },
    { label: 'Room size from a photo', group: 'Photo', run: () => photoPanel.open() },
    { label: 'Furniture from a photo', group: 'Photo', run: openFurniturePhoto },
    ...Object.entries(LENSES).map(([mode, label], index) => ({ label: `${label} lens`, group: 'Lens', run: () => setLens(mode), keys: String(index + 1) })),
    { label: 'Clear lens', group: 'Lens', run: () => setLens(null), keys: '0' },
    { label: 'Top view', group: 'View', run: () => setCameraView('top'), keys: 'T' },
    { label: '3D view', group: 'View', run: () => setCameraView('3d'), keys: 'V' },
    { label: 'Undo', group: 'Edit', run: undo, keys: `${mod}Z` },
    { label: 'Redo', group: 'Edit', run: redo, keys: `${mod}⇧Z` },
    ...paletteProviders.flatMap((provider) => provider()),
    ...Object.entries(MODEL_PRESETS).map(([key, preset]) => ({ label: `Add ${preset.label}`, group: 'Add', icon: preset.icon, run: () => placeModel(key) })),
    ...CATALOG.map((item) => ({ label: `Add ${item.name}`, group: 'Catalog', icon: MODEL_PRESETS[item.model].icon, run: () => placeModel(item.model, { catalog: item }) })),
    ...roomScene.objects.map((object) => ({ label: `Select ${object.name}`, group: 'In room', icon: MODEL_PRESETS[object.model]?.icon, run: () => select(object.id) })),
    ...Object.entries(SURFACE_MATERIALS.floor).map(([key, value]) => ({ label: `Floor: ${value.label}`, group: 'Finish', run: () => apply(setSurfaceMaterial(roomScene, 'floor', key)) })),
    ...Object.entries(SURFACE_MATERIALS.walls).map(([key, value]) => ({ label: `Walls: ${value.label}`, group: 'Finish', run: () => apply(setSurfaceMaterial(roomScene, 'walls', key)) })),
  );
  return list;
}
let paletteItems = [];
let paletteIndex = 0;
function fuzzyScore(text, query) {
  if (!query) return 1;
  const lower = text.toLowerCase();
  if (lower.includes(query)) return 3 - lower.indexOf(query) / 100;
  let position = 0;
  for (const character of query) {
    position = lower.indexOf(character, position);
    if (position < 0) return 0;
    position += 1;
  }
  return 1;
}
// "sofa 210x90x80", "desk 1.2 x 0.6": add a piece at an exact size (cm or m).
function quickAddCommand(query) {
  const match = query.match(/^([a-z][a-z ]*?)\s+(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)(?:\s*[x×*]\s*(\d+(?:\.\d+)?))?\s*(cm|m)?$/);
  if (!match || !roomScene) return null;
  const [, word, a, b, c, unit] = match;
  const entry = Object.entries(MODEL_PRESETS).find(([key, preset]) => !preset.wall && (preset.label.toLowerCase().startsWith(word.trim()) || key.toLowerCase() === word.trim()));
  if (!entry) return null;
  const [model, preset] = entry;
  const toMetres = (value) => (unit === 'cm' || (!unit && Number(value) > 10) ? Number(value) / 100 : Number(value));
  const dimensions = { width: toMetres(a), depth: toMetres(b), height: c ? toMetres(c) : preset.dimensions.height };
  return {
    label: `Add ${preset.label} ${fmt(dimensions.width, 2)} × ${fmt(dimensions.depth, 2)} × ${fmt(dimensions.height, 2)} m`, group: 'Exact size', icon: preset.icon, score: 10,
    run: () => placeModel(model, { catalog: { name: preset.label, dimensions } }),
  };
}

function renderPalette() {
  const query = $('#palette-input').value.trim().toLowerCase();
  const exact = quickAddCommand(query);
  paletteItems = (exact ? [exact] : []).concat(commands().map((command) => ({ ...command, score: fuzzyScore(`${command.label} ${command.group}`, query) }))
    .filter((command) => command.score > 0).sort((a, b) => b.score - a.score).slice(0, 50));
  paletteIndex = Math.min(paletteIndex, Math.max(0, paletteItems.length - 1));
  $('#palette-list').innerHTML = paletteItems.map((command, index) => `
    <div class="palette-item ${index === paletteIndex ? 'active' : ''}" role="option" data-index="${index}" aria-selected="${index === paletteIndex}">
      <span class="palette-icon">${escapeHtml(command.icon ?? '›')}</span><span>${escapeHtml(command.label)}</span><span class="palette-group">${escapeHtml(command.group)}</span>${command.keys ? `<kbd>${command.keys}</kbd>` : ''}
    </div>`).join('') || '<div class="palette-empty">Nothing matches</div>';
  $('.palette-item.active')?.scrollIntoView({ block: 'nearest' });
}
function openPalette(prefill = '') {
  $('#palette').hidden = false;
  $('#palette-input').value = prefill;
  paletteIndex = 0;
  renderPalette();
  $('#palette-input').focus();
}
const closePalette = () => { $('#palette').hidden = true; };
function runPaletteItem(index) {
  const command = paletteItems[index];
  closePalette();
  command?.run();
}
$('#palette-input').addEventListener('input', () => { paletteIndex = 0; renderPalette(); });
$('#palette-input').addEventListener('keydown', (event) => {
  if (event.key === 'ArrowDown') { paletteIndex = Math.min(paletteItems.length - 1, paletteIndex + 1); renderPalette(); event.preventDefault(); }
  else if (event.key === 'ArrowUp') { paletteIndex = Math.max(0, paletteIndex - 1); renderPalette(); event.preventDefault(); }
  else if (event.key === 'Enter') runPaletteItem(paletteIndex);
  else if (event.key === 'Escape') closePalette();
});
$('#palette-list').addEventListener('click', (event) => {
  const item = event.target.closest('[data-index]');
  if (item) runPaletteItem(Number(item.dataset.index));
});
$('#palette').addEventListener('pointerdown', (event) => { if (event.target.id === 'palette') closePalette(); });

// ─── Global actions ───────────────────────────────────────────────────────
const ACTIONS = {
  'new-menu': () => toggleMenu($('#new-menu')),
  'new-dialog': () => { closeMenus(); openNewDialog(); },
  'file-menu': () => toggleMenu($('#file-menu')),
  'go-files': () => { closeMenus(); location.hash = '#/'; },
  'duplicate-project': () => { closeMenus(); flushSave(); const copy = duplicateProject(project.id); if (copy) location.hash = `#/p/${copy.id}`; },
  'open-demo': () => { location.hash = '#/p/demo'; },
  'import-project': () => { closeMenus(); $('#import-file').click(); },
  'export-project': () => { closeMenus(); exportProject(); },
  palette: () => openPalette(),
  theme: cycleTheme,
  'suggest-layout': runSuggestion,
  'close-sheet': closeSheet,
  'toggle-outline': () => { const hidden = !$('#outline').hidden; $('#outline').hidden = hidden; $('#outline-tab').hidden = !hidden; },
  deselect: () => select(null),
  'clear-selection': () => { filesSelection.clear(); renderFiles(); },
  'open-selected': () => { const [first] = filesSelection; if (first) location.hash = `#/p/${first}`; },
  'duplicate-selected': () => { for (const id of filesSelection) duplicateProject(id); filesSelection.clear(); renderFiles(); },
  'export-selected': () => { for (const id of filesSelection) downloadFile(getProject(id)); },
  'delete-selected': deleteSelectedFiles,
  report: () => app.openReport?.(),
  'ar-usdz': () => app.exportAr?.('usdz'),
  'ar-glb': () => app.exportAr?.('glb'),
  compare: () => app.compareLayouts?.(),
};
app.actions = ACTIONS;
document.addEventListener('click', (event) => {
  const trigger = event.target.closest('[data-action]');
  if (!trigger) return;
  if (trigger.closest('.menu') && trigger.dataset.action !== 'new-menu') closeMenus();
  ACTIONS[trigger.dataset.action]?.();
});
$('#show-shortcuts').addEventListener('click', () => $('#shortcut-help').showModal());

// ─── Keyboard ─────────────────────────────────────────────────────────────
function nudge(dx, dz) {
  const object = selectedObject();
  if (!object) return;
  try { apply(moveObject(roomScene, object.id, { x: object.position.x + dx, z: object.position.z + dz })); } catch { /* at the wall */ }
}
function cycleSelection(direction) {
  if (!roomScene.objects.length) return;
  const index = roomScene.objects.findIndex((object) => object.id === selectedId);
  select(roomScene.objects[(index + direction + roomScene.objects.length) % roomScene.objects.length].id);
}

document.addEventListener('keydown', (event) => {
  const modifier = event.metaKey || event.ctrlKey;
  const key = event.key.toLowerCase();
  if (modifier && key === 'k') { event.preventDefault(); $('#palette').hidden ? openPalette() : closePalette(); return; }
  if (!$('#palette').hidden || document.querySelector('dialog[open]')) return;
  if (event.target.matches('input, textarea, select, [contenteditable="true"]')) {
    if (event.key === 'Escape') event.target.blur();
    return;
  }
  if (key === 'escape') closeMenus();
  if ($('#editor').hidden) {
    if (modifier && key === 'a' && filesView === 'rooms') { event.preventDefault(); for (const item of visibleProjects()) filesSelection.add(item.id); renderFiles(); }
    else if ((event.key === 'Delete' || event.key === 'Backspace') && filesSelection.size) deleteSelectedFiles();
    else if (key === 'escape' && filesSelection.size) { filesSelection.clear(); renderFiles(); }
    else if (key === 'n' && !modifier) openNewDialog();
    else if (key === '/') { event.preventDefault(); $('#files-search').focus(); }
    return;
  }
  if (modifier && key === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); return; }
  if (modifier && key === 'y') { event.preventDefault(); redo(); return; }
  if (modifier && key === 'd') { event.preventDefault(); duplicateSelected(); return; }
  if (modifier && key === 'e') { event.preventDefault(); exportProject(); return; }
  if (modifier && key === 's') { event.preventDefault(); scheduleSave(); flushSave(); toast('Saved — RoomShift also saves as you go'); return; }
  if (modifier || event.altKey) return;
  const step = event.shiftKey ? 0.5 : 0.05;
  const arrows = { arrowleft: [-step, 0], arrowright: [step, 0], arrowup: [0, -step], arrowdown: [0, step] };
  if (arrows[key] && selectedId) { event.preventDefault(); nudge(...arrows[key]); return; }
  if (key === 'tab') { event.preventDefault(); cycleSelection(event.shiftKey ? -1 : 1); return; }
  if (key === ' ') { event.preventDefault(); if (!toggleOpen() && lenses.has('light')) toggleSunPlay(); return; }
  if (key === '[' || key === '{') spin(event.shiftKey || key === '{' ? -90 : -15);
  else if (key === ']' || key === '}') spin(event.shiftKey || key === '}' ? 90 : 15);
  else if (key === 'g') setTransformMode('translate');
  else if (key === 'r') setTransformMode('rotate');
  else if (key === 'o') $('#projection-orthographic').click();
  else if (key === 't') setCameraView('top');
  else if (key === 'v') setCameraView('3d');
  else if (key === 'f') $('#view-home').click();
  else if (key === 'k') toggleLock();
  else if (key === 'i' || key === 'l') openSheet('insights');
  else if (key === 'a') openPalette('Add ');
  else if (key === '?' || (key === '/' && event.shiftKey)) $('#shortcut-help').showModal();
  else if (/^Digit[1-5]$/.test(event.code)) toggleLens(Object.keys(LENSES)[Number(event.code.slice(5)) - 1], event.shiftKey);
  else if (key === '0') setLens(null);
  else if (key === 'escape') {
    $('#context-menu').hidden = true;
    if (selectedId) select(null);
    else if (!$('#sheet').hidden) closeSheet();
  } else if ((event.key === 'Delete' || event.key === 'Backspace') && selectedId) deleteSelected();
});

// ─── Boot ─────────────────────────────────────────────────────────────────
app.boot = () => {
  applyTheme();
  window.addEventListener('hashchange', route);
  window.addEventListener('beforeunload', flushSave);
  route();
};
