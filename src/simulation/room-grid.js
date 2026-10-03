export const DEFAULT_CELL_SIZE = 0.05;
export const MAX_SIMULATION_CELLS = 1_500_000;
export const MAX_GRID_DIMENSION = 256;

export function createSimulationGrid(room, requestedCellSize = DEFAULT_CELL_SIZE) {
  if (![room?.width, room?.depth, room?.height].every((value) => Number.isFinite(value) && value > 0)) {
    throw new RangeError('Room dimensions must be positive finite values.');
  }
  if (!Number.isFinite(requestedCellSize) || requestedCellSize < 0.01 || requestedCellSize > 1.5) {
    throw new RangeError('Cell size must be between 0.01 m and 1.5 m.');
  }

  let cellSize = requestedCellSize;
  let nx;
  let ny;
  let nz;
  for (let attempt = 0; attempt < 16; attempt += 1) {
    nx = Math.max(4, Math.ceil(room.width / cellSize));
    ny = Math.max(4, Math.ceil(room.height / cellSize));
    nz = Math.max(4, Math.ceil(room.depth / cellSize));
    const cellCount = nx * ny * nz;
    const scale = Math.max(
      nx / MAX_GRID_DIMENSION,
      ny / MAX_GRID_DIMENSION,
      nz / MAX_GRID_DIMENSION,
      Math.cbrt(cellCount / MAX_SIMULATION_CELLS),
      1,
    );
    if (scale === 1) {
      const dx = room.width / nx;
      const dy = room.height / ny;
      const dz = room.depth / nz;
      return {
        width: room.width,
        height: room.height,
        depth: room.depth,
        nx,
        ny,
        nz,
        dx,
        dy,
        dz,
        cellSize: Math.max(dx, dy, dz),
        requestedCellSize,
      };
    }
    cellSize *= scale * 1.001;
  }
  throw new RangeError('Unable to fit the requested grid within the simulation limits.');
}
