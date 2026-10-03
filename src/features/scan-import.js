import * as THREE from 'three';
import { MODEL_PRESETS, addObject, addWindow, moveObject, resizeRoom } from '../model/room-scene.js';

// Import a LiDAR / photogrammetry scan (Polycam GLB/OBJ, Apple RoomPlan USDZ).
// - Room scans set the room size from the scan's bounds and show the scan as a
//   ghost to trace over. Labelled parts (RoomPlan names nodes "Bed0", "Door1",
//   "Storage2"…) become real RoomShift objects at their measured size.
// - Object scans become one object at the scanned size.
// Everything runs locally; nothing is uploaded.

const PART_MODELS = [
  [/sofa|couch/i, 'sofa'], [/bed/i, 'bed'], [/table/i, 'table'], [/desk/i, 'desk'], [/chair|stool/i, 'chair'],
  [/storage|cabinet|wardrobe|closet|dresser/i, 'wardrobe'], [/shelf|bookcase/i, 'shelf'], [/refrigerator|fridge/i, 'fridge'],
  [/television|\btv\b|screen/i, 'tv'], [/door/i, 'door'], [/window/i, 'window'], [/plant/i, 'plant'],
  [/fan/i, 'fan'], [/heater|radiator/i, 'heater'], [/\bac\b|air.?con/i, 'ac'], [/desk.?lamp/i, 'deskLamp'], [/ceiling.?light/i, 'ceilingLight'],
  [/lamp|light/i, 'lamp'], [/router|modem/i, 'router'], [/speaker/i, 'speaker'],
  [/bathtub|toilet|sink|stove|oven|washer|dishwasher|fireplace/i, 'box'],
];

async function loadScan(file) {
  const name = file.name.toLowerCase();
  const url = URL.createObjectURL(file);
  try {
    if (name.endsWith('.glb') || name.endsWith('.gltf')) {
      const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
      return (await new GLTFLoader().loadAsync(url)).scene;
    }
    if (name.endsWith('.obj')) {
      const { OBJLoader } = await import('three/addons/loaders/OBJLoader.js');
      return new OBJLoader().loadAsync(url);
    }
    if (name.endsWith('.usdz')) {
      const { USDZLoader } = await import('three/addons/loaders/USDZLoader.js');
      return new USDZLoader().loadAsync(url);
    }
    if (name.endsWith('.ply')) {
      const { PLYLoader } = await import('three/addons/loaders/PLYLoader.js');
      const geometry = await new PLYLoader().loadAsync(url);
      return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: geometry.hasAttribute('color') }));
    }
    throw new Error('Use a .glb, .gltf, .obj, .usdz or .ply file.');
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
}

// Scans arrive in metres, centimetres or millimetres; guess from the size.
function unitScale(size) {
  const largest = Math.max(size.x, size.y, size.z);
  // Rooms are 2–20 m: > 2500 must be millimetres, > 25 centimetres.
  if (largest > 2500) return 0.001;
  if (largest > 25) return 0.01;
  return 1;
}

export function analyseScan(root) {
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(root);
  const scale = unitScale(bounds.getSize(new THREE.Vector3()));
  root.scale.multiplyScalar(scale);
  root.updateMatrixWorld(true);
  bounds.setFromObject(root);
  const size = bounds.getSize(new THREE.Vector3());
  const parts = [];
  root.traverse((node) => {
    const match = PART_MODELS.find(([pattern]) => pattern.test(node.name ?? ''));
    if (!match || node === root) return;
    // Skip children of an already-matched part.
    for (let parent = node.parent; parent && parent !== root; parent = parent.parent) {
      if (PART_MODELS.some(([pattern]) => pattern.test(parent.name ?? ''))) return;
    }
    const box = new THREE.Box3().setFromObject(node);
    if (box.isEmpty()) return;
    const partSize = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    parts.push({
      model: match[1],
      name: node.name.replace(/[-_\s\d]+$/, '').replace(/^\w/, (c) => c.toUpperCase()) || MODEL_PRESETS[match[1]].label,
      size: { width: partSize.x, height: partSize.y, depth: partSize.z },
      position: { x: center.x - bounds.min.x, y: box.min.y - bounds.min.y, z: center.z - bounds.min.z },
    });
  });
  return { root, bounds, size, scale, parts };
}

function nearestWall(position, room) {
  const distances = { front: position.z, back: room.depth - position.z, left: position.x, right: room.width - position.x };
  return Object.entries(distances).sort((a, b) => a[1] - b[1])[0][0];
}

export function sceneFromScan(base, scan, { useParts = true } = {}) {
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  let scene = resizeRoom(useParts && scan.parts.length ? { ...base, objects: [], nextObjectId: 1, nextWindowId: 1 } : base, {
    // A furniture-only scan has no ceiling; keep the current height then.
    width: clamp(scan.size.x, 2, 20), depth: clamp(scan.size.z, 2, 20), height: scan.size.y >= 2.2 ? clamp(scan.size.y, 2, 6) : base.room.height,
  });
  if (!useParts) return scene;
  for (const part of scan.parts) {
    try {
      if (part.model === 'door' || part.model === 'window') {
        const added = addWindow(scene, nearestWall(part.position, scene.room), part.model);
        scene = moveObject(added.scene, added.object.id, { x: part.position.x, z: part.position.z, y: part.position.y }).scene;
        continue;
      }
      const dimensions = {
        width: clamp(part.size.width, 0.1, scene.room.width), height: clamp(part.size.height, 0.1, scene.room.height), depth: clamp(part.size.depth, 0.1, scene.room.depth),
      };
      const result = addObject(scene, { model: part.model, name: part.name.slice(0, 80), dimensions });
      scene = moveObject(result.scene, result.object.id, { x: part.position.x, z: part.position.z, y: part.position.y > 0.05 ? part.position.y : 0 }).scene;
    } catch { /* skip parts that cannot fit */ }
  }
  return scene;
}

export function installScanImport(app) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.glb,.gltf,.obj,.usdz,.ply';
  input.hidden = true;
  document.body.append(input);
  let mode = 'room';

  input.addEventListener('change', async () => {
    const file = input.files[0];
    input.value = '';
    if (!file) return;
    app.toast(`Reading ${file.name}…`, { timeout: 2000 });
    try {
      const scan = analyseScan(await loadScan(file));
      if (mode === 'object') {
        const model = scan.parts[0]?.model ?? 'box';
        const dimensions = { width: +scan.size.x.toFixed(2), height: +scan.size.y.toFixed(2), depth: +scan.size.z.toFixed(2) };
        const result = addObject(app.scene, { model, name: file.name.replace(/\.[^.]+$/, '').slice(0, 80), dimensions });
        app.apply(result, { select: result.object.id });
        app.toast(`Added “${result.object.name}” at ${dimensions.width} × ${dimensions.depth} × ${dimensions.height} m — set its type in the card`, { timeout: 6000 });
        return;
      }
    app.track?.('room-size');
      app.apply(sceneFromScan(app.scene, scan), { select: null });
      app.viewport.setReference(scan.root, scan.bounds);
      app.viewport.fitRoom(true);
      app.toast(scan.parts.length
        ? `Scan imported: ${scan.parts.length} labelled parts became objects`
        : `Room set to ${scan.size.x.toFixed(2)} × ${scan.size.z.toFixed(2)} m — trace furniture over the ghost scan`, { action: 'Undo', onAction: app.undo, timeout: 7000 });
    } catch (error) {
      app.toast(`Couldn’t import: ${error.message}`, { tone: 'warn', timeout: 6000 });
    }
  });

  const pick = (kind) => { mode = kind; input.click(); };
  app.dockActions = { ...(app.dockActions ?? {}), 'scan-room': () => pick('room'), 'scan-object': () => pick('object'), 'scan-clear': () => app.viewport.setReference(null) };
  app.addDockItems(() => `<button class="dock-item photo" type="button" data-dock-action="scan-room" title="Polycam / RoomPlan export: GLB, OBJ, USDZ, PLY"><span class="glyph">⬚</span>3D room scan</button>
    <button class="dock-item photo" type="button" data-dock-action="scan-object" title="A scanned piece of furniture"><span class="glyph">⬙</span>3D object scan</button>`);
  app.addPaletteCommands(() => [
    { label: 'Import 3D room scan (Polycam, RoomPlan…)', group: 'Photo', icon: '⬚', run: () => pick('room') },
    { label: 'Import 3D object scan', group: 'Photo', icon: '⬙', run: () => pick('object') },
    { label: 'Hide the scan overlay', group: 'View', run: () => app.viewport.setReference(null) },
  ]);
}
