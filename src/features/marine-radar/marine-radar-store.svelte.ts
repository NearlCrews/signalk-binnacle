import {
  type ControlDefinition,
  POWER_PENDING_KEY,
  type RadarAreaDraft,
  type RadarAvailability,
  type RadarControlEntry,
  type RadarInfo,
  type RadarStatus,
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

  selected = $derived(this.radars.find((r) => r.id === this.selectedId));
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
        return 'The Signal K radar provider could not be reached.';
      case 'invalid':
        return 'The radar provider returned invalid radar geometry or metadata.';
      default:
        return 'No radar detected. Configure a Signal K Radar API provider, such as Mayara.';
    }
  });

  setDiscovered(radars: RadarInfo[]): void {
    this.radars = radars;
    // A fresh discovery clears a stale read-only warning: if access was granted and the link
    // reconnected, the next control write should be allowed to prove itself rather than the banner
    // lingering from the previous session.
    this.controlsForbidden = false;
    const retained = radars.find((radar) => radar.id === this.selectedId);
    if (retained) {
      this.operationalStatus = retained.status;
    } else {
      const first = radars[0];
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
    }
  }

  setAvailability(availability: RadarAvailability): void {
    this.availability = availability;
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
    }
  }

  setOperationalStatus(status: RadarStatus): void {
    this.operationalStatus = status;
  }

  // Reconcile live control values from the standard controls endpoint or Signal K stream. Skip pending
  // ids so a server echo cannot clobber an optimistic write that has not completed.
  reconcile(
    controls: Record<string, RadarControlEntry | undefined>,
    pending: ReadonlySet<string>,
  ): void {
    // POWER_PENDING_KEY guards the operational status the same way a control id guards its value: a
    // poll landing right after an optimistic transmit/standby must not flip the pill back to stale.
    for (const [id, entry] of Object.entries(controls)) {
      if (!entry || pending.has(id)) continue;
      this.controlEntries[id] = entry;
      this.areaVersion += 1;
      if (entry.value !== undefined) this.controlValues[id] = entry.value;
      if (entry.auto !== undefined) this.controlAuto[id] = entry.auto;
      if (id === POWER_PENDING_KEY && !pending.has(POWER_PENDING_KEY)) {
        const status = statusFromPower(entry.value);
        if (status) this.operationalStatus = status;
      }
    }
  }

  setCapabilities(controls: ControlDefinition[]): void {
    this.capabilities = controls;
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
