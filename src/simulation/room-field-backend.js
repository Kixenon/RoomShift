import { createRoomFieldsSession } from './room-fields-3d.js';
import { createWebGpuSession } from './room-fields-webgpu.js';
import { cacheSnapshot, fieldSceneKey } from './room-field-analysis.js';
import { estimateRoomLightAsync } from './room-light.js';

export class RoomFieldSolver {
  constructor({ gpu = globalThis.navigator?.gpu } = {}) {
    this.gpu = gpu;
    this.sessions = new Map();
    this.snapshots = new Map();
  }

  async solve(scene, mode, { durationSeconds = 3, cellSize = 0.15, isCancelled = () => false, onProgress = () => {} } = {}) {
    if (mode === 'light') return estimateRoomLightAsync(scene, {}, { isCancelled });
    if (!['airflow', 'temperature'].includes(mode)) throw new RangeError(`Unsupported room field mode: ${mode}`);
    if (!Number.isFinite(durationSeconds) || durationSeconds < 0 || durationSeconds > 120) {
      throw new RangeError('Elapsed time must be between 0 and 120 seconds.');
    }
    durationSeconds = Number((Math.round(durationSeconds / 0.05) * 0.05).toFixed(2));
    const key = fieldSceneKey(scene, cellSize);
    const snapshotKey = `${key}:${durationSeconds}`;
    if (this.snapshots.has(snapshotKey)) return this.snapshots.get(snapshotKey);
    let entry = this.sessions.get(key);
    if (entry && entry.session.timeSeconds > durationSeconds) {
      entry.session.dispose();
      this.sessions.delete(key);
      entry = null;
    }
    if (!entry) {
      let session, fallbackReason;
      try { session = await createWebGpuSession(scene, { cellSize }, this.gpu); }
      catch (error) { fallbackReason = error.message; }
      session ??= createRoomFieldsSession(scene, { cellSize });
      entry = { session, fallbackReason };
      this.sessions.set(key, entry);
      while (this.sessions.size > 2) {
        const oldest = this.sessions.keys().next().value;
        this.sessions.get(oldest).session.dispose();
        this.sessions.delete(oldest);
      }
    } else {
      this.sessions.delete(key);
      this.sessions.set(key, entry);
    }
    let result;
    const start = performance.now();
    do {
      const next = Math.min(durationSeconds, entry.session.timeSeconds + (entry.session.timeSeconds === 0 ? 0.5 : 2));
      try { result = await entry.session.advanceTo(next, { isCancelled }); }
      catch (error) {
        entry.session.dispose();
        entry.session = createRoomFieldsSession(scene, { cellSize });
        entry.fallbackReason = error.message;
        result = await entry.session.advanceTo(next, { isCancelled });
      }
      if (!result || isCancelled()) return null;
      result.solveMilliseconds = performance.now() - start;
      if (entry.fallbackReason) result.gpuFallbackReason = entry.fallbackReason;
      cacheSnapshot(this.snapshots, `${key}:${result.durationSeconds}`, result);
      if (result.durationSeconds < durationSeconds) onProgress(result);
    } while (result.durationSeconds < durationSeconds - 0.001);
    return result;
  }

  dispose() {
    for (const { session } of this.sessions.values()) session.dispose();
    this.sessions.clear();
    this.snapshots.clear();
  }
}

export async function solveRoomFields(scene, mode, options = {}) {
  const solver = new RoomFieldSolver();
  try { return await solver.solve(scene, mode, options); }
  finally { solver.dispose(); }
}
