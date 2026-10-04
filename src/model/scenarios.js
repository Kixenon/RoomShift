import { validateScene } from '../simulation/room-fields-3d.js';

export function readWorkspace(storage) {
  try {
    const saved = JSON.parse(storage.getItem('roomshift.workspace'));
    if (saved?.version !== 1 || !Array.isArray(saved.scenarios) || saved.scenarios.length > 20) return null;
    validateScene(saved.scene);
    for (const scenario of saved.scenarios) {
      if (typeof scenario.name !== 'string' || !scenario.name.trim() || scenario.name.length > 80) return null;
      validateScene(scenario.scene);
    }
    return { scene: saved.scene, scenarios: saved.scenarios };
  } catch { return null; }
}

export function writeWorkspace(storage, { scene, scenarios }) {
  storage.setItem('roomshift.workspace', JSON.stringify({ version: 1, scene, scenarios }));
}
