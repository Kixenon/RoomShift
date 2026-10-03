import assert from 'node:assert/strict';
import test from 'node:test';
import { temperatureDisplayRange } from '../src/simulation/room-field-display.js';

test('temperature display range follows solved values and pads near-uniform fields', () => {
  assert.deepEqual(temperatureDisplayRange({
    ambientTemperature: 20,
    stats: { minTemperature: 10, maxTemperature: 24 },
  }), { minimum: 10, maximum: 24 });
  assert.deepEqual(temperatureDisplayRange({
    ambientTemperature: 20,
    stats: { minTemperature: 20, maxTemperature: 20.2 },
  }), { minimum: 19.5, maximum: 20.5 });
});
