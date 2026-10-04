export function sampleRoomFields(result, point) {
  const { grid, fields } = result;
  if (point.x < 0 || point.x > grid.width || point.y < 0 || point.y > grid.height || point.z < 0 || point.z > grid.depth) return null;
  const cell = [point.x / grid.dx - 0.5, point.y / grid.dy - 0.5, point.z / grid.dz - 0.5];
  const dims = [grid.nx, grid.ny, grid.nz];
  const low = cell.map((value, axis) => Math.floor(Math.max(0, Math.min(dims[axis] - 1, value))));
  const blend = cell.map((value, axis) => Math.max(0, Math.min(dims[axis] - 1, value)) - low[axis]);
  const nearest = (Math.min(grid.ny - 1, Math.floor(point.y / grid.dy)) * grid.nz
    + Math.min(grid.nz - 1, Math.floor(point.z / grid.dz))) * grid.nx + Math.min(grid.nx - 1, Math.floor(point.x / grid.dx));
  if (fields.solid[nearest]) return { solid: true };
  const value = [0, 0, 0, 0];
  const arrays = [fields.u, fields.v, fields.w, fields.temperature];
  let total = 0;
  for (let y = 0; y < 2; y += 1) for (let z = 0; z < 2; z += 1) for (let x = 0; x < 2; x += 1) {
    const id = (Math.min(low[1] + y, grid.ny - 1) * grid.nz + Math.min(low[2] + z, grid.nz - 1)) * grid.nx + Math.min(low[0] + x, grid.nx - 1);
    if (fields.solid[id]) continue;
    const weight = (x ? blend[0] : 1 - blend[0]) * (y ? blend[1] : 1 - blend[1]) * (z ? blend[2] : 1 - blend[2]);
    arrays.forEach((array, axis) => value[axis] += array[id] * weight);
    total += weight;
  }
  return total ? { solid: false, speed: Math.hypot(value[0], value[1], value[2]) / total, temperature: value[3] / total } : null;
}

export function fieldSceneKey(scene, cellSize) {
  const room = Object.fromEntries(['width', 'height', 'depth', 'outdoorTemperature', 'initialTemperature', 'envelopeUValue'].map((key) => [key, scene.room[key]]));
  const objects = scene.objects.map((object) => Object.fromEntries(['model', 'position', 'rotation', 'dimensions', 'enabled', 'intensity', 'powerWatts', 'wall', 'open', 'flowDirection', 'flowRate'].map((key) => [key, object[key]])));
  return JSON.stringify([room, objects, cellSize]);
}

export function cacheSnapshot(cache, key, result) {
  cache.delete(key);
  cache.set(key, result);
  const bytes = () => [...cache.values()].reduce((sum, snapshot) => sum + Object.values(snapshot.fields).reduce((total, field) => total + (field.byteLength ?? 0), 0), 0);
  while (cache.size > 12 || bytes() > 32_000_000) cache.delete(cache.keys().next().value);
}
