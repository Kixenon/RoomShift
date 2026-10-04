import { RoomFieldSolver } from './room-field-backend.js';

const solver = new RoomFieldSolver();
const active = new Set();
const cancelled = new Set();

self.addEventListener('message', (event) => {
  const message = event.data;
  if (message.type === 'cancel') {
    if (active.has(message.requestId)) cancelled.add(message.requestId);
    return;
  }
  void solve(message);
});

async function solve({ requestId, mode, scene, durationSeconds, cellSize }) {
  active.add(requestId);
  try {
    if (!['airflow', 'temperature', 'light', 'wifi'].includes(mode)) {
      throw new RangeError(`Unsupported room field mode: ${mode}`);
    }
    const result = await solver.solve(scene, mode, {
      durationSeconds, cellSize, isCancelled: () => cancelled.has(requestId),
      onProgress: (result) => postResult(requestId, result, true),
    });
    if (cancelled.has(requestId)) {
      self.postMessage({ requestId, cancelled: true });
      return;
    }
    postResult(requestId, result);
  } catch (error) {
    self.postMessage({ requestId, error: { name: error.name, message: error.message } });
  } finally {
    active.delete(requestId);
    cancelled.delete(requestId);
  }
}

function postResult(requestId, result, progress = false) {
  // Cached snapshots and resident solver state retain their buffers.
  const copy = structuredClone(result);
  const transfer = Object.values(copy.fields).filter(ArrayBuffer.isView).map((field) => field.buffer);
  self.postMessage({ requestId, result: copy, progress }, transfer);
}
