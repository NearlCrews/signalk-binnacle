import type { LatLon } from '$shared/geo';
import { fullJitterDelay } from '$shared/signalk';
import { MarineRadarStore } from './marine-radar-store.svelte';
import { createPpiLayer, type PpiLayer } from './ppi-layer';
import {
  type ControlWrite,
  capabilitiesFromControls,
  discoverRadars,
  fetchCapabilities,
  fetchRadarState,
  setPower as setPowerRequest,
  spokesUrl,
  writeControl,
} from './radar-client';
import type { RadarFrame } from './radar-frame-core';
import { POWER_PENDING_KEY, type RadarStatus } from './radar-types';
import { createRadarWorkerClient, type RadarWorkerClient } from './radar-worker-client';

export interface MarineRadarDeps {
  origin: string;
  getToken: () => string | undefined;
  getCenter: () => LatLon | undefined;
  radarAvailable: () => boolean;
}

// The worker flushes integrated frames at this rate (a worker timer, never requestAnimationFrame, so a
// backgrounded tab keeps sweeping). Faster than the eye needs; the spokes integrate continuously between.
const FLUSH_HZ = 15;

// Spoke-stream reconnect backoff: a dropped stream (provider restart, radar power cycle, network blip)
// re-opens on a jittered capped exponential delay (the shared fullJitterDelay, as the Signal K stream
// uses), the attempt counter reset once a live frame arrives.
const REOPEN_BASE_MS = 1000;
const REOPEN_MAX_MS = 30000;

// Poll GET /state on this cadence while a radar is selected, to reconcile control values and the
// operational status (transmit/standby/warming) that change out of band (another station, warmup).
const STATE_POLL_MS = 8000;

// How long after an optimistic control write to treat that control as "in flight", so a state poll
// landing in the gap before the server echoes the new value does not revert the slider.
const PENDING_MS = 3000;

// Orchestrates the marine radar: discovers radars on the Signal K v2 radar API, opens the selected
// radar's spoke worker, polls live state, and feeds frames to the ppi layer. Owns the worker lifecycle
// (a new pattern: no other controller owns a worker), so dispose() must tear it down, mirroring the
// Signal K client's dispose().
export function createMarineRadarController(deps: MarineRadarDeps) {
  const store = new MarineRadarStore();
  const layer: PpiLayer = createPpiLayer(store, deps.getCenter);
  let worker: RadarWorkerClient | undefined;
  let starting = false;
  let disposed = false;
  let reopenTimer: ReturnType<typeof setTimeout> | undefined;
  let reopenAttempt = 0;
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  // The frame most recently handed to the ppi layer. When the next one arrives and replaces it,
  // its buffer goes back to the worker's pool, so steady-state flushing allocates nothing.
  let liveFrame: RadarFrame | undefined;
  // Control ids with an in-flight optimistic write, mapped to the time the write should no longer be
  // considered pending. A state-poll reconcile skips these so it cannot revert a value the user just set.
  const pending = new Map<string, number>();

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
    if (reopenTimer) {
      clearTimeout(reopenTimer);
      reopenTimer = undefined;
    }
  }

  // Re-open the spoke stream after a drop, on a jittered capped backoff. The error-then-close pair a
  // socket fires on a drop both call this, so an already-scheduled timer makes the second a no-op.
  function scheduleReopen(): void {
    if (disposed || reopenTimer || !store.selected || !deps.radarAvailable()) return;
    reopenAttempt += 1;
    reopenTimer = setTimeout(
      () => {
        reopenTimer = undefined;
        void openSelected();
      },
      fullJitterDelay(reopenAttempt, REOPEN_BASE_MS, REOPEN_MAX_MS),
    );
  }

  async function reconcileState(): Promise<void> {
    const radar = store.selected;
    if (!radar) return;
    const snapshot = await fetchRadarState(deps.origin, deps.getToken(), radar.id);
    if (snapshot) store.reconcile(snapshot, pendingIds());
  }

  // Drive the recurring /state poll from panel visibility: its only outputs (operationalStatus and
  // control values) are shown only in the radar panel, so polling every STATE_POLL_MS while the panel is
  // closed would be hundreds of needless GETs an hour. The echo render is fed by the spoke stream, not
  // this poll. An immediate reconcile on activation keeps the panel fresh the moment it opens.
  function setPolling(active: boolean): void {
    if (disposed) return;
    if (!active) {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = undefined;
      }
      return;
    }
    void reconcileState();
    if (!pollTimer) pollTimer = setInterval(() => void reconcileState(), STATE_POLL_MS);
  }

  async function openSelected(): Promise<void> {
    const radar = store.selected;
    if (!radar) return;
    clearReopen();
    // The control definitions ride alongside the picture. When a provider does not serve
    // /capabilities, fall back to the controls the radar reported at discovery so the panel still
    // shows them rather than collapsing to value-only.
    void fetchCapabilities(deps.origin, deps.getToken(), radar.id).then((caps) => {
      store.setCapabilities(caps?.controls ?? capabilitiesFromControls(radar));
    });
    // Reconcile live state once on open so the operational status and control values are current even if
    // the radar is in standby and no spoke ever flows; the recurring poll is gated on panel visibility.
    void reconcileState();
    if (!worker) worker = createRadarWorkerClient();
    store.setStatus('connecting');
    await worker.open(
      spokesUrl(deps.origin, radar, deps.getToken()),
      radar.spokesPerRevolution,
      radar.maxSpokeLen,
      radar.range,
      FLUSH_HZ,
      (frame) => {
        // The ppi layer only ever reads the frame it was last pushed, so once this one replaces
        // the previous, the old buffer is safe to hand back to the worker for reuse.
        const spent = liveFrame;
        liveFrame = frame;
        layer.pushFrame(frame);
        if (spent) worker?.recycle(spent.buffer);
        store.setStatus('live');
        // A live frame means the stream is healthy: reset the reconnect attempt count so a future drop
        // retries quickly rather than at the last (possibly long) backoff delay.
        reopenAttempt = 0;
      },
      (status) => {
        if (status === 'open') {
          store.setStatus('connecting');
        } else {
          store.setStatus('error');
          // 'closed' and 'error' both mean the stream dropped; schedule a backoff re-open.
          scheduleReopen();
        }
      },
    );
  }

  async function start(): Promise<void> {
    // Two reactive effects (connect and reconnect) call start(); the guard makes concurrent calls a
    // no-op. The radar spoke stream is a separate WebSocket independent of the Signal K stream, so once
    // a radar is discovered a Signal K reconnect must not re-probe and re-open it (a needless flap).
    if (starting || store.radars.length > 0 || !deps.radarAvailable()) return;
    starting = true;
    try {
      const { radars, authRequired } = await discoverRadars(deps.origin, deps.getToken());
      if (radars.length === 0) {
        // An access refusal at discovery is surfaced as "needs read-write" rather than "no radar".
        if (authRequired) store.setControlsForbidden(true);
        return;
      }
      store.setDiscovered(radars);
      await openSelected();
    } finally {
      starting = false;
    }
  }

  function selectRadar(id: string): void {
    clearReopen();
    reopenAttempt = 0;
    store.select(id);
    void openSelected();
  }

  // Apply a write outcome: clear the read-only flag on success, otherwise run the caller's revert and
  // raise the read-only flag on a 401/403. Returns whether the write succeeded. Shared by setControl and
  // setPower so the optimistic-rollback and forbidden handling are spelled once.
  function applyWriteOutcome(result: { ok: boolean; status: number }, revert: () => void): boolean {
    if (result.ok) {
      store.setControlsForbidden(false);
      return true;
    }
    revert();
    if (result.status === 401 || result.status === 403) store.setControlsForbidden(true);
    return false;
  }

  // Write a control back to the radar and update the value optimistically. A 401/403 means the session
  // token is read-only, which the panel surfaces; any other failure rolls the optimistic value back to
  // what it was so the slider never lies about the radar's state.
  async function setControl(controlId: string, write: ControlWrite): Promise<void> {
    const priorValue = store.controlValues[controlId];
    const priorAuto = store.controlAuto[controlId];
    // Optimistic update: a manual value also takes the control out of auto; an auto write just flips
    // the auto flag and leaves the last value showing until the radar reports a new one.
    if ('value' in write) {
      store.setControlValue(controlId, write.value);
      store.setControlAuto(controlId, false);
    } else {
      store.setControlAuto(controlId, write.auto);
    }
    markPending(controlId);
    const radar = store.selected;
    if (!radar) return;
    const result = await writeControl(deps.origin, deps.getToken(), radar.id, controlId, write);
    applyWriteOutcome(result, () => {
      // Revert the optimistic change: the radar did not take it. The auto flag always reverts; only a
      // value write also restores the prior value.
      if ('value' in write && priorValue !== undefined)
        store.setControlValue(controlId, priorValue);
      store.setControlAuto(controlId, priorAuto === true);
    });
  }

  // Set the radar's operational state (transmit/standby). Optimistically reflects it in the status pill,
  // reverting on a failed write, and surfaces a read-only refusal like setControl. Returns whether the
  // write succeeded. The RadarControls panel prop is typed void so it does not consume this value;
  // echo-reveal-on-transmit must key off store.operationalStatus reactively in the composition root.
  async function setPower(status: RadarStatus): Promise<boolean> {
    const radar = store.selected;
    if (!radar) return false;
    const prior = store.operationalStatus;
    store.setOperationalStatus(status);
    markPending(POWER_PENDING_KEY);
    const result = await setPowerRequest(deps.origin, deps.getToken(), radar.id, status);
    return applyWriteOutcome(result, () => {
      if (prior) store.setOperationalStatus(prior);
    });
  }

  async function dispose(): Promise<void> {
    setPolling(false);
    disposed = true;
    clearReopen();
    if (!worker) return;
    // Await the clean close (a WebSocket close frame) before terminate(); otherwise terminate kills the
    // Comlink message and the provider sees an abrupt drop.
    await worker.close();
    worker.dispose();
    worker = undefined;
  }

  return { store, layer, start, dispose, selectRadar, setControl, setPower, setPolling };
}
