import type { LatLon } from '$shared/geo';
import { fullJitterDelay } from '$shared/signalk';
import { MarineRadarStore } from './marine-radar-store.svelte';
import { createPpiLayer, type PpiLayer } from './ppi-layer';
import {
  type ControlWrite,
  capabilitiesFromControls,
  discoverRadars,
  fetchCapabilities,
  fetchRadarControls,
  parseRadarControls,
  setPower as setPowerRequest,
  spokesUrl,
  writeControl,
} from './radar-client';
import type { RadarFrame } from './radar-frame-core';
import { POWER_PENDING_KEY, type RadarControlEntry, type RadarStatus } from './radar-types';
import { createRadarWorkerClient, type RadarWorkerClient } from './radar-worker-client';

export interface MarineRadarDeps {
  origin: string;
  getToken: () => string | undefined;
  getCenter: () => LatLon | undefined;
  getHeading?: () => number | undefined;
  centerFresh?: () => boolean;
  headingFresh?: () => boolean;
  radarAvailable: () => boolean;
}

const FLUSH_HZ = 15;
const REOPEN_BASE_MS = 1000;
const REOPEN_MAX_MS = 30_000;
const CONTROL_POLL_MS = 15_000;
const PENDING_MS = 3000;
const STALE_MS = 5000;

export function createMarineRadarController(deps: MarineRadarDeps) {
  const store = new MarineRadarStore();
  let overlayVisible = false;
  const layer: PpiLayer = createPpiLayer(
    store,
    deps.getCenter,
    deps.getHeading,
    (visible) => {
      overlayVisible = visible;
      void syncStreamLifecycle();
    },
    { center: deps.centerFresh, heading: deps.headingFresh },
  );
  let worker: RadarWorkerClient | undefined;
  let disposed = false;
  let documentVisible = typeof document === 'undefined' || !document.hidden;
  let reopenTimer: ReturnType<typeof setTimeout> | undefined;
  let reopenAttempt = 0;
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let staleTimer: ReturnType<typeof setInterval> | undefined;
  let liveFrame: RadarFrame | undefined;
  let discoveryGeneration = 0;
  let selectionGeneration = 0;
  let streamGeneration = 0;
  let streamRadarId: string | undefined;
  const pending = new Map<string, number>();
  const writeGenerations = new Map<string, number>();

  function markPending(id: string): void {
    pending.set(id, Date.now() + PENDING_MS);
  }

  function pendingIds(): Set<string> {
    const now = Date.now();
    const live = new Set<string>();
    for (const [id, expiry] of pending) {
      if (expiry > now) live.add(id);
      else pending.delete(id);
    }
    return live;
  }

  function clearReopen(): void {
    if (reopenTimer) clearTimeout(reopenTimer);
    reopenTimer = undefined;
  }

  function shouldStream(): boolean {
    return (
      !disposed &&
      overlayVisible &&
      documentVisible &&
      store.operationalStatus === 'transmit' &&
      store.selected !== undefined &&
      deps.radarAvailable()
    );
  }

  async function closeStream(status: 'idle' | 'paused' = 'paused'): Promise<void> {
    streamGeneration += 1;
    streamRadarId = undefined;
    clearReopen();
    if (worker) await worker.close().catch(() => undefined);
    if (liveFrame) worker?.recycle(liveFrame.buffer);
    liveFrame = undefined;
    layer.clearFrame();
    store.lastSpokeAt = undefined;
    store.setStatus(status);
  }

  function scheduleReopen(): void {
    if (!shouldStream() || reopenTimer) return;
    reopenAttempt += 1;
    streamRadarId = undefined;
    store.setStatus('error', 'The radar spoke stream disconnected. Reconnecting.');
    reopenTimer = setTimeout(
      () => {
        reopenTimer = undefined;
        void openSelectedStream();
      },
      fullJitterDelay(reopenAttempt, REOPEN_BASE_MS, REOPEN_MAX_MS),
    );
  }

  async function hydrateControls(radarId: string, generation: number): Promise<void> {
    const controls = await fetchRadarControls(deps.origin, deps.getToken(), radarId);
    if (disposed || generation !== selectionGeneration || store.selectedId !== radarId || !controls)
      return;
    store.reconcile(controls, pendingIds());
  }

  function setPolling(active: boolean): void {
    if (disposed) return;
    if (!active) {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = undefined;
      return;
    }
    const radar = store.selected;
    if (radar) void hydrateControls(radar.id, selectionGeneration);
    if (!pollTimer) {
      pollTimer = setInterval(() => {
        const selected = store.selected;
        if (selected) void hydrateControls(selected.id, selectionGeneration);
      }, CONTROL_POLL_MS);
    }
  }

  function startFreshnessWatch(): void {
    if (staleTimer) return;
    staleTimer = setInterval(() => {
      if (!shouldStream() || store.lastSpokeAt === undefined) return;
      if (Date.now() - store.lastSpokeAt > STALE_MS && store.status !== 'stale') {
        store.setStatus(
          'stale',
          'No fresh spokes have arrived. The old radar picture was cleared.',
        );
        layer.clearFrame();
      }
    }, 1000);
  }

  async function openSelectedStream(): Promise<void> {
    const radar = store.selected;
    if (!radar || !shouldStream()) return;
    if (streamRadarId === radar.id && ['connecting', 'waiting', 'live'].includes(store.status))
      return;
    clearReopen();
    if (!worker) worker = createRadarWorkerClient();
    const generation = ++streamGeneration;
    streamRadarId = radar.id;
    store.setStatus('connecting');
    let url: string;
    try {
      url = spokesUrl(deps.origin, radar, deps.getToken());
      await worker.open(
        url,
        radar.spokesPerRevolution,
        radar.maxSpokeLen,
        radar.range,
        FLUSH_HZ,
        (frame) => {
          if (disposed || generation !== streamGeneration || store.selectedId !== radar.id) {
            worker?.recycle(frame.buffer);
            return;
          }
          if (frame.spokeCount <= 0) {
            worker?.recycle(frame.buffer);
            return;
          }
          const spent = liveFrame;
          liveFrame = frame;
          layer.pushFrame(frame);
          if (spent) worker?.recycle(spent.buffer);
          store.lastSpokeAt = Date.now();
          store.setStatus('live');
          reopenAttempt = 0;
        },
        (status) => {
          if (disposed || generation !== streamGeneration) return;
          if (status === 'open')
            store.setStatus('waiting', 'Connected and waiting for radar spokes.');
          else scheduleReopen();
        },
      );
    } catch (error) {
      if (generation !== streamGeneration) return;
      streamRadarId = undefined;
      store.setStatus(
        'error',
        error instanceof Error ? error.message : 'The radar spoke stream could not be opened.',
      );
      scheduleReopen();
    }
  }

  async function syncStreamLifecycle(): Promise<void> {
    if (shouldStream()) await openSelectedStream();
    else await closeStream(store.selected ? 'paused' : 'idle');
  }

  async function loadSelected(): Promise<void> {
    const radar = store.selected;
    const generation = ++selectionGeneration;
    if (!radar) {
      await closeStream('idle');
      return;
    }
    const [caps] = await Promise.all([
      fetchCapabilities(deps.origin, deps.getToken(), radar.id),
      hydrateControls(radar.id, generation),
    ]);
    if (disposed || generation !== selectionGeneration || store.selectedId !== radar.id) return;
    store.setCapabilities(caps?.controls ?? capabilitiesFromControls(radar));
    await syncStreamLifecycle();
  }

  async function refresh(): Promise<void> {
    if (disposed) return;
    const generation = ++discoveryGeneration;
    if (!deps.radarAvailable()) {
      store.setAvailability('absent');
      store.setDiscovered([]);
      await closeStream('idle');
      return;
    }
    store.setAvailability('probing');
    const result = await discoverRadars(deps.origin, deps.getToken());
    if (disposed || generation !== discoveryGeneration) return;
    store.setAvailability(result.availability);
    store.setDiscovered(result.radars);
    if (result.availability === 'auth-required') store.setControlsForbidden(true);
    store.statusDetail = result.detail;
    await loadSelected();
  }

  function selectRadar(id: string): void {
    if (id === store.selectedId) return;
    clearReopen();
    reopenAttempt = 0;
    store.select(id);
    layer.clearFrame();
    void loadSelected();
  }

  function errorMessage(status: number): string {
    if (status === 401 || status === 403) return 'Read-write radar access is required.';
    if (status === 0) return 'The radar provider could not be reached.';
    return `The radar rejected the change (HTTP ${status}).`;
  }

  async function setControl(controlId: string, write: ControlWrite): Promise<void> {
    const radar = store.selected;
    if (!radar) return;
    const priorExists = Object.hasOwn(store.controlValues, controlId);
    const priorValue = store.controlValues[controlId];
    const priorAutoExists = Object.hasOwn(store.controlAuto, controlId);
    const priorAuto = store.controlAuto[controlId];
    const generation = (writeGenerations.get(controlId) ?? 0) + 1;
    writeGenerations.set(controlId, generation);
    const definition = store.capabilities.find((entry) => entry.id === controlId);
    const payload =
      'value' in write && definition?.modes?.includes('auto') ? { ...write, auto: false } : write;
    if ('value' in payload) {
      store.setControlValue(controlId, payload.value);
      store.setControlAuto(controlId, false);
    }
    if ('auto' in payload && typeof payload.auto === 'boolean')
      store.setControlAuto(controlId, payload.auto);
    markPending(controlId);
    store.setControlPending(controlId, true);
    store.setControlError(controlId);
    const result = await writeControl(deps.origin, deps.getToken(), radar.id, controlId, payload);
    if (writeGenerations.get(controlId) !== generation || store.selectedId !== radar.id) return;
    store.setControlPending(controlId, false);
    if (result.ok) {
      store.setControlsForbidden(false);
      return;
    }
    if (priorExists && priorValue !== undefined) store.setControlValue(controlId, priorValue);
    else delete store.controlValues[controlId];
    if (priorAutoExists) store.setControlAuto(controlId, priorAuto === true);
    else delete store.controlAuto[controlId];
    if (result.status === 401 || result.status === 403) store.setControlsForbidden(true);
    store.setControlError(controlId, errorMessage(result.status));
  }

  async function setPower(status: RadarStatus): Promise<boolean> {
    const radar = store.selected;
    if (!radar) return false;
    const generation = (writeGenerations.get(POWER_PENDING_KEY) ?? 0) + 1;
    writeGenerations.set(POWER_PENDING_KEY, generation);
    const prior = store.operationalStatus;
    store.setOperationalStatus(status);
    store.setControlPending(POWER_PENDING_KEY, true);
    store.setControlError(POWER_PENDING_KEY);
    markPending(POWER_PENDING_KEY);
    const result = await setPowerRequest(deps.origin, deps.getToken(), radar.id, status);
    if (writeGenerations.get(POWER_PENDING_KEY) !== generation || store.selectedId !== radar.id)
      return false;
    store.setControlPending(POWER_PENDING_KEY, false);
    if (!result.ok) {
      if (prior) store.setOperationalStatus(prior);
      if (result.status === 401 || result.status === 403) store.setControlsForbidden(true);
      store.setControlError(POWER_PENDING_KEY, errorMessage(result.status));
      return false;
    }
    store.setControlsForbidden(false);
    await syncStreamLifecycle();
    return true;
  }

  // Apply standard Signal K control deltas such as radars.navico.controls.gain. The delta value can
  // be a complete control object or a scalar value from providers that flatten the leaf.
  function applyControlDelta(path: string, value: unknown): void {
    const match = /^radars\.([^.]+)\.controls\.([^.]+)$/.exec(path);
    if (!match || match[1] !== store.selectedId) return;
    const entry: RadarControlEntry | undefined =
      typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean'
        ? { value }
        : parseRadarControls({ [match[2]]: value })[match[2]];
    if (entry) store.reconcile({ [match[2]]: entry }, pendingIds());
    void syncStreamLifecycle();
  }

  function onDocumentVisibility(): void {
    documentVisible = !document.hidden;
    void syncStreamLifecycle();
  }

  if (typeof document !== 'undefined')
    document.addEventListener('visibilitychange', onDocumentVisibility);
  startFreshnessWatch();

  async function dispose(): Promise<void> {
    disposed = true;
    discoveryGeneration += 1;
    selectionGeneration += 1;
    streamGeneration += 1;
    setPolling(false);
    clearReopen();
    if (staleTimer) clearInterval(staleTimer);
    staleTimer = undefined;
    if (typeof document !== 'undefined')
      document.removeEventListener('visibilitychange', onDocumentVisibility);
    await worker?.close().catch(() => undefined);
    worker?.dispose();
    worker = undefined;
  }

  return {
    store,
    layer,
    start: refresh,
    refresh,
    dispose,
    selectRadar,
    setControl,
    setPower,
    setPolling,
    applyControlDelta,
  };
}
