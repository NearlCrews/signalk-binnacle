import type { AnchorWatch } from '$entities/anchor';
import type { OwnVessel } from '$entities/vessel';
import type { GatedAlarm } from '$shared/audio';
import type { LatLon } from '$shared/geo';
import { createBusyGate } from '$shared/lib';
import { shouldSoundAnchorAlarm } from './anchor-alarm';
import { resolveAnchorTransport } from './anchor-transport';
import { createBatteryWatch, navigatorGetBattery } from './battery-watch.svelte';

export interface AnchorControllerDeps {
  // The Signal K server origin, captured once for the page lifetime.
  origin: string;
  // The Signal K auth token, when one is configured. A getter so a token that arrives or changes
  // mid-session is read live by the transport, not frozen at construction.
  getToken: () => string | undefined;
  // The anchor watch, a stable instance passed by reference.
  anchor: AnchorWatch;
  // The own vessel, a stable instance passed by reference; the drop reads its live position.
  vessel: OwnVessel;
  // The anchor-drag alarm, a stable instance passed by reference.
  anchorAlarm: GatedAlarm;
  // Whether the server exposes the standard Anchor API. A getter because it resolves asynchronously
  // from server feature discovery, and the transport is reselected as it changes.
  serverHasAnchorApi: () => boolean;
  // Fires after a drop or raise succeeds; the composition root offers a logbook entry from it.
  onAnchorLogMoment?: (kind: 'dropped' | 'raised', radiusMeters?: number) => void;
  writeBlocked: () => boolean;
  // navigator.getBattery where the browser offers it (Chromium only); injectable for tests. The
  // key being present with undefined means "no Battery Status API", so tests can force the
  // silent no-op path.
  getBattery?: () => Promise<unknown>;
}

// The anchor watch orchestration: server-driven when the standard Anchor API or the anchoralarm plugin
// answers, client-side otherwise. Owns the anchor error shown until the next action, the resolved
// transport, the action chain, the anchor live-region string, the anchor effects (the
// position-fix update and the drag alarm), and the device battery watch behind a client-mode
// watch. The host wires onDrop, onRaise, onSetRadius, and onAnchorMoved to the panel and chart,
// reads anchorError and batteryNote into the panel, and reads anchorAlert into LiveRegions.
export function createAnchorController(deps: AnchorControllerDeps) {
  const { anchor, vessel, anchorAlarm } = deps;

  // An anchor error shown in the panel until the next anchor action clears it, rather than
  // auto-dismissing: on a boat an error must persist until the operator has acted on it.
  let anchorError = $state<string | undefined>();
  let busy = $state(false);

  // The anchor action chain, selected once at resolve time from capabilities: the standard Anchor
  // API when the server exposes it (a proposal today, tracked by the weekly watch), otherwise the
  // anchoralarm plugin probe. A failed call on the selected transport degrades to the client-local
  // watch, never sideways to the other transport: a server that advertises the standard API and
  // then fails it has a problem masking would hide. Until features resolve, every action lands on
  // the local path.
  const anchorTransport = $derived(
    resolveAnchorTransport(deps.origin, deps.getToken, {
      standardApiAvailable: deps.serverHasAnchorApi(),
    }),
  );

  // One anchor-watch pass per position fix (the method dedupes by fix epoch, so the extra re-runs a
  // radius edit or a notification triggers are harmless): client-mode drag detection, plus the
  // local bookkeeping a server watch needs.
  $effect(() => {
    anchor.updateFix();
  });

  // Sound the anchor alarm: a drag, or a watch that has been blind long enough (a client watch
  // without fixes, a server watch without its stream) that its protection here is genuinely
  // dead. The acknowledge semantics live in the watch: client mode clears the drag latch
  // outright, server mode silences the current grade until it changes or clears, and a blind
  // acknowledge holds until protection returns.
  $effect(() => {
    anchorAlarm.update(
      shouldSoundAnchorAlarm(
        anchor.dragging,
        anchor.acknowledged,
        anchor.blindAlarm,
        anchor.blindAcknowledged,
      ),
    );
  });

  // The anchor channel of the assertive live region, separate from the collision channel so a drag
  // alarm is announced even while a collision alert holds the other region. The degraded causes
  // are worded apart: a down link and a reconnect's stale window are not GPS losses, and calling
  // either one on every reconnect would train the crew to ignore this channel.
  const anchorAlert = $derived.by(() => {
    const cause = anchor.degradedCause;
    if (cause === 'fix-lost') {
      return 'Anchor watch degraded: no GPS fix, so drag detection has stopped.';
    }
    if (cause === 'link-lost') {
      return 'Anchor watch degraded: connection to the server lost, so its drag alarm cannot reach this display.';
    }
    if (cause === 'server-stale') {
      return 'Anchor watch state is stale: reconnecting to the server.';
    }
    if (!anchor.dragging || anchor.acknowledged) return '';
    return 'Anchor alarm: the boat is dragging.';
  });

  // A client watch dies with this device's battery, and it dies silently: warn while the watch
  // is armed and the device is discharging low. A server watch is unaffected; the server keeps
  // alarming aboard without this display.
  const battery = createBatteryWatch({
    active: () => anchor.mode === 'client',
    getBattery: 'getBattery' in deps ? deps.getBattery : navigatorGetBattery(),
  });

  const withBusy = createBusyGate(
    () => busy,
    (next) => {
      busy = next;
    },
  );

  async function performDrop(): Promise<void> {
    anchorError = undefined;
    const position = vessel.position;
    if (!position || vessel.positionStale) {
      anchorError = 'A fresh GPS fix is needed to drop the anchor.';
      return;
    }
    const radius = anchor.preferredRadiusMeters;
    if (deps.writeBlocked()) {
      anchor.dropLocal(position, radius);
      anchorError =
        'Server write access is unavailable. Anchor watch is running in this browser only.';
      deps.onAnchorLogMoment?.('dropped', radius);
      return;
    }
    // The server drop doubles as detection: when the standard API or the anchoralarm plugin answers,
    // the server owns the watch (and keeps alarming with the browser closed) and the stream reflects
    // it back. Any failure degrades to the client-side watch; the panel's mode line says which.
    if (await anchorTransport.drop(radius)) {
      deps.onAnchorLogMoment?.('dropped', radius);
      return;
    }
    // A server whose standard Anchor API was feature-detected and then refused the drop has a problem
    // the silent local fallback would hide; surface it, then still start the local watch so the boat
    // is covered. The plugin-probe path cannot tell absent from refused, so it degrades quietly.
    if (anchorTransport.kind === 'standard') {
      anchorError = 'Could not drop the anchor on the server. Check the connection.';
    }
    anchor.dropLocal(position, radius);
    deps.onAnchorLogMoment?.('dropped', radius);
  }
  const onDrop = withBusy(performDrop);

  // Route an anchor action by mode. In server mode the plugin call must succeed; a failure is
  // surfaced, never papered over with a local-only change that would desync from a server that is
  // still watching. Otherwise the local fallback runs.
  async function performAnchorAction(
    serverCall: () => Promise<boolean>,
    action: string,
    local: () => void,
  ): Promise<void> {
    anchorError = undefined;
    if (anchor.mode === 'server' && deps.writeBlocked()) {
      anchorError = `Could not ${action}. Server write access is required.`;
      return;
    }
    if (anchor.mode !== 'server') {
      local();
      return;
    }
    if (!(await serverCall())) {
      anchorError = `Could not ${action} on the server. Check the connection.`;
    }
  }
  const anchorAction = withBusy(performAnchorAction);

  async function onRaise(): Promise<void> {
    const wasWatching = anchor.watching;
    await anchorAction(
      () => anchorTransport.raise(),
      'raise the anchor',
      () => anchor.raiseLocal(),
    );
    // Only a raise that actually ended a watch is worth a log line.
    if (wasWatching && !anchor.watching) deps.onAnchorLogMoment?.('raised');
  }

  function onSetRadius(meters: number): Promise<void> {
    anchor.rememberRadius(meters);
    return anchorAction(
      () => anchorTransport.setRadius(meters),
      'set the radius',
      () => anchor.setRadiusLocal(meters),
    );
  }

  function onAnchorMoved(position: LatLon): Promise<void> {
    return anchorAction(
      () => anchorTransport.setPosition(position),
      'move the anchor',
      () => anchor.movePositionLocal(position),
    );
  }

  return {
    onDrop,
    onRaise,
    onSetRadius,
    onAnchorMoved,
    get anchorError() {
      return anchorError;
    },
    get anchorAlert() {
      return anchorAlert;
    },
    get batteryWarning() {
      return battery.warning;
    },
    get batteryNote() {
      return battery.note;
    },
    get busy() {
      return busy;
    },
  };
}
