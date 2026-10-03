import * as THREE from 'three';
import {
  createAirflowLayers,
  createFieldVolume,
  createTemperatureSurfaceLayer,
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
    || (mode === 'light' && fields.light?.length !== cellCount)) {
    throw new TypeError('Room fields must contain complete 3D arrays matching the grid dimensions.');
  }
}

export function createRoomFieldLayer(result, mode, roomScene) {
  if (!['airflow', 'temperature', 'light'].includes(mode)) {
    throw new RangeError(`Unsupported room field mode: ${mode}`);
  }
  validateResult(result, mode);
  const layer = new THREE.Group();
  layer.name = `room-field-${mode}`;
  layer.userData.fieldMode = mode;
  layer.userData.volumeVoxelCount = 0;
  if (mode === 'temperature') {
    layer.add(createTemperatureSurfaceLayer(result, roomScene));
  } else if (mode === 'airflow') {
    const airflow = createAirflowLayers(result, roomScene);
    if (airflow.streamlines) layer.add(airflow.streamlines);
    if (airflow.tracers) layer.add(airflow.tracers);
    layer.userData.streamlineVertexCount = airflow.streamlines?.geometry.getAttribute('position').count ?? 0;
    layer.userData.gasParticleCount = airflow.particleCount;
    layer.userData.animate = airflow.update;
  } else {
    const volume = createFieldVolume(result, mode);
    layer.add(volume);
    layer.userData.volumeVoxelCount = volume.userData.voxelCount;
  }
  return layer;
}
