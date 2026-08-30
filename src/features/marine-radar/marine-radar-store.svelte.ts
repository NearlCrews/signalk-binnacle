import type { CollisionContact } from '$entities/collision';
import { normalizeControlDefinitions, normalizeRadarIdentities } from './radar-client';
import { toCollisionContacts } from './radar-targets';
import {
  type ControlDefinition,
  POWER_CONTROL_IDS,
  POWER_PENDING_KEY,
  type RadarAreaDraft,
  type RadarAvailability,
  type RadarControlEntry,
  type RadarInfo,
  type RadarStatus,
  type RadarTarget,
} from './radar-types';

// The stream connection state, distinct from the radar's own operational status (off/standby/transmit).
export type RadarConnectionStatus =
  | 'idle'
  | 'paused'
  | 'connecting'
  | 'waiting'
  | 'live'
  | 'stale'
  | 'error';
export type RadarRendererStatus = 'idle' | 'ready' | 'blocked' | 'context-lost' | 'error';

// Identity-stable so the everyday no-radar read never dirties the collision assessment's derived.
const NO_COLLISION_CONTACTS: CollisionContact[] = [];

// Seed the displayed control values from a radar's reported controls so the panel shows real values
// immediately, before any capability fetch or stream delta.
function controlValuesOf(radar: RadarInfo): Record<string, number | string | boolean> {
  const out: Record<string, number | string | boolean> = {};
  for (const [id, entry] of Object.entries(radar.controls)) {
    if (entry?.value !== undefined) out[id] = entry.value;
  }
  return out;
}

// Seed which controls are in auto from the radar's reported control state, so an auto-capable control
// shows its Auto toggle lit immediately, before any user change.
function controlAutoOf(radar: RadarInfo): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const [id, entry] of Object.entries(radar.controls)) {
    if (entry?.auto !== undefined) out[id] = entry.auto;
  }
  return out;
}

// The marine radar state: the discovered radars, the selected radar, its control definitions and live
// values, the connection status, and whether a control write was refused for lack of write access. The
// controller orchestrates; this only holds state.
export class MarineRadarStore {
  radars = $state<RadarInfo[]>([]);
  selectedId = $state<string | undefined>(undefined);
  availability = $state<RadarAvailability>('idle');
  status = $state<RadarConnectionStatus>('idle');
  statusDetail = $state<string | undefined>(undefined);
  // Separate from statusDetail because a failed discovery is followed by the stream settling to
  // idle, and that setStatus would clear a shared detail before the panel could render it.
  discoveryDetail = $state<string | undefined>(undefined);
  rendererStatus = $state<RadarRendererStatus>('idle');
  rendererDetail = $state<string | undefined>(undefined);
  lastSpokeAt = $state<number | undefined>(undefined);
  // The radar's own operational state (off/standby/transmit/warming), distinct from the stream
  // connection status above. Seeded from discovery and reconciled from the standard controls endpoint
  // whether the radar is transmitting and the TX/Standby control reflects the real state.
  operationalStatus = $state<RadarStatus | undefined>(undefined);
  capabilities = $state<ControlDefinition[]>([]);
  controlValues = $state<Record<string, number | string | boolean>>({});
  // Which controls are currently in auto mode, keyed by control id, for the controls that report an
  // auto/manual capability. A direct property write stays reactive without reallocating the object.
  controlAuto = $state<Record<string, boolean>>({});
  controlEntries = $state<Record<string, RadarControlEntry | undefined>>({});
  // True once a control write was refused for lack of write access: the controls need a read-write token.
  controlsForbidden = $state(false);
  pendingControls = $state<Record<string, boolean>>({});
  controlErrors = $state<Record<string, string>>({});
  // One structured geometry draft can own the chart at a time. The form remains the accessible
  // editor, while the chart can update the same SI snapshot through deliberate point placement.
  areaDraft = $state<RadarAreaDraft | undefined>(undefined);
  areaVersion = $state(0);
  // Tracked ARPA targets from the controller's targets poll, kept with the radar id they belong to
  // so a selection change can never relabel another radar's contacts during the handover. Cleared
  // whenever the poll stops, so a stale contact can never keep grading in the collision assessment.
  arpaTargets = $state<{ radarId: string; targets: RadarTarget[] } | undefined>(undefined);

  selected = $derived(this.radars.find((r) => r.id === this.selectedId));
  // The ARPA targets in the collision entity's contact shape, for the composition root to inject
  // into the collision assessment as its secondary source.
  collisionContacts = $derived.by<CollisionContact[]>(() => {
    const arpa = this.arpaTargets;
    return arpa ? toCollisionContacts(arpa.radarId, arpa.targets) : NO_COLLISION_CONTACTS;
  });
  // A radar is detected once discovery returns at least one. Shared by the layer row's availability
  // gate and the menu tile so the two cannot drift on what "has a radar" means.
  hasRadar = $derived(this.radars.length > 0);
  unavailableHint = $derived.by(() => {
    switch (this.availability) {
      case 'probing':
        return 'Checking the Signal K server for a radar.';
      case 'auth-required':
        return 'Radar access is restricted. Approve Binnacle in Signal K, then reconnect.';
      case 'unreachable':
        return 'The radar on the Signal K server could not be reached. Check the Signal K connection, then reopen Radar.';
      case 'invalid':
        return 'The radar plugin sent data Binnacle could not read. Update or reconfigure the radar plugin on the server.';
      default:
        return 'No radar found on the Signal K server. Connecting one needs a radar plugin, such as Mayara, installed and running there.';
    }
  });

  // The store takes ownership of the RadarInfo objects: reconcile writes live control state back
  // onto them, so a caller must hand over freshly built objects, never shared fixtures.
  setDiscovered(radars: RadarInfo[]): void {
    const normalized = normalizeRadarIdentities(radars);
    this.radars = normalized;
    // A fresh discovery clears a stale read-only warning: if access was granted and the link
    // reconnected, the next control write should be allowed to prove itself rather than the banner
    // lingering from the previous session.
    this.controlsForbidden = false;
    const retained = normalized.find((radar) => radar.id === this.selectedId);
    if (retained) {
      this.operationalStatus = retained.status;
    } else {
      const first = normalized[0];
      this.selectedId = first?.id;
      // A new selection starts with that radar's own controls, never another radar's gain, sea, or rain.
      this.capabilities = [];
      this.controlValues = first ? controlValuesOf(first) : {};
      this.controlAuto = first ? controlAutoOf(first) : {};
      this.controlEntries = first ? { ...first.controls } : {};
      this.pendingControls = {};
      this.controlErrors = {};
      this.operationalStatus = first?.status;
      this.areaDraft = undefined;
      this.areaVersion += 1;
      this.arpaTargets = undefined;
    }
  }

  setAvailability(availability: RadarAvailability, detail?: string): void {
    this.availability = availability;
    this.discoveryDetail = detail;
  }

  select(id: string): void {
    const radar = this.radars.find((r) => r.id === id);
    if (radar && id !== this.selectedId) {
      this.selectedId = id;
      this.capabilities = [];
      this.controlValues = controlValuesOf(radar);
      this.controlAuto = controlAutoOf(radar);
      this.controlEntries = { ...radar.controls };
      this.pendingControls = {};
      this.controlErrors = {};
      this.operationalStatus = radar.status;
      this.areaDraft = undefined;
      this.areaVersion += 1;
      this.arpaTargets = undefined;
    }
  }

  setOperationalStatus(status: RadarStatus): void {
    this.operationalStatus = status;
  }

  setArpaTargets(radarId: string, targets: RadarTarget[]): void {
    this.arpaTargets = { radarId, targets };
  }

  clearArpaTargets(): void {
    if (this.arpaTargets) this.arpaTargets = undefined;
  }

  // Reconcile live control values from the standard controls endpoint or Signal K stream. Skip pending
  // ids so a server echo cannot clobber an optimistic write that has not completed.
  // Returns whether the operational status changed, so callers can resync the stream lifecycle
  // exactly when gating moved rather than snapshotting the status around every call.
  reconcile(
    controls: Record<string, RadarControlEntry | undefined>,
    pending: ReadonlySet<string>,
  ): boolean {
    // While the dedicated power write is pending, every power-spelled id is skipped, which is what
    // keeps a poll landing right after an optimistic transmit or standby from flipping the pill back
    // to the stale value regardless of whether the provider spells it power or status.
    const powerPending = pending.has(POWER_PENDING_KEY);
    const statusBefore = this.operationalStatus;
    const applied: Record<string, RadarControlEntry> = Object.create(null);
    for (const [id, entry] of Object.entries(controls)) {
      if (!entry || pending.has(id) || (powerPending && POWER_CONTROL_IDS.has(id))) continue;
      applied[id] = entry;
      this.controlEntries[id] = entry;
      this.areaVersion += 1;
      if (entry.value !== undefined) this.controlValues[id] = entry.value;
      if (entry.auto !== undefined) this.controlAuto[id] = entry.auto;
      if (POWER_CONTROL_IDS.has(id)) {
        const status = statusFromPower(entry.value);
        if (status) this.operationalStatus = status;
      }
    }
    // The selected radar's discovery entry follows every applied reconcile, poll and delta
    // alike, so a switch away and back seeds the live state rather than the discovery-time
    // snapshot. Entries the pending guards skipped stay out, keeping echo suppression intact.
    if (this.selectedId !== undefined) this.reconcileRadarControls(this.selectedId, applied);
    return this.operationalStatus !== statusBefore;
  }

  // Reconcile a delta for a radar that is not selected: keep its reported controls and status
  // current so a later select() seeds the live state rather than the discovery-time snapshot. The
  // caller passes complete entries (scalars already merged), so assignment replaces the entry.
  reconcileRadarControls(
    radarId: string,
    controls: Record<string, RadarControlEntry | undefined>,
  ): void {
    const radar = this.radars.find((r) => r.id === radarId);
    if (!radar) return;
    // radar.controls is a null-prototype map, which the $state proxy leaves unproxied, so a
    // per-key write would be invisible to reactive readers; merging into a fresh map and
    // reassigning through the proxied radar object is what signals the change.
    const merged: Record<string, RadarControlEntry> = Object.assign(
      Object.create(null),
      radar.controls,
    );
    let changed = false;
    for (const [id, entry] of Object.entries(controls)) {
      if (!entry) continue;
      merged[id] = entry;
      changed = true;
      if (POWER_CONTROL_IDS.has(id)) {
        const status = statusFromPower(entry.value);
        if (status) radar.status = status;
      }
    }
    if (changed) radar.controls = merged;
  }

  setCapabilities(controls: ControlDefinition[]): void {
    this.capabilities = normalizeControlDefinitions(controls);
    this.areaVersion += 1;
  }

  setStatus(status: RadarConnectionStatus, detail?: string): void {
    this.status = status;
    this.statusDetail = detail;
  }

  setControlValue(id: string, value: number | string | boolean): void {
    // controlValues is a $state object, so a direct property write is reactive and avoids allocating a
    // fresh object on every slider move.
    this.controlValues[id] = value;
  }

  setControlAuto(id: string, auto: boolean): void {
    this.controlAuto[id] = auto;
  }

  setControlEntry(id: string, entry: RadarControlEntry): void {
    this.controlEntries[id] = { ...entry };
    if (entry.value !== undefined) this.controlValues[id] = entry.value;
    else delete this.controlValues[id];
    if (entry.auto !== undefined) this.controlAuto[id] = entry.auto;
    else delete this.controlAuto[id];
    this.areaVersion += 1;
  }

  deleteControlEntry(id: string): void {
    delete this.controlEntries[id];
    delete this.controlValues[id];
    delete this.controlAuto[id];
    this.areaVersion += 1;
  }

  setControlsForbidden(forbidden: boolean): void {
    this.controlsForbidden = forbidden;
  }

  setRendererStatus(status: RadarRendererStatus, detail?: string): void {
    this.rendererStatus = status;
    this.rendererDetail = detail;
  }

  // Withdraw an input-blocked report, and only that: 'error' and 'context-lost' describe the GL
  // context rather than the inputs, so the precedence lives here once instead of at every
  // teardown path that could otherwise forget it and strand a stale blocked message.
  clearBlockedStatus(): void {
    if (this.rendererStatus === 'blocked') this.setRendererStatus('ready');
  }

  setControlPending(id: string, value: boolean): void {
    if (value) this.pendingControls[id] = true;
    else delete this.pendingControls[id];
  }

  setControlError(id: string, message?: string): void {
    if (message) this.controlErrors[id] = message;
    else delete this.controlErrors[id];
  }

  setAreaDraft(draft: RadarAreaDraft | undefined): void {
    this.areaDraft = draft;
    this.areaVersion += 1;
  }
}

function statusFromPower(value: unknown): RadarStatus | undefined {
  if (value === 'off' || value === 'standby' || value === 'transmit' || value === 'warming')
    return value;
  if (typeof value !== 'number') return undefined;
  return (['off', 'standby', 'transmit', 'warming'] as const)[value];
}
