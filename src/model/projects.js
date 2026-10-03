import { addObject, addWindow, createRoomScene, moveObject, normalizeScene, resizeRoom, rotateObject, setWindowOpen } from './room-scene.js';
import { DEFAULT_ENVIRONMENT } from './environment.js';

const STORAGE_KEY = 'roomshift.projects.v1';

function build(room, items, openings = []) {
  let scene = resizeRoom({ ...createRoomScene(), objects: [], nextObjectId: 1, nextWindowId: 1 }, room);
  for (const [wall, model, position, open] of openings) {
    const result = addWindow(scene, wall, model);
    scene = moveObject(result.scene, result.object.id, position).scene;
    if (open) scene = setWindowOpen(scene, result.object.id, true).scene;
  }
  for (const [model, position, rotationY = 0, name] of items) {
    const result = addObject(scene, { model, position, ...(name ? { name } : {}) });
    scene = rotationY ? rotateObject(result.scene, result.object.id, { y: rotationY }).scene : result.scene;
  }
  return scene;
}

export const TEMPLATES = Object.freeze([
  {
    id: 'living',
    label: 'Living room',
    description: 'The demo room: sofa, desk, fan, heater, lamp.',
    create: () => createRoomScene(),
  },
  {
    id: 'hall',
    label: 'University hall room',
    description: '3.0 × 2.6 m single with bed, desk, wardrobe and a fan.',
    create: () => build({ width: 3.0, depth: 2.6, height: 2.6 }, [
      ['bed', { x: 0.55, z: 1.55 }, 0, 'Single bed'],
      ['desk', { x: 2.35, z: 2.25 }, 180],
      ['chair', { x: 2.35, z: 1.75 }],
      ['wardrobe', { x: 2.65, z: 0.4 }, -90],
      ['fan', { x: 1.6, z: 0.4 }],
      ['ceilingLight', { x: 1.5, z: 1.3 }],
      ['router', { x: 2.0, y: 0.74, z: 2.3 }],
    ], [['back', 'window', { x: 1.5 }], ['front', 'door', { x: 1.05 }]]),
  },
  {
    id: 'studio',
    label: 'Studio flat',
    description: 'A 4.5 × 3.6 m flat with bed, sofa, TV, AC and speaker.',
    create: () => build({ width: 4.5, depth: 3.6, height: 2.7 }, [
      ['bed', { x: 0.85, z: 2.55 }],
      ['sofa', { x: 3.4, z: 2.9 }, 180],
      ['tv', { x: 3.4, z: 1.2 }],
      ['table', { x: 3.4, z: 2.0 }],
      ['ac', { x: 2.2, z: 0.12 }],
      ['speaker', { x: 2.6, z: 1.2 }],
      ['fridge', { x: 0.4, z: 0.4 }],
      ['plant', { x: 4.2, z: 0.35 }],
      ['ceilingLight', { x: 2.25, z: 1.8 }],
      ['router', { x: 4.2, y: 0.9, z: 1.2 }],
    ], [['back', 'window', { x: 2.25 }], ['front', 'door', { x: 3.7 }], ['right', 'window', { z: 2.6 }]]),
  },
  {
    id: 'office',
    label: 'Home office',
    description: 'Two desks, shelving, router and a heater.',
    create: () => build({ width: 4.0, depth: 3.4, height: 2.7 }, [
      ['desk', { x: 1.0, z: 2.9 }, 180, 'Desk A'],
      ['desk', { x: 3.0, z: 2.9 }, 180, 'Desk B'],
      ['chair', { x: 1.0, z: 2.3 }],
      ['chair', { x: 3.0, z: 2.3 }],
      ['shelf', { x: 0.2, z: 1.2 }, 90],
      ['router', { x: 3.75, y: 0.0, z: 0.3 }],
      ['heater', { x: 2.0, z: 0.12 }],
      ['plant', { x: 3.7, z: 1.5 }],
      ['ceilingLight', { x: 2.0, z: 1.7 }],
    ], [['back', 'window', { x: 2.0 }], ['front', 'door', { x: 0.7 }]]),
  },
  {
    id: 'empty',
    label: 'Empty room',
    description: 'A blank 4 × 3.5 m shell.',
    create: () => build({ width: 4, depth: 3.5, height: 2.7 }, []),
  },
]);

function readAll() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(projects) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
    return true;
  } catch {
    // Storage full (usually thumbnails) — retry without them before giving up.
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(projects.map(({ thumbnail, ...rest }) => rest)));
      return true;
    } catch {
      return false;
    }
  }
}

export const listProjects = () => readAll().sort((a, b) => b.updatedAt - a.updatedAt);
export const getProject = (id) => readAll().find((project) => project.id === id) ?? null;

export function createProject({ name, templateId = 'living', scene } = {}) {
  const template = TEMPLATES.find((item) => item.id === templateId) ?? TEMPLATES[0];
  const project = {
    id: `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: name?.trim() || template.label,
    template: template.id,
    scene: scene ? normalizeScene(scene) : template.create(),
    environment: { ...DEFAULT_ENVIRONMENT },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  writeAll([...readAll(), project]);
  return project;
}

export function saveProject(project) {
  const next = { ...project, updatedAt: Date.now() };
  const all = readAll();
  const index = all.findIndex((item) => item.id === project.id);
  if (index >= 0) all[index] = next;
  else all.push(next);
  return writeAll(all) ? next : null;
}

export function deleteProject(id) {
  writeAll(readAll().filter((project) => project.id !== id));
}

export function duplicateProject(id) {
  const source = getProject(id);
  if (!source) return null;
  const copy = { ...structuredClone(source), id: `p${Date.now().toString(36)}`, name: `${source.name} copy`, createdAt: Date.now(), updatedAt: Date.now() };
  writeAll([...readAll(), copy]);
  return copy;
}

export function importProjectFile(text) {
  const data = JSON.parse(text);
  const scene = normalizeScene(data.scene ?? data);
  const project = createProject({ name: data.name ?? 'Imported room', scene });
  if (data.environment) return saveProject({ ...project, environment: { ...DEFAULT_ENVIRONMENT, ...data.environment } });
  return project;
}

export function exportProjectFile(project) {
  const { thumbnail, ...rest } = project;
  return JSON.stringify({ format: 'roomshift', version: 1, ...rest }, null, 2);
}
