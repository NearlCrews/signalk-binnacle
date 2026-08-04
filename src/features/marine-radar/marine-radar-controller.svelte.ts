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
  writeStructuredControl,
} from './radar-client';
import {
  controlWriteBlockReason,
  startRadarAreaChartEdit,
  stopRadarAreaChartEdit,
  validateStructuredControl,
} from './radar-controls-model';
import type { RadarFrame } from './radar-frame-core';
import { radarFlushHz } from './radar-limits';
import {
  POWER_PENDING_KEY,
  type RadarAreaDraft,
  type RadarControlEntry,
  type RadarRectValue,
  type RadarSectorValue,
  type RadarStatus,
  type RadarStructuredValue,
  type RadarZoneValue,
} from './radar-types';
import { createRadarWorkerClient, type RadarWorkerClient } from './radar-worker-client';

export interface MarineRadarDeps {
  origin: string;
  getToken: () => string | undefined;
  getCenter: () => LatLon | undefined;
  getHeading?: () => number | undefined;
  centerFresh?: () => boolean;
  headingFresh?: () => boolean;
  radarAvailable: () => boolean;
  chartEditBlockedReason?: () => string | undefined;
}

const REOPEN_BASE_MS = 1000;
const REOPEN_MAX_MS = 30_000;
const CONTROL_POLL_MS = 15_000;
const ECHO_GRACE_MS = 3000;
const STALE_MS = 5000;

interface ControlSnapshot {
  entryExists: boolean;
  entry?: RadarControlEntry;
  valueExists: boolean;
  value?: number | string | boolean;
  autoExists: boolean;
  auto?: boolean;
}

type QueuedPayload =
  | { kind: 'scalar'; value: ControlWrite }
  | { kind: 'structured'; value: RadarStructuredValue };

interface QueuedControlWrite {
  payload: QueuedPayload;
  desired: ControlSnapshot;
  resolve: () => void;
}

interface ControlWriteQueue {
  radarId: string;
  controlId: string;
  selectionEpoch: number;
  accepted: ControlSnapshot;
  active: boolean;
  queued?: QueuedControlWrite;
}

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
  let selectionEpoch = 0;
  let streamGeneration = 0;
  let streamLifecycle = Promise.resolve();
  let streamRadarId: string | undefined;
  const echoGrace = new Map<string, number>();
  const controlWriteQueues = new Map<string, ControlWriteQueue>();
  const writeGenerations = new Map<string, number>();

  function markEchoGrace(id: string): void {
    echoGrace.set(id, Date.now() + ECHO_GRACE_MS);
  }

  function pendingIds(): Set<string> {
    const now = Date.now();
    const live = new Set(
      Object.entries(store.pendingControls)
        .filter(([, active]) => active)
        .map(([id]) => id),
    );
    for (const [id, expiry] of echoGrace) {
      if (expiry > now) live.add(id);
      else echoGrace.delete(id);
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
        void syncStreamLifecycle();
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
    if (!active) {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = undefined;
      return;
    }
    if (disposed) return;
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
        store.setStatus('stale', `No new spokes in ${STALE_MS / 1000} s. Echo cleared.`);
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
        radarFlushHz(radar.spokesPerRevolution, radar.maxSpokeLen),
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
          // The recycle is the worker's flush credit, so it has to happen even if the renderer
          // throws: a swallowed buffer would permanently lower the flush budget and eventually
          // stall the sweep.
          try {
            layer.pushFrame(frame);
          } finally {
            if (spent) worker?.recycle(spent.buffer);
          }
          store.lastSpokeAt = Date.now();
          store.setStatus('live');
          reopenAttempt = 0;
        },
        (status) => {
          if (disposed || generation !== streamGeneration) return;
          if (status === 'open') store.setStatus('waiting');
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
    // Serialize close and open transitions. A slow worker.close must finish before a visibility or
    // control change can reopen the same worker, or its late continuation can close the new socket.
    streamLifecycle = streamLifecycle
      .catch(() => undefined)
      .then(async () => {
        if (shouldStream()) await openSelectedStream();
        else await closeStream(store.selected ? 'paused' : 'idle');
      });
    await streamLifecycle;
  }

  async function loadSelected(): Promise<void> {
    const radar = store.selected;
    const generation = ++selectionGeneration;
    if (!radar) {
      await syncStreamLifecycle();
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
      if (store.selectedId !== undefined) selectionEpoch += 1;
      store.setAvailability('absent');
      store.setDiscovered([]);
      await syncStreamLifecycle();
      return;
    }
    store.setAvailability('probing');
    const result = await discoverRadars(deps.origin, deps.getToken());
    if (disposed || generation !== discoveryGeneration) return;
    const priorSelectedId = store.selectedId;
    store.setAvailability(result.availability, result.detail);
    store.setDiscovered(result.radars);
    if (store.selectedId !== priorSelectedId) selectionEpoch += 1;
    if (result.availability === 'auth-required') store.setControlsForbidden(true);
    await loadSelected();
  }

  function selectRadar(id: string): void {
    if (id === store.selectedId) return;
    selectionEpoch += 1;
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

  function snapshotControl(controlId: string): ControlSnapshot {
    const entry = store.controlEntries[controlId];
    return {
      entryExists: Object.hasOwn(store.controlEntries, controlId),
      entry: entry ? { ...entry } : undefined,
      valueExists: Object.hasOwn(store.controlValues, controlId),
      value: store.controlValues[controlId],
      autoExists: Object.hasOwn(store.controlAuto, controlId),
      auto: store.controlAuto[controlId],
    };
  }

  function restoreControl(controlId: string, snapshot: ControlSnapshot): void {
    if (snapshot.entryExists && snapshot.entry) store.setControlEntry(controlId, snapshot.entry);
    else store.deleteControlEntry(controlId);
    if (snapshot.valueExists && snapshot.value !== undefined)
      store.setControlValue(controlId, snapshot.value);
    else delete store.controlValues[controlId];
    if (snapshot.autoExists) store.setControlAuto(controlId, snapshot.auto === true);
    else delete store.controlAuto[controlId];
  }

  function applyScalarControl(controlId: string, write: ControlWrite): void {
    const definition = store.capabilities.find((entry) => entry.id === controlId);
    const entry = { ...(store.controlEntries[controlId] ?? {}) };
    if ('value' in write) {
      entry.value = write.value;
      if (definition?.modes?.includes('auto')) entry.auto = false;
    }
    if ('auto' in write && typeof write.auto === 'boolean') entry.auto = write.auto;
    store.setControlEntry(controlId, entry);
  }

  function applyStructuredControl(controlId: string, value: RadarStructuredValue): void {
    store.setControlEntry(controlId, {
      ...(store.controlEntries[controlId] ?? {}),
      ...value,
    });
  }

  function queueKey(radarId: string, controlId: string): string {
    return `${radarId}\u0000${controlId}`;
  }

  async function drainControlWrites(key: string, queue: ControlWriteQueue): Promise<void> {
    queue.active = true;
    while (queue.queued) {
      if (
        disposed ||
        queue.selectionEpoch !== selectionEpoch ||
        store.selectedId !== queue.radarId
      ) {
        queue.queued.resolve();
        queue.queued = undefined;
        break;
      }
      const current = queue.queued;
      queue.queued = undefined;
      const result =
        current.payload.kind === 'structured'
          ? await writeStructuredControl(
              deps.origin,
              deps.getToken(),
              queue.radarId,
              queue.controlId,
              current.payload.value,
            )
          : await writeControl(
              deps.origin,
              deps.getToken(),
              queue.radarId,
              queue.controlId,
              current.payload.value,
            );
      const stillSelected =
        !disposed && queue.selectionEpoch === selectionEpoch && store.selectedId === queue.radarId;
      if (stillSelected && result.ok) {
        queue.accepted = current.desired;
        store.setControlsForbidden(false);
      } else if (stillSelected && (result.status === 401 || result.status === 403)) {
        const superseded = queue.queued as QueuedControlWrite | undefined;
        superseded?.resolve();
        queue.queued = undefined;
        restoreControl(queue.controlId, queue.accepted);
        store.setControlsForbidden(true);
        store.setControlError(queue.controlId, errorMessage(result.status));
      } else if (stillSelected && !result.ok && !queue.queued) {
        restoreControl(queue.controlId, queue.accepted);
        store.setControlError(queue.controlId, errorMessage(result.status));
      }
      current.resolve();
    }
    queue.active = false;
    if (controlWriteQueues.get(key) === queue) controlWriteQueues.delete(key);
    if (
      !disposed &&
      queue.selectionEpoch === selectionEpoch &&
      store.selectedId === queue.radarId
    ) {
      store.setControlPending(queue.controlId, false);
      markEchoGrace(queue.controlId);
    }
  }

  function enqueueControlWrite(
    radarId: string,
    controlId: string,
    acceptedBeforeOptimistic: ControlSnapshot,
    payload: QueuedPayload,
  ): Promise<void> {
    const key = queueKey(radarId, controlId);
    let queue = controlWriteQueues.get(key);
    if (!queue || queue.selectionEpoch !== selectionEpoch) {
      queue = {
        radarId,
        controlId,
        selectionEpoch,
        accepted: acceptedBeforeOptimistic,
        active: false,
      };
      controlWriteQueues.set(key, queue);
    }
    const promise = new Promise<void>((resolve) => {
      queue?.queued?.resolve();
      if (!queue) {
        resolve();
        return;
      }
      queue.queued = { payload, desired: snapshotControl(controlId), resolve };
    });
    store.setControlPending(controlId, true);
    store.setControlError(controlId);
    if (!queue.active) void drainControlWrites(key, queue);
    return promise;
  }

  function controlDefinition(controlId: string) {
    return store.capabilities.find((entry) => entry.id === controlId);
  }

  async function setControl(controlId: string, write: ControlWrite): Promise<void> {
    const radar = store.selected;
    if (!radar) return;
    const definition = controlDefinition(controlId);
    const blocked = controlWriteBlockReason(
      definition,
      store.controlEntries[controlId],
      store.controlsForbidden,
    );
    if (blocked) {
      store.setControlError(controlId, blocked);
      return;
    }
    const payload =
      'value' in write && definition?.modes?.includes('auto') ? { ...write, auto: false } : write;
    const accepted = snapshotControl(controlId);
    applyScalarControl(controlId, payload);
    await enqueueControlWrite(radar.id, controlId, accepted, { kind: 'scalar', value: payload });
  }

  async function setStructuredControl(
    controlId: string,
    value: RadarStructuredValue,
  ): Promise<void> {
    const radar = store.selected;
    if (!radar) return;
    const definition = controlDefinition(controlId);
    const blocked = controlWriteBlockReason(
      definition,
      store.controlEntries[controlId],
      store.controlsForbidden,
    );
    const validation = validateStructuredControl(definition, value);
    if (blocked || validation) {
      store.setControlError(controlId, blocked ?? validation);
      return;
    }
    const accepted = snapshotControl(controlId);
    applyStructuredControl(controlId, value);
    await enqueueControlWrite(radar.id, controlId, accepted, { kind: 'structured', value });
  }

  async function setZoneControl(controlId: string, value: RadarZoneValue): Promise<void> {
    await setStructuredControl(controlId, value);
  }

  async function setSectorControl(controlId: string, value: RadarSectorValue): Promise<void> {
    await setStructuredControl(controlId, value);
  }

  async function setRectControl(controlId: string, value: RadarRectValue): Promise<void> {
    await setStructuredControl(controlId, value);
  }

  function setAreaDraft(draft: RadarAreaDraft | undefined): void {
    if (draft && (draft.radarId !== store.selectedId || draft.controlId.length === 0)) return;
    store.setAreaDraft(draft);
  }

  function startAreaChartEdit(controlId: string): string | undefined {
    return startRadarAreaChartEdit(store, deps, controlId);
  }

  function stopAreaChartEdit(): void {
    stopRadarAreaChartEdit(store);
  }

  async function setPower(status: RadarStatus): Promise<boolean> {
    const radar = store.selected;
    if (!radar) return false;
    const generation = (writeGenerations.get(POWER_PENDING_KEY) ?? 0) + 1;
    writeGenerations.set(POWER_PENDING_KEY, generation);
    const selectionEpochAtStart = selectionEpoch;
    const prior = store.operationalStatus;
    store.setOperationalStatus(status);
    store.setControlPending(POWER_PENDING_KEY, true);
    store.setControlError(POWER_PENDING_KEY);
    const result = await setPowerRequest(deps.origin, deps.getToken(), radar.id, status);
    if (
      writeGenerations.get(POWER_PENDING_KEY) !== generation ||
      selectionEpochAtStart !== selectionEpoch ||
      store.selectedId !== radar.id
    )
      return false;
    store.setControlPending(POWER_PENDING_KEY, false);
    markEchoGrace(POWER_PENDING_KEY);
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
    const selectedId = store.selectedId;
    if (!selectedId) return;
    const prefix = `radars.${selectedId}.controls.`;
    if (!path.startsWith(prefix)) return;
    const controlId = path.slice(prefix.length);
    if (!controlId) return;
    const controlValue =
      typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean'
        ? { value }
        : value;
    const entry: RadarControlEntry | undefined = parseRadarControls({ [controlId]: controlValue })[
      controlId
    ];
    if (entry) store.reconcile({ [controlId]: entry }, pendingIds());
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
    await syncStreamLifecycle();
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
    setStructuredControl,
    setZoneControl,
    setSectorControl,
    setRectControl,
    setAreaDraft,
    startAreaChartEdit,
    stopAreaChartEdit,
    setPower,
    setPolling,
    applyControlDelta,
  };
}
