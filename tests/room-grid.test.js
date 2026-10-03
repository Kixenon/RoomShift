import assert from 'node:assert/strict';
import test from 'node:test';
import { createRoomScene } from '../src/model/room-scene.js';
import { createSimulationGrid, MAX_SIMULATION_CELLS } from '../src/simulation/room-grid.js';

test('default room resolves at five-centimetre spacing', () => {
  const grid = createSimulationGrid(createRoomScene().room);

  assert.deepEqual([grid.nx, grid.ny, grid.nz], [104, 54, 80]);
  assert.equal(grid.nx * grid.ny * grid.nz, 449_280);
  assert.ok(Math.max(grid.dx, grid.dy, grid.dz) <= 0.05);
  assert.equal(grid.requestedCellSize, 0.05);
});

test('large rooms increase cell size uniformly to fit GPU texture and memory limits', () => {
  const grid = createSimulationGrid({ width: 20, depth: 20, height: 6 }, 0.05);
  const spacings = [grid.dx, grid.dy, grid.dz];

  assert.ok(grid.nx * grid.ny * grid.nz <= MAX_SIMULATION_CELLS);
  assert.ok(Math.max(grid.nx, grid.ny, grid.nz) <= 256);
  assert.ok(Math.max(...spacings) / Math.min(...spacings) < 1.05);
  assert.ok(grid.cellSize > 0.05);
});

test('grid dimensions are validated and an overly fine request is safely capped', () => {
  const grid = createSimulationGrid({ width: 5.2, depth: 4, height: 2.7 }, 0.01);

  assert.ok(grid.nx * grid.ny * grid.nz <= MAX_SIMULATION_CELLS);
  assert.ok(grid.cellSize > 0.01);
  assert.throws(() => createSimulationGrid({ width: 0, depth: 4, height: 2.7 }), RangeError);
  assert.throws(() => createSimulationGrid(createRoomScene().room, 0), RangeError);
});
