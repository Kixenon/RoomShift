import * as THREE from 'three';
import {
  createAirflowLayers,
  createFieldVolume,
  getAirflowColor,
  getLightColor,
  getTemperatureColor,
} from './room-field-renderer.js';

export { getAirflowColor, getLightColor, getTemperatureColor };

function validateResult(result, mode) {
  const grid = result?.grid;
  const fields = result?.fields ?? {};
  const cellCount = grid?.nx * grid?.ny * grid?.nz;
  if (![grid?.nx, grid?.ny, grid?.nz].every((value) => Number.isInteger(value) && value > 0)
    || !Number.isFinite(grid.width) || !Number.isFinite(grid.height) || !Number.isFinite(grid.depth)
    || !Number.isFinite(grid.dx) || !Number.isFinite(grid.dy) || !Number.isFinite(grid.dz)
    || (fields.solid && fields.solid.length !== cellCount)
    || (mode === 'airflow' && fields.solid?.length !== cellCount)
    || (mode === 'airflow' && [fields.u, fields.v, fields.w].some((field) => field?.length !== cellCount))
    || (mode === 'temperature' && fields.temperature?.length !== cellCount)
    || (mode === 'light' && fields.light?.length !== cellCount)
    || (['wifi', 'sound', 'lux'].includes(mode) && fields.signal?.length !== cellCount)) {
    throw new TypeError('Room fields must contain complete 3D arrays matching the grid dimensions.');
  }
}

export function createRoomFieldLayer(result, mode) {
  if (!['airflow', 'temperature', 'light', 'wifi', 'sound', 'lux'].includes(mode)) {
    throw new RangeError(`Unsupported room field mode: ${mode}`);
  }
  validateResult(result, mode);
  const layer = new THREE.Group();
  layer.name = `room-field-${mode}`;
  layer.userData.fieldMode = mode;
  const volume = createFieldVolume(result, mode);
  layer.add(volume);
  layer.userData.volumeVoxelCount = volume.userData.voxelCount;
  if (mode === 'airflow') {
    const airflow = createAirflowLayers(result);
    if (airflow.streamlines) layer.add(airflow.streamlines);
    if (airflow.tracers) {
      layer.add(airflow.tracers);
      if (airflow.tracers.userData.streaks) layer.add(airflow.tracers.userData.streaks);
    }
    layer.userData.streamlineVertexCount = airflow.streamlines?.geometry.getAttribute('position').count ?? 0;
    layer.userData.animate = airflow.update;
  } else if (mode === 'wifi' || mode === 'sound') {
    layer.userData.animate = (time) => { volume.material.uniforms.uTime.value = time; };
  }
  return layer;
}
