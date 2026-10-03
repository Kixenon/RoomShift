import assert from 'node:assert/strict';
import test from 'node:test';
import { RoomFieldController } from '../src/simulation/room-field-controller.js';

class FakeWorker extends EventTarget {
  requests = [];
  cancellations = [];
  postMessage(request) {
    if (request.type === 'cancel') this.cancellations.push(request.requestId);
    else this.requests.push(request);
  }
  respond(data) { this.dispatchEvent(new MessageEvent('message', { data })); }
}

function createHarness(t, debounceMs = 0) {
  const worker = new FakeWorker();
  const rendered = [];
  const cleared = [];
  const lightingPreview = [];
  const states = [];
  const viewport = {
    setFields: (...args) => rendered.push(args),
    clearFields: () => cleared.push(true),
    setLightingPreview: (enabled) => lightingPreview.push(enabled),
  };
  const controller = new RoomFieldController({
    worker,
    viewport,
    onState: (state) => states.push(state),
    debounceMs,
  });
  t.after(() => controller.dispose());
  return { worker, viewport, rendered, cleared, states, controller, lightingPreview };
}

const flushTimers = () => new Promise((resolve) => setTimeout(resolve, 5));

const scene = (id) => ({ room: { width: 5.2, depth: 4, height: 2.7 }, objects: [{ id }] });

test('selecting a field mode sends the current scene and renders its worker result', async (t) => {
  const harness = createHarness(t);
  harness.controller.setScene(scene('one'));
  harness.controller.setMode('airflow');
  await flushTimers();

  assert.equal(harness.worker.requests.length, 1);
  const request = harness.worker.requests[0];
  assert.equal(request.mode, 'airflow');
  assert.deepEqual(request.scene, scene('one'));
  const result = { grid: { nx: 1, ny: 1, nz: 1 }, fields: {}, stats: {} };
  harness.worker.respond({ requestId: request.requestId, result });

  assert.deepEqual(harness.rendered, [[result, 'airflow', { volumetric: false, objectGroups: undefined }]]);
  assert.equal(harness.states.at(-1).loading, false);
  assert.equal(harness.states.at(-1).result, result);
});

test('rapid edits coalesce and stale worker results are not rendered', async (t) => {
  const harness = createHarness(t);
  harness.controller.setScene(scene('one'));
  harness.controller.setMode('temperature');
  await flushTimers();
  const first = harness.worker.requests[0];

  harness.controller.setScene(scene('two'));
  harness.controller.setScene(scene('three'));
  await flushTimers();
  assert.equal(harness.worker.requests.length, 1, 'only one job may be in flight');
  assert.deepEqual(harness.worker.cancellations, [first.requestId]);

  harness.worker.respond({ requestId: first.requestId, result: { stale: true } });
  await flushTimers();
  assert.equal(harness.rendered.length, 0);
  assert.equal(harness.worker.requests.length, 2);
  assert.deepEqual(harness.worker.requests[1].scene, scene('three'));

  const latest = { grid: { nx: 1, ny: 1, nz: 1 }, fields: {}, stats: {} };
  harness.worker.respond({ requestId: harness.worker.requests[1].requestId, result: latest });
  assert.deepEqual(harness.rendered, [[latest, 'temperature', { volumetric: false, objectGroups: undefined }]]);
});

test('clearing the field mode cancels pending work and clears the overlay', async (t) => {
  const harness = createHarness(t);
  harness.controller.setScene(scene('one'));
  harness.controller.setMode('light');
  harness.controller.setMode(null);
  await flushTimers();

  assert.equal(harness.worker.requests.length, 0);
  assert.ok(harness.cleared.length >= 1);
  assert.equal(harness.states.at(-1).mode, null);
  assert.equal(harness.states.at(-1).loading, false);
});
