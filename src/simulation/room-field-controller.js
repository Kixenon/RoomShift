const MODES = new Set(['airflow', 'temperature', 'light', 'wifi']);
const DISPLAY_STYLES = Object.freeze({
  airflow: new Set(['gas', 'volume', 'slice']),
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
    this.scene = null;
    this.mode = null;
    this.displayStyles = { airflow: 'gas', temperature: 'surfaces', light: 'preview', wifi: 'slice' };
    this.sliceHeight = 1.2;
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
    this.scene = scene;
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
      this.onState({ mode: this.mode, loading: false, result: this.result, stale: true, displayStyle: this.displayStyle });
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
      this.onState({ mode: null, loading: false, result: null, error: null });
      return;
    }
    if (mode === 'light' && this.displayStyles.light === 'preview') {
      this.cancelInFlight();
      this.latestRequestId += 1;
      this.pendingRequest = null;
      clearTimeout(this.timer);
      this.timer = null;
      this.viewport.setLightingPreview(true);
      this.onState({ mode, loading: false, result: null, error: null, displayStyle: this.displayStyle });
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
    this.cancelInFlight();
    this.latestRequestId += 1;
    this.pendingRequest = null;
    clearTimeout(this.timer);
    this.timer = null;
    if (this.mode === 'light' && style === 'preview') {
      this.result = null;
      this.viewport.clearFields();
      this.viewport.setLightingPreview(true);
      this.onState({ mode: this.mode, loading: false, result: null, error: null, displayStyle: style });
      return;
    }
    if (this.result) {
      this.viewport.setFields(this.result, this.mode, {
        displayStyle: style,
        sliceHeight: this.sliceHeight,
        objectGroups: this.viewport.groups,
      });
      this.onState({ mode: this.mode, loading: false, result: this.result, error: null, displayStyle: style });
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
    this.onState({ mode: this.mode, loading: Boolean(this.pendingRequest || this.inFlight), result: this.result, error: null, displayStyle: this.displayStyle });
  }

  scheduleUpdate({ preserveResult = false } = {}) {
    if (!this.scene || !this.mode) return;
    this.cancelInFlight();
    this.latestRequestId += 1;
    if (!preserveResult) this.result = null;
    this.pendingRequest = {
      requestId: this.latestRequestId,
      mode: this.mode,
      scene: this.scene,
      displayStyle: this.displayStyle,
    };
    if (!preserveResult) this.viewport.clearFields();
    this.onState({ mode: this.mode, loading: true, result: this.result, error: null, stale: preserveResult, displayStyle: this.displayStyle });
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
    this.inFlight = null;
    const isCurrent = request.requestId === this.latestRequestId && request.mode === this.mode;
    if (isCurrent) {
      if (response.error) {
        this.result = null;
        this.viewport.clearFields();
        this.onState({ mode: this.mode, loading: false, result: null, error: response.error, displayStyle: this.displayStyle });
      } else {
        this.result = response.result;
        this.viewport.setFields(response.result, this.mode, {
          displayStyle: this.displayStyle,
          sliceHeight: this.sliceHeight,
          objectGroups: this.viewport.groups,
        });
        this.onState({ mode: this.mode, loading: false, result: response.result, error: null, stale: false, displayStyle: this.displayStyle });
      }
    }
    if (this.pendingRequest) this.pump();
  }

  handleWorkerError(event) {
    const request = this.inFlight;
    this.inFlight = null;
    if (request?.requestId === this.latestRequestId && request.mode === this.mode) {
      this.result = null;
      this.viewport.clearFields();
      this.onState({
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
    clearTimeout(this.timer);
    this.worker.removeEventListener('message', this.handleMessage);
    this.worker.removeEventListener('error', this.handleWorkerError);
    this.worker.terminate?.();
  }
}
