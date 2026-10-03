import { simulateRoomFieldsAsync } from './room-fields-3d.js';
import { simulateRoomFieldsWebGpu } from './room-fields-webgpu.js';
import { estimateRoomLightAsync } from './room-light.js';

export async function solveRoomFields(scene, mode, { isCancelled = () => false } = {}) {
  if (mode === 'light') return estimateRoomLightAsync(scene, {}, { isCancelled });
  if (mode !== 'airflow' && mode !== 'temperature') {
    throw new RangeError(`Unsupported room field mode: ${mode}`);
  }

  let accelerated;
  let accelerationError = null;
  try {
    accelerated = await simulateRoomFieldsWebGpu(scene, { isCancelled });
  } catch (error) {
    if (isCancelled()) return null;
    accelerationError = error;
  }
  if (accelerated || isCancelled()) return accelerated;
  const preview = await simulateRoomFieldsAsync(scene, {}, { isCancelled });
  return preview && accelerationError
    ? { ...preview, gpuFallbackReason: accelerationError.message }
    : preview;
}
