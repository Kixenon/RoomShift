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

const scene = (id) => ({ room: { width: 5.2, depth: 4, height: 2.7 }, objects: [{ id, position: { x: { one: 1, two: 2, three: 3 }[id] ?? 0 } }] });

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

  assert.deepEqual(harness.rendered[0].slice(0, 2), [result, 'airflow']);
  assert.deepEqual(harness.rendered[0][2], { displayStyle: 'volume', sliceHeight: 1.2, objectGroups: undefined });
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
  assert.deepEqual(harness.rendered[0].slice(0, 2), [latest, 'temperature']);
  assert.equal(harness.rendered[0][2].displayStyle, 'surfaces');
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

test('a failed current solve clears the previous field instead of leaving stale results visible', async (t) => {
  const harness = createHarness(t);
  harness.controller.setScene(scene('one'));
  harness.controller.setMode('temperature');
  await flushTimers();
  const first = harness.worker.requests[0];
  harness.worker.respond({ requestId: first.requestId, result: { grid: {}, fields: {}, stats: {} } });

  harness.controller.setScene(scene('two'));
  await flushTimers();
  const latest = harness.worker.requests[1];
  harness.worker.respond({ requestId: latest.requestId, error: { message: 'solve failed' } });

  assert.equal(harness.controller.result, null);
  assert.ok(harness.cleared.length >= 2);
  assert.equal(harness.states.at(-1).result, null);
  assert.equal(harness.states.at(-1).error.message, 'solve failed');
});

test('a worker crash clears the current field result', async (t) => {
  const harness = createHarness(t);
  harness.controller.setScene(scene('one'));
  harness.controller.setMode('airflow');
  await flushTimers();
  const request = harness.worker.requests[0];
  harness.worker.respond({ requestId: request.requestId, result: { grid: {}, fields: {}, stats: {} } });

  harness.controller.setScene(scene('two'));
  await flushTimers();
  const failure = new Event('error');
  failure.message = 'worker crashed';
  harness.worker.dispatchEvent(failure);

  assert.equal(harness.controller.result, null);
  assert.ok(harness.cleared.length >= 2);
  assert.equal(harness.states.at(-1).error, 'worker crashed');
});

test('progress renders the solved time point without releasing the active request', async (t) => {
  const harness = createHarness(t);
  harness.controller.setScene(scene('one'));
  harness.controller.setMode('airflow');
  await flushTimers();
  const request = harness.worker.requests[0];
  const result = { grid: {}, fields: {}, stats: {}, durationSeconds: 0.5 };
  harness.worker.respond({ requestId: request.requestId, result, progress: true });
  assert.equal(harness.controller.inFlight.requestId, request.requestId);
  assert.equal(harness.states.at(-1).loading, true);
  harness.worker.respond({ requestId: request.requestId, result: { ...result, durationSeconds: 3 } });
  assert.equal(harness.controller.inFlight, null);
  assert.equal(harness.states.at(-1).loading, false);
});

test('mode switching reuses air/heat results and time changes carry the requested elapsed time', async (t) => {
  const harness = createHarness(t);
  harness.controller.setScene(scene('one'));
  harness.controller.setMode('airflow');
  await flushTimers();
  const request = harness.worker.requests[0];
  harness.worker.respond({ requestId: request.requestId, result: { grid: {}, fields: {}, stats: {}, durationSeconds: 3 } });
  harness.controller.setMode('temperature');
  await flushTimers();
  assert.equal(harness.worker.requests.length, 1);
  assert.equal(harness.rendered.at(-1)[1], 'temperature');
  harness.controller.setSimulationTime(10);
  await flushTimers();
  assert.equal(harness.worker.requests.at(-1).durationSeconds, 10);
});

test('changing the display while an edited scene solves does not cancel that solve', async (t) => {
  const harness = createHarness(t);
  harness.controller.setScene(scene('one'));
  harness.controller.setMode('airflow');
  await flushTimers();
  let request = harness.worker.requests.at(-1);
  harness.worker.respond({ requestId: request.requestId, result: { grid: {}, fields: {}, stats: {} } });
  harness.controller.setScene(scene('two'));
  await flushTimers();
  request = harness.worker.requests.at(-1);
  harness.controller.setDisplayStyle('slice');
  assert.equal(harness.controller.inFlight.requestId, request.requestId);
  assert.equal(harness.controller.inFlight.cancelRequested, undefined);
  harness.worker.respond({ requestId: request.requestId, result: { grid: {}, fields: {}, stats: {} } });
  assert.equal(harness.rendered.at(-1)[2].displayStyle, 'slice');
  assert.equal(harness.states.at(-1).loading, false);
});


test('playback buffers pending solves and pause prevents another frame', async (t) => {
  const { controller, worker } = createHarness(t);
  controller.setScene(scene('one'));
  controller.setMode('airflow');
  await flushTimers();
  controller.setPlaying(true);
  await new Promise((resolve) => setTimeout(resolve, 520));
  assert.equal(worker.requests.length, 1);
  worker.respond({ requestId: worker.requests[0].requestId, result: { durationSeconds: 3, grid: {}, fields: {}, stats: {} } });
  const deadline = performance.now() + 2000;
  while (worker.requests.length < 2 && performance.now() < deadline) await flushTimers();
  assert.equal(worker.requests.at(-1).durationSeconds, 3.1);
  const request = worker.requests.at(-1);
  await new Promise((resolve) => setTimeout(resolve, 520));
  assert.equal(worker.requests.length, 2);
  worker.respond({ requestId: request.requestId, progress: true, result: { durationSeconds: 3.05, grid: {}, fields: {}, stats: {} } });
  assert.equal(controller.inFlight.requestId, request.requestId);
  controller.setPlaying(false);
  worker.respond({ requestId: request.requestId, result: { durationSeconds: 3.1, grid: {}, fields: {}, stats: {} } });
  await new Promise((resolve) => setTimeout(resolve, 520));
  assert.equal(worker.requests.length, 2);
  assert.equal(controller.playing, false);
});

test('playback stops at the endpoint and when the mode changes', async (t) => {
  const { controller, worker } = createHarness(t);
  controller.setScene(scene('one'));
  controller.setMode('temperature');
  await flushTimers();
  controller.setPlaying(true);
  controller.setMode('wifi');
  assert.equal(controller.playing, false);
  controller.setMode('temperature');
  controller.setSimulationTime(120);
  controller.playing = true;
  controller.emitState({ mode: 'temperature', loading: false, result: { durationSeconds: 120 } });
  assert.equal(controller.playing, false);
});


test('playback accepts fractional solver times and bypasses edit debounce', async (t) => {
  const { controller, worker } = createHarness(t, 1000);
  controller.setScene(scene('one'));
  controller.setMode('airflow');
  controller.setSimulationTime(3.3);
  controller.setPlaying(true);
  controller.pump();
  worker.respond({ requestId: worker.requests[0].requestId, result: { durationSeconds: 3.3000000000000003, grid: {}, fields: {}, stats: {} } });
  const deadline = performance.now() + 600;
  while (worker.requests.length < 2 && performance.now() < deadline) await flushTimers();
  assert.equal(worker.requests.at(-1).durationSeconds, 3.4);
});


test('physical edits restart ongoing playback at zero but object names preserve elapsed time', async (t) => {
  const { controller } = createHarness(t);
  controller.setScene(scene('one'));
  controller.setMode('temperature');
  controller.setSimulationTime(10);
  controller.setScene({ ...scene('one'), objects: [{ ...scene('one').objects[0], name: 'Renamed' }] });
  assert.equal(controller.durationSeconds, 10);
  controller.setPlaying(true);
  controller.setScene(scene('two'));
  assert.equal(controller.durationSeconds, 0);
  assert.equal(controller.playing, true);
});
