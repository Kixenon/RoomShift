import { cacheSnapshot, fieldSceneKey } from './room-field-analysis.js';
const MODES = new Set(['airflow', 'temperature', 'light', 'wifi']);
const DISPLAY_STYLES = Object.freeze({
  airflow: new Set(['volume', 'slice']),
  temperature: new Set(['surfaces', 'volume', 'slice']),
  light: new Set(['preview', 'map']),
  wifi: new Set(['slice', 'volume']),
});

export class RoomFieldController {
  constructor({ worker, viewport, onState = () => {}, debounceMs = 100 }) {
    if (!worker || !viewport) throw new TypeError('A worker and viewport are required.');
    this.worker = worker;
    this.viewport = viewport;
    this.onState = onState;
    this.debounceMs = debounceMs;
    this.playing = false;
    this.playbackTimer = null;
    this.nextFrameAt = 0;
    this.scene = null;
    this.mode = null;
    this.displayStyles = { airflow: 'volume', temperature: 'surfaces', light: 'preview', wifi: 'volume' };
    this.sliceHeight = 1.2;
    this.durationSeconds = 3;
    this.cellSize = 0.15;
    this.cache = new Map();
    this.baseline = null;
    this.probe = { x: 2.6, y: 1.2, z: 2 };
    this.displayRanges = { temperature: { minimum: 10, maximum: 30 }, speedMaximum: 2.5 };
    this.result = null;
    this.latestRequestId = 0;
    this.inFlight = null;
    this.pendingRequest = null;
    this.timer = null;
    this.interactionActive = false;
    this.deferredScene = false;
    this.handleMessage = this.handleMessage.bind(this);
    this.handleWorkerError = this.handleWorkerError.bind(this);
    this.worker.addEventListener('message', this.handleMessage);
    this.worker.addEventListener('error', this.handleWorkerError);
  }

  setScene(scene) {
    this.stopPlayback();
    this.scene = scene;
    this.probe = { x: Math.min(this.probe.x, scene.room.width), y: Math.min(this.probe.y, scene.room.height), z: Math.min(this.probe.z, scene.room.depth) };
    this.sliceHeight = Math.min(this.sliceHeight, scene.room.height);
    if (!this.mode || (this.mode === 'light' && this.displayStyles.light === 'preview')) return;
    if (this.interactionActive) {
      if (!this.deferredScene) {
        this.deferredScene = true;
        this.cancelInFlight();
        this.latestRequestId += 1;
        this.pendingRequest = null;
        clearTimeout(this.timer);
        this.timer = null;
      }
      this.emitState({ mode: this.mode, loading: false, result: this.result, stale: true, displayStyle: this.displayStyle });
      return;
    }
    this.scheduleUpdate({ preserveResult: true });
  }

  setInteractionActive(active) {
    this.interactionActive = Boolean(active);
    if (!this.interactionActive && this.deferredScene) {
      this.deferredScene = false;
      if (this.mode && !(this.mode === 'light' && this.displayStyles.light === 'preview')) {
        if (this.result && this.mode === 'temperature' && this.displayStyle === 'surfaces') {
          this.viewport.setFields(this.result, this.mode, {
            displayStyle: this.displayStyle,
            sliceHeight: this.sliceHeight,
            objectGroups: this.viewport.groups,
          });
        }
        this.scheduleUpdate({ preserveResult: true });
      }
    }
  }

  setMode(mode) {
    this.stopPlayback();
    if (mode !== null && !MODES.has(mode)) throw new RangeError(`Unsupported room field mode: ${mode}`);
    this.mode = mode;
    this.result = null;
    this.deferredScene = false;
    this.viewport.clearFields();
    if (!mode) {
      this.cancelInFlight();
      this.latestRequestId += 1;
      this.pendingRequest = null;
      clearTimeout(this.timer);
      this.timer = null;
      this.emitState({ mode: null, loading: false, result: null, error: null });
      return;
    }
    if (mode === 'light' && this.displayStyles.light === 'preview') {
      this.cancelInFlight();
      this.latestRequestId += 1;
      this.pendingRequest = null;
      clearTimeout(this.timer);
      this.timer = null;
      this.viewport.setLightingPreview(true);
      this.emitState({ mode, loading: false, result: null, error: null, displayStyle: this.displayStyle });
      return;
    }
    this.scheduleUpdate();
  }

  get displayStyle() {
    return this.displayStyles[this.mode] ?? null;
  }

  setDisplayStyle(style) {
    if (!this.mode || !DISPLAY_STYLES[this.mode]?.has(style)) return;
    if (this.displayStyles[this.mode] === style) return;
    this.displayStyles[this.mode] = style;
    if (this.mode !== 'light') {
      const loading = Boolean(this.pendingRequest || this.inFlight);
      if (this.result) this.viewport.setFields(this.result, this.mode, { displayStyle: style, sliceHeight: this.sliceHeight, objectGroups: this.viewport.groups });
      this.emitState({ mode: this.mode, loading, result: this.result, stale: loading, displayStyle: style });
      return;
    }
    this.cancelInFlight();
    this.latestRequestId += 1;
    this.pendingRequest = null;
    clearTimeout(this.timer);
    this.timer = null;
    if (this.mode === 'light' && style === 'preview') {
      this.result = null;
      this.viewport.clearFields();
      this.viewport.setLightingPreview(true);
      this.emitState({ mode: this.mode, loading: false, result: null, error: null, displayStyle: style });
      return;
    }
    if (this.result) {
      this.viewport.setFields(this.result, this.mode, {
        displayStyle: style,
        sliceHeight: this.sliceHeight,
        objectGroups: this.viewport.groups,
      });
      this.emitState({ mode: this.mode, loading: false, result: this.result, error: null, displayStyle: style });
      return;
    }
    this.viewport.clearFields();
    this.scheduleUpdate();
  }

  setSliceHeight(height) {
    if (!this.scene || !Number.isFinite(height)) return;
    this.sliceHeight = Math.min(this.scene.room.height, Math.max(0, height));
    if (this.result && ['airflow', 'temperature', 'wifi'].includes(this.mode) && this.displayStyle === 'slice') {
      this.viewport.setFields(this.result, this.mode, {
        displayStyle: this.displayStyle,
        sliceHeight: this.sliceHeight,
        objectGroups: this.viewport.groups,
      });
    }
    this.emitState({ mode: this.mode, loading: Boolean(this.pendingRequest || this.inFlight), result: this.result, stale: Boolean(this.pendingRequest || this.inFlight), error: null, displayStyle: this.displayStyle });
  }

  setComparison(baseline, probe = this.probe) {
    this.baseline = baseline;
    this.probe = probe;
    if (['airflow', 'temperature'].includes(this.mode)) this.scheduleUpdate({ preserveResult: true });
  }

  setDisplayRanges(ranges) {
    this.displayRanges = ranges;
    if (this.result) {
      this.result.displayRanges = ranges;
      this.viewport.setFields(this.result, this.mode, { displayStyle: this.displayStyle, sliceHeight: this.sliceHeight, objectGroups: this.viewport.groups });
      this.emitState({ mode: this.mode, loading: Boolean(this.inFlight || this.pendingRequest), result: this.result, stale: Boolean(this.inFlight || this.pendingRequest) });
    }
  }

  stopPlayback() {
    this.playing = false;
    clearTimeout(this.playbackTimer);
    this.playbackTimer = null;
  }

  setPlaying(playing) {
    if (!playing && !this.playing) return;
    this.stopPlayback();
    this.playing = Boolean(playing) && ['airflow', 'temperature'].includes(this.mode);
    this.nextFrameAt = performance.now() + 500;
    if (this.playing && this.durationSeconds >= 120) this.setSimulationTime(0);
    this.emitState({ mode: this.mode, loading: Boolean(this.pendingRequest || this.inFlight), result: this.result, displayStyle: this.displayStyle });
  }

  emitState(state) {
    clearTimeout(this.playbackTimer);
    this.playbackTimer = null;
    if (state.error || !['airflow', 'temperature'].includes(state.mode) || (this.durationSeconds >= 120 && !state.loading)) this.playing = false;
    this.onState({ ...state, playing: this.playing });
    if (!this.playing || state.loading || state.result?.durationSeconds !== this.durationSeconds) return;
    this.playbackTimer = setTimeout(() => {
      this.playbackTimer = null;
      this.nextFrameAt = performance.now() + 500;
      this.setSimulationTime(Math.min(120, this.durationSeconds + 0.5));
    }, Math.max(0, this.nextFrameAt - performance.now()));
  }

  setSimulationTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > 120 || seconds === this.durationSeconds) return;
    this.durationSeconds = seconds;
    if (['airflow', 'temperature'].includes(this.mode)) this.scheduleUpdate({ preserveResult: true });
  }

  setResolution(cellSize) {
    if (![0.075, 0.15, 0.25].includes(cellSize) || cellSize === this.cellSize) return;
    this.cellSize = cellSize;
    if (['airflow', 'temperature'].includes(this.mode)) this.scheduleUpdate({ preserveResult: true });
  }

  cacheKey() {
    return JSON.stringify([['light', 'wifi'].includes(this.mode) ? this.scene : fieldSceneKey(this.scene, this.cellSize), ['light', 'wifi'].includes(this.mode) ? this.mode : 'fields', this.durationSeconds, this.cellSize, this.baseline && fieldSceneKey(this.baseline, this.cellSize), this.probe]);
  }

  scheduleUpdate({ preserveResult = false } = {}) {
    if (!this.scene || !this.mode) return;
    this.cancelInFlight();
    this.latestRequestId += 1;
    const cached = this.cache.get(this.cacheKey());
    if (cached) {
      clearTimeout(this.timer);
      this.timer = null;
      this.pendingRequest = null;
      cached.displayRanges = this.displayRanges;
      this.result = cached;
      this.viewport.setFields(cached, this.mode, { displayStyle: this.displayStyle, sliceHeight: this.sliceHeight, objectGroups: this.viewport.groups });
      this.emitState({ mode: this.mode, loading: false, result: cached, displayStyle: this.displayStyle });
      return;
    }
    if (!preserveResult) this.result = null;
    this.pendingRequest = {
      requestId: this.latestRequestId,
      mode: this.mode,
      scene: this.scene,
      displayStyle: this.displayStyle,
      durationSeconds: this.durationSeconds,
      cellSize: this.cellSize,
      baseline: this.baseline,
      probe: this.probe,
    };
    if (!preserveResult) this.viewport.clearFields();
    this.emitState({ mode: this.mode, loading: true, result: this.result, error: null, stale: preserveResult, displayStyle: this.displayStyle });
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.pump();
    }, this.debounceMs);
  }

  cancelInFlight() {
    if (!this.inFlight || this.inFlight.cancelRequested) return;
    this.inFlight.cancelRequested = true;
    this.worker.postMessage({ type: 'cancel', requestId: this.inFlight.requestId });
  }

  pump() {
    if (this.inFlight || !this.pendingRequest) return;
    this.inFlight = this.pendingRequest;
    this.pendingRequest = null;
    this.worker.postMessage(this.inFlight);
  }

  handleMessage(event) {
    const response = event.data;
    if (!this.inFlight || response.requestId !== this.inFlight.requestId) return;
    const request = this.inFlight;
    if (!response.progress) this.inFlight = null;
    const isCurrent = request.requestId === this.latestRequestId && request.mode === this.mode;
    if (isCurrent) {
      if (response.error) {
        this.result = null;
        this.viewport.clearFields();
        this.emitState({ mode: this.mode, loading: false, result: null, error: response.error, displayStyle: this.displayStyle });
      } else {
        response.result.displayRanges = this.displayRanges;
        this.result = response.result;
        if (!response.progress) {
          cacheSnapshot(this.cache, this.cacheKey(), response.result);
        }
        this.viewport.setFields(response.result, this.mode, {
          displayStyle: this.displayStyle,
          sliceHeight: this.sliceHeight,
          objectGroups: this.viewport.groups,
        });
        this.emitState({ mode: this.mode, loading: Boolean(response.progress), result: response.result, error: null, stale: false, displayStyle: this.displayStyle });
      }
    }
    if (!response.progress && this.pendingRequest) this.pump();
  }

  handleWorkerError(event) {
    const request = this.inFlight;
    this.inFlight = null;
    if (request?.requestId === this.latestRequestId && request.mode === this.mode) {
      this.result = null;
      this.viewport.clearFields();
      this.emitState({
        mode: this.mode,
        loading: false,
        result: null,
        error: event.message || 'Field worker failed.',
        displayStyle: this.displayStyle,
      });
    }
    if (this.pendingRequest) this.pump();
  }

  dispose() {
    this.stopPlayback();
    clearTimeout(this.timer);
    this.worker.removeEventListener('message', this.handleMessage);
    this.worker.removeEventListener('error', this.handleWorkerError);
    this.worker.terminate?.();
  }
}
