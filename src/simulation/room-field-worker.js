import { solveRoomFields } from './room-field-backend.js';

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

async function solve({ requestId, mode, scene }) {
  active.add(requestId);
  try {
    if (!['airflow', 'temperature', 'light', 'wifi'].includes(mode)) {
      throw new RangeError(`Unsupported room field mode: ${mode}`);
    }
    const result = await solveRoomFields(scene, mode, { isCancelled: () => cancelled.has(requestId) });
    if (cancelled.has(requestId)) {
      self.postMessage({ requestId, cancelled: true });
      return;
    }
    const transfer = Object.values(result.fields)
      .filter((field) => ArrayBuffer.isView(field))
      .map((field) => field.buffer);
    self.postMessage({ requestId, result }, transfer);
  } catch (error) {
    self.postMessage({ requestId, error: { name: error.name, message: error.message } });
  } finally {
    active.delete(requestId);
    cancelled.delete(requestId);
  }
}
