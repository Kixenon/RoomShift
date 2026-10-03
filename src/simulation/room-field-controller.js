const MODES = new Set(['airflow', 'temperature', 'light']);

export class RoomFieldController {
  constructor({ worker, viewport, onState = () => {}, debounceMs = 100 }) {
    if (!worker || !viewport) throw new TypeError('A worker and viewport are required.');
    this.worker = worker;
    this.viewport = viewport;
    this.onState = onState;
    this.debounceMs = debounceMs;
    this.scene = null;
    this.mode = null;
    this.latestRequestId = 0;
    this.inFlight = null;
    this.pendingRequest = null;
    this.timer = null;
    this.handleMessage = this.handleMessage.bind(this);
    this.handleWorkerError = this.handleWorkerError.bind(this);
    this.worker.addEventListener('message', this.handleMessage);
    this.worker.addEventListener('error', this.handleWorkerError);
  }

  setScene(scene) {
    this.scene = scene;
    if (this.mode && this.mode !== 'light') this.scheduleUpdate();
  }

  setMode(mode) {
    if (mode !== null && !MODES.has(mode)) throw new RangeError(`Unsupported room field mode: ${mode}`);
    this.mode = mode;
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
    if (mode === 'light') {
      this.cancelInFlight();
      this.latestRequestId += 1;
      this.pendingRequest = null;
      clearTimeout(this.timer);
      this.timer = null;
      this.viewport.setLightingPreview(true);
      this.onState({ mode, loading: false, result: null, error: null });
      return;
    }
    this.scheduleUpdate();
  }

  scheduleUpdate() {
    if (!this.scene || !this.mode) return;
    this.cancelInFlight();
    this.latestRequestId += 1;
    this.pendingRequest = {
      requestId: this.latestRequestId,
      mode: this.mode,
      scene: this.scene,
    };
    this.viewport.clearFields();
    this.onState({ mode: this.mode, loading: true, result: null, error: null });
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
        this.onState({ mode: this.mode, loading: false, result: null, error: response.error });
      } else {
        this.viewport.setFields(response.result, this.mode);
        this.onState({ mode: this.mode, loading: false, result: response.result, error: null });
      }
    }
    if (this.pendingRequest) this.pump();
  }

  handleWorkerError(event) {
    this.inFlight = null;
    this.onState({ mode: this.mode, loading: false, result: null, error: event.message || 'Field worker failed.' });
    if (this.pendingRequest) this.pump();
  }

  dispose() {
    clearTimeout(this.timer);
    this.worker.removeEventListener('message', this.handleMessage);
    this.worker.removeEventListener('error', this.handleWorkerError);
    this.worker.terminate?.();
  }
}
