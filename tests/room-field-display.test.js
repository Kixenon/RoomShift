import assert from 'node:assert/strict';
import test from 'node:test';
import { temperatureDisplayRange } from '../src/simulation/room-field-display.js';

test('scenarios share a fixed temperature scale unless the user changes it', () => {
  for (const maxTemperature of [20.2, 24, 40]) assert.deepEqual(temperatureDisplayRange({ ambientTemperature: 20, stats: { maxTemperature } }), { minimum: 10, maximum: 30 });
  assert.deepEqual(temperatureDisplayRange({ displayRanges: { temperature: { minimum: -10, maximum: 25 } } }), { minimum: -10, maximum: 25 });
});
