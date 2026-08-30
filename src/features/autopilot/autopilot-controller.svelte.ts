import { capitalize, createBusyGate, isFiniteNumber } from '$shared/lib';
import {
  createWriteBlockGuard,
  createWriteOutcomeGate,
  type PathCell,
  predatesReconnect,
  type SignalKStore,
} from '$shared/signalk';
import {
  type AutopilotAvailability,
  type AutopilotDevice,
  type AutopilotInfo,
  adjustAutopilotTarget,
  discoverAutopilots,
  disengageAutopilot,
  engageAutopilot,
  fetchAutopilotInfo,
  gybeAutopilot,
  setAutopilotMode,
  type TackDirection,
  tackAutopilot,
} from './autopilot-client';

// The v2 Autopilot API's delta paths: the server relays a provider's apUpdate values as
// steering.autopilot.* (options excepted, which never stream), with the DEVICE id as the update's
// $source, and emits defaultPilot itself under the 'autopilotApi' source. The app subscribes to
// the family through SK_PATHS.autopilotAll; these are the leaves the controller reads.
const STATE_PATH = 'steering.autopilot.state';
const MODE_PATH = 'steering.autopilot.mode';
const TARGET_PATH = 'steering.autopilot.target';
const ENGAGED_PATH = 'steering.autopilot.engaged';
const ACTIONS_PATH = 'steering.autopilot.availableActions';
const DEFAULT_PILOT_PATH = 'steering.autopilot.defaultPilot';

const MAX_STREAMED_TEXT_LENGTH = 256;
const MAX_STREAMED_ACTIONS = 32;
// The panel's largest nudge is ten degrees; anything past this bound is a caller bug, not a helm
// order, and must not reach the pilot.
const MAX_ADJUST_RADIANS = Math.PI / 4;
const MAX_TARGET_RADIANS = 2 * Math.PI;

export type AutopilotPanelAvailability = 'unknown' | AutopilotAvailability;

// Provider mode and state names arrive as lowercase wire strings; a short one is an acronym (gps)
// and reads as such, anything longer is a word. The chip and the panel share this one rendering.
export function autopilotModeLabel(name: string): string {
  return name.length <= 3 ? name.toUpperCase() : capitalize(name);
}
export type AutopilotPendingCommand = 'engage' | 'disengage' | 'mode' | 'tack' | 'gybe';

// What the chip renders. hidden is the no-autopilot degrade (the panel keeps the discoverable
// landing); lost is the degraded treatment for a provider that vanished or stopped answering
// after the session had one.
export type AutopilotChipState =
  | { kind: 'hidden' }
  | { kind: 'lost' }
  | { kind: 'standby' }
  | { kind: 'engaged'; mode: string | null; targetRad: number | null; windMode: boolean };

export interface AutopilotDeps {
  origin: string;
  getToken: () => string | undefined;
  // The features roster's verdict on the v2 Autopilot API: undefined while unresolved. Every 2.x
  // server advertises the API whether or not a provider is registered, so this can only rule the
  // API out (a v1 server); discovery is the provider probe.
  apiAdvertised: () => boolean | undefined;
  writeBlocked: () => boolean;
  requestWriteAccess: () => Promise<void>;
  store: SignalKStore;
}

interface Snapshot {
  deviceId: string;
  info: AutopilotInfo;
  // Wall-clock acceptance moment: a streamed cell overlays the snapshot only when it arrived
  // later, so REST hydration stays the truth for everything it answered.
  at: number;
}

export function createAutopilotController(deps: AutopilotDeps) {
  const { origin, store } = deps;
  let disposed = false;
  let discoveryGeneration = 0;
  let infoGeneration = 0;

  // Pre-created at construction so the first reactive read finds a tracked cell (the store's
  // lazy-create trap).
  const stateCell = store.cell(STATE_PATH);
  const modeCell = store.cell(MODE_PATH);
  const targetCell = store.cell(TARGET_PATH);
  const engagedCell = store.cell(ENGAGED_PATH);
  const actionsCell = store.cell(ACTIONS_PATH);
  const defaultPilotCell = store.cell(DEFAULT_PILOT_PATH);

  let availability = $state<AutopilotPanelAvailability>('unknown');
  let everAvailable = $state(false);
  let devices = $state<AutopilotDevice[]>([]);
  let userSelectedId = $state<string | undefined>();
  let snapshot = $state<Snapshot | undefined>();
  let hydrating = $state(false);
  let commandError = $state<string | null>(null);
  let pendingCommand = $state<AutopilotPendingCommand | undefined>();
  let busy = $state(false);
  let adjustBusy = $state(false);
  let queuedAdjustRadians = 0;

  const withBusy = createBusyGate(
    () => busy,
    (next) => {
      busy = next;
    },
  );

  const accepted = createWriteOutcomeGate({
    report: (message) => {
      commandError = message;
    },
    requestWriteAccess: () => deps.requestWriteAccess(),
  });

  const blockedWrite = createWriteBlockGuard(deps.writeBlocked, (message) => {
    commandError = message;
  });

  // The streamed default device, only when it names a discovered device: the API emits
  // defaultPilot under its own 'autopilotApi' source, so no per-device source check applies.
  const streamedDefaultId = $derived.by(() => {
    const value = defaultPilotCell.value;
    if (typeof value !== 'string') return undefined;
    return devices.some((device) => device.id === value) ? value : undefined;
  });

  const selectedId = $derived.by(() => {
    if (userSelectedId !== undefined && devices.some((device) => device.id === userSelectedId)) {
      return userSelectedId;
    }
    return streamedDefaultId ?? devices.find((device) => device.isDefault)?.id ?? devices[0]?.id;
  });

  const snapshotForSelected = $derived(
    snapshot !== undefined && snapshot.deviceId === selectedId ? snapshot : undefined,
  );

  // Whether a streamed cell speaks for the selected device. A single-pilot boat accepts any
  // source (providers vary in what $source they stamp); with several pilots on the bus only a
  // sample stamped with the selected device id may overlay it.
  function sourceMatchesSelected(cell: PathCell): boolean {
    if (devices.length <= 1) return true;
    const id = selectedId;
    return id !== undefined && (cell.source?.ref === id || cell.source?.label === id);
  }

  // A cell overlays the snapshot only when it streamed on the current connection, later than the
  // snapshot's acceptance, from the selected device. Returns the raw value; undefined means the
  // stream has nothing fresher to say.
  function overlay(cell: PathCell): unknown {
    if (!cell.streamed || cell.epoch === 0) return undefined;
    if (predatesReconnect(cell, store.generation)) return undefined;
    if (cell.epoch <= (snapshotForSelected?.at ?? 0)) return undefined;
    if (!sourceMatchesSelected(cell)) return undefined;
    return cell.value;
  }

  function overlayText(cell: PathCell): string | null | undefined {
    const value = overlay(cell);
    if (value === null) return null;
    return typeof value === 'string' && value.length > 0 && value.length <= MAX_STREAMED_TEXT_LENGTH
      ? value
      : undefined;
  }

  function overlayTarget(cell: PathCell): number | null | undefined {
    const value = overlay(cell);
    if (value === null) return null;
    return isFiniteNumber(value) && Math.abs(value) <= MAX_TARGET_RADIANS ? value : undefined;
  }

  const pilotState = $derived(overlayText(stateCell) ?? snapshotForSelected?.info.state ?? null);
  const mode = $derived(overlayText(modeCell) ?? snapshotForSelected?.info.mode ?? null);
  const target = $derived(overlayTarget(targetCell) ?? snapshotForSelected?.info.target ?? null);
  const options = $derived(snapshotForSelected?.info.options);

  const engaged = $derived.by(() => {
    const streamed = overlay(engagedCell);
    if (typeof streamed === 'boolean') return streamed;
    // A state that STREAMED fresher than the snapshot maps through the provider's declared
    // states. A snapshot state must not: the optimistic engage patch flips only the engaged
    // flag, and mapping the untouched snapshot state would immediately shadow it.
    const streamedState = overlayText(stateCell);
    if (typeof streamedState === 'string') {
      const stateOption = options?.states.find((option) => option.name === streamedState);
      if (stateOption !== undefined) return stateOption.engaged;
    }
    return snapshotForSelected?.info.engaged ?? false;
  });

  const availableActionIds = $derived.by(() => {
    const streamed = overlay(actionsCell);
    if (Array.isArray(streamed) && streamed.length <= MAX_STREAMED_ACTIONS) {
      const ids = streamed.filter(
        (id): id is string =>
          typeof id === 'string' && id.length > 0 && id.length <= MAX_STREAMED_TEXT_LENGTH,
      );
      return new Set(ids);
    }
    return new Set(
      (options?.actions ?? []).filter((action) => action.available).map((action) => action.id),
    );
  });

  const chip = $derived.by<AutopilotChipState>(() => {
    if (availability === 'available') {
      if (!engaged) return { kind: 'standby' };
      return {
        kind: 'engaged',
        mode,
        targetRad: target,
        windMode: mode?.includes('wind') ?? false,
      };
    }
    return everAvailable ? { kind: 'lost' } : { kind: 'hidden' };
  });

  async function hydrateInfo(deviceId: string, silent = false): Promise<void> {
    const generation = ++infoGeneration;
    if (!silent) hydrating = true;
    try {
      const info = await fetchAutopilotInfo(origin, deps.getToken(), deviceId);
      if (disposed || generation !== infoGeneration) return;
      // A failed read keeps the prior snapshot: the stream still reconciles, and the next open
      // edge re-hydrates.
      if (info) snapshot = { deviceId, info, at: Date.now() };
    } finally {
      if (generation === infoGeneration) hydrating = false;
    }
  }

  // Discovery plus a fresh device snapshot. The integrator calls this once features resolve and
  // on every stream-open edge, which also covers a provider plugin being installed (the server
  // restart bounces the socket).
  async function rehydrate(): Promise<void> {
    if (disposed) return;
    const generation = ++discoveryGeneration;
    const discovery = await discoverAutopilots(origin, deps.getToken());
    if (disposed || generation !== discoveryGeneration) return;
    if (discovery.availability === 'unreachable' && availability === 'available') {
      // A transient transport failure must not erase a working pilot's devices and snapshot; the
      // chip degrades to lost and the next rehydrate or retry restores it.
      availability = 'unreachable';
      return;
    }
    availability = discovery.availability;
    devices = discovery.devices;
    if (discovery.availability !== 'available') {
      // No provider answers for the old snapshot any more; a frozen picture must not survive.
      snapshot = undefined;
      return;
    }
    everAvailable = true;
    if (userSelectedId !== undefined && !devices.some((device) => device.id === userSelectedId)) {
      userSelectedId = undefined;
    }
    const id = selectedId;
    if (id !== undefined) await hydrateInfo(id);
  }

  function selectDevice(id: string): void {
    if (!devices.some((device) => device.id === id)) return;
    userSelectedId = id;
    void hydrateInfo(id);
  }

  // Optimistic patch on an accepted command: acceptance is a server acknowledgment, so it stands
  // as a snapshot moment and only later stream values override it. The follow-up silent hydrate
  // reconciles against REST truth.
  function applyAccepted(deviceId: string, patch: Partial<AutopilotInfo>): void {
    if (snapshot !== undefined && snapshot.deviceId === deviceId) {
      snapshot = { deviceId, info: { ...snapshot.info, ...patch }, at: Date.now() };
    }
    void hydrateInfo(deviceId, true);
  }

  function commandDevice(): string | undefined {
    commandError = null;
    if (availability !== 'available') return undefined;
    return selectedId;
  }

  function makeCommand(
    name: AutopilotPendingCommand,
    blockedMessage: string,
    run: (deviceId: string) => Promise<boolean>,
  ): () => Promise<void> {
    return withBusy(async () => {
      const deviceId = commandDevice();
      if (deviceId === undefined || blockedWrite(blockedMessage)) return;
      pendingCommand = name;
      try {
        await run(deviceId);
      } finally {
        pendingCommand = undefined;
      }
    });
  }

  const engage = makeCommand(
    'engage',
    'Read-only access: the autopilot was not engaged. Request read and write access to command it.',
    async (deviceId) => {
      const outcome = await engageAutopilot(origin, deps.getToken(), deviceId);
      if (
        !accepted(
          outcome,
          'Signal K refused the engage command. Read and write access is being requested.',
          'Could not reach the autopilot to engage it. Check the connection.',
        )
      ) {
        return false;
      }
      applyAccepted(deviceId, { engaged: true });
      return true;
    },
  );

  const disengage = makeCommand(
    'disengage',
    'Read-only access: the autopilot was not released. Request read and write access to command it.',
    async (deviceId) => {
      const outcome = await disengageAutopilot(origin, deps.getToken(), deviceId);
      if (
        !accepted(
          outcome,
          'Signal K refused the disengage command. Read and write access is being requested.',
          'Could not reach the autopilot to disengage it. Check the connection and take the helm.',
        )
      ) {
        return false;
      }
      applyAccepted(deviceId, { engaged: false });
      return true;
    },
  );

  function setMode(next: string): Promise<void> {
    return withBusy(async () => {
      const deviceId = commandDevice();
      if (deviceId === undefined) return;
      if (options !== undefined && !options.modes.includes(next)) return;
      if (
        blockedWrite(
          'Read-only access: the steering mode was not changed. Request read and write access to command the autopilot.',
        )
      ) {
        return;
      }
      pendingCommand = 'mode';
      try {
        const outcome = await setAutopilotMode(origin, deps.getToken(), deviceId, next);
        if (
          !accepted(
            outcome,
            'Signal K refused the mode change. Read and write access is being requested.',
            'Could not reach the autopilot to change the mode. Check the connection.',
          )
        ) {
          return;
        }
        applyAccepted(deviceId, { mode: next });
      } finally {
        pendingCommand = undefined;
      }
    })();
  }

  // Nudges bypass the shared busy gate on purpose: a helm tapping minus one four times means
  // minus four degrees, so queued deltas coalesce into one in-flight write instead of being
  // dropped. Relative adjusts sum, so coalescing preserves the order's meaning.
  function adjustTarget(deltaRadians: number): void {
    if (!isFiniteNumber(deltaRadians) || Math.abs(deltaRadians) > MAX_ADJUST_RADIANS) return;
    const deviceId = commandDevice();
    // Adjusting a pilot that is not steering is rejected at the action boundary, not only by the
    // grayed button.
    if (deviceId === undefined || !engaged) return;
    if (
      blockedWrite(
        'Read-only access: the target was not changed. Request read and write access to command the autopilot.',
      )
    ) {
      return;
    }
    queuedAdjustRadians += deltaRadians;
    if (!adjustBusy) void flushAdjust(deviceId);
  }

  async function flushAdjust(deviceId: string): Promise<void> {
    adjustBusy = true;
    try {
      while (queuedAdjustRadians !== 0 && !disposed && selectedId === deviceId) {
        const delta = queuedAdjustRadians;
        queuedAdjustRadians = 0;
        const outcome = await adjustAutopilotTarget(origin, deps.getToken(), deviceId, delta);
        if (
          !accepted(
            outcome,
            'Signal K refused the target change. Read and write access is being requested.',
            'Could not reach the autopilot to change the target. Check the connection.',
          )
        ) {
          queuedAdjustRadians = 0;
          return;
        }
        if (snapshot !== undefined && snapshot.deviceId === deviceId) {
          const current = snapshot.info.target;
          snapshot = {
            deviceId,
            info: { ...snapshot.info, ...(current !== null ? { target: current + delta } : {}) },
            at: Date.now(),
          };
        }
      }
      void hydrateInfo(deviceId, true);
    } finally {
      adjustBusy = false;
    }
  }

  function maneuver(kind: 'tack' | 'gybe', direction: TackDirection): Promise<void> {
    const name = kind === 'tack' ? 'tack' : 'gybe';
    return makeCommand(
      name,
      `Read-only access: the ${name} was not commanded. Request read and write access to command the autopilot.`,
      async (deviceId) => {
        const run = kind === 'tack' ? tackAutopilot : gybeAutopilot;
        const outcome = await run(origin, deps.getToken(), deviceId, direction);
        if (
          !accepted(
            outcome,
            `Signal K refused the ${name} command. Read and write access is being requested.`,
            `Could not reach the autopilot to ${name}. Check the connection.`,
          )
        ) {
          return false;
        }
        void hydrateInfo(deviceId, true);
        return true;
      },
    )();
  }

  return {
    rehydrate,
    selectDevice,
    engage,
    disengage,
    setMode,
    adjustTarget,
    tack: (direction: TackDirection) => maneuver('tack', direction),
    gybe: (direction: TackDirection) => maneuver('gybe', direction),
    clearCommandError(): void {
      commandError = null;
    },
    dispose(): void {
      disposed = true;
      discoveryGeneration += 1;
      infoGeneration += 1;
    },
    get availability() {
      return availability;
    },
    // Which absence the landing copy explains: a v1 server has no Autopilot API at all, while a
    // 2.x server without a registered provider needs a provider plugin installed.
    get absentReason(): 'no-api' | 'no-provider' {
      return deps.apiAdvertised() === false ? 'no-api' : 'no-provider';
    },
    get devices() {
      return devices;
    },
    get selectedId() {
      return selectedId;
    },
    get pilotState() {
      return pilotState;
    },
    get mode() {
      return mode;
    },
    get target() {
      return target;
    },
    get engaged() {
      return engaged;
    },
    get modes() {
      return options?.modes ?? [];
    },
    get availableActionIds() {
      return availableActionIds;
    },
    get chip() {
      return chip;
    },
    get hydrating() {
      return hydrating;
    },
    get busy() {
      return busy;
    },
    get adjustBusy() {
      return adjustBusy;
    },
    get pendingCommand() {
      return pendingCommand;
    },
    get commandError() {
      return commandError;
    },
  };
}

export type AutopilotController = ReturnType<typeof createAutopilotController>;
