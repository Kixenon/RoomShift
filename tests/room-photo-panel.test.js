import assert from 'node:assert/strict';
import test from 'node:test';
import { estimateHorizonFromRowEnergy } from '../src/model/room-photo-metrics.js';
import { rowEdgeEnergy, scaleHorizonRow } from '../src/scene/room-photo-panel.js';

// Builds an RGBA buffer with a flat field and a few horizontal bands, the shape
// of evidence the horizon estimator relies on.
function imageData({ width, height, band, value = 200 }) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const shaded = band.includes(y) ? value : 40;
      data[index] = shaded;
      data[index + 1] = shaded;
      data[index + 2] = shaded;
      data[index + 3] = 255;
    }
  }
  return { width, height, data };
}

test('horizontal bands produce a peak on the rows that change', () => {
  const profile = rowEdgeEnergy(imageData({ width: 40, height: 100, band: [30, 31, 69, 70] }));

  // The response lands on the first row of the new value, so a band starting at
  // row 30 changes at 30, and one starting at 69 changes at 69.
  assert.ok(profile[30] > profile[28], `row 30 was ${profile[30]}, row 28 was ${profile[28]}`);
  assert.ok(profile[69] > profile[67], `row 69 was ${profile[69]}, row 67 was ${profile[67]}`);
  assert.ok(profile[50] < profile[30], 'a flat interior row must not spike');
  assert.equal(profile[0], 0, 'the first row has nothing above it to compare against');
});

test('the profile feeds the horizon estimator to find the true row', () => {
  const profile = rowEdgeEnergy(imageData({ width: 40, height: 200, band: [60, 61, 140, 141] }));
  const horizon = estimateHorizonFromRowEnergy(profile);

  assert.ok(Math.abs(horizon.row - 100) <= 1, `horizon row was ${horizon.row}`);
  assert.ok(horizon.strength > 5, `strength was ${horizon.strength}`);
});

test('a featureless photo yields no edge energy at all', () => {
  const profile = rowEdgeEnergy(imageData({ width: 20, height: 60, band: [] }));
  assert.ok(profile.every((value) => value === 0));
  const horizon = estimateHorizonFromRowEnergy(profile);
  assert.equal(horizon.fallback, 'flat');
  assert.equal(horizon.row, 29.5);
});

test('all three colour channels contribute, so a red-only step registers', () => {
  // Guards the channel indexing: an earlier version read data[] with an already
  // computed RGB offset and returned all zeros, which silently turned every
  // horizon estimate into a fallback to the centre row. Red alone carries 0.299
  // of the luma, so a red-only ramp must move the profile.
  const width = 8;
  const height = 4;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      data[index] = y * 10;
      data[index + 1] = 255;
      data[index + 2] = 0;
      data[index + 3] = 255;
    }
  }
  const profile = rowEdgeEnergy({ width, height, data });

  for (let y = 1; y < height; y += 1) {
    assert.ok(profile[y] > 0, `row ${y} was ${profile[y]}`);
  }
  // The step is uniform, so every row above the first sees the same difference.
  assert.ok(Math.abs(profile[1] - profile[2]) < 1e-9, `profile was ${profile}`);
});

test('a downscaled horizon row scales back to the full image', () => {
  assert.equal(scaleHorizonRow(50, 100, 400), 200);
  assert.ok(Math.abs(scaleHorizonRow(49.5, 133, 800) - 297.7) < 0.2);
  assert.throws(() => scaleHorizonRow(10, 0, 100), /positive/);
});
