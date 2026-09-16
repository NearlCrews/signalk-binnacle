import type { MobMark, MobStore } from '$entities/mob';
import type { GatedAlarm } from '$shared/audio';
import type { LatLon } from '$shared/geo';
import type { UnitsMode } from '$shared/lib';
import { resolveNotification, SK_PATHS } from '$shared/signalk';
import { shouldSoundMobAlarm } from './mob-alarm';
import { mobAlertText } from './mob-format';
import { mobClearNotification, mobNotification } from './mob-notification';

const NOTIFICATION_RESOLVE_CONCURRENCY = 4;

async function resolveMobNotifications(
  ids: readonly string[],
  resolve: (id: string) => Promise<boolean>,
): Promise<boolean[]> {
  const results = new Array<boolean>(ids.length);
  let nextIndex = 0;
  async function worker(): Promise<void> {
    while (nextIndex < ids.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await resolve(ids[index]);
    }
  }
  const workerCount = Math.min(NOTIFICATION_RESOLVE_CONCURRENCY, ids.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

export interface MobControllerDeps {
  // The Signal K server origin, captured once for the page lifetime.
  origin: string;
  // The Signal K auth token, when one is configured. A getter so a token that arrives or changes
  // mid-session (an approval from another tab) is read live, not frozen at construction.
  getToken: () => string | undefined;
  // The man-overboard store, a stable instance passed by reference.
  mob: MobStore;
  // The man-overboard alarm, a stable instance passed by reference.
  mobAlarm: GatedAlarm;
  // The active units mode, so the live-region range matches the strip's Range readout. A
  // getter-backed object (the shared UnitsStore) so a mid-session preference change reads live.
  units: { mode: UnitsMode };
  // Whether remote notifications can be resolved through the v2 Notifications API.
  notificationsApi: () => boolean;
  // Whether server writes are known to be blocked (a read-only token). A getter for the same
  // reason as the token: an approval from another tab must be read live.
  writeBlocked: () => boolean;
  // Whether the stream socket is open. A closed socket silently discards published deltas (the
  // connection drops the send, and a published delta has no transport-level replay), so the raise
  // and clear paths must know when a publish may have been lost. A getter: the phase changes live.
  streamOpen: () => boolean;
  // Publish a raw v1 delta to the self vessel.
  publishDelta: (path: string, value: unknown) => void;
  // Fly the chart to a position (the committed MOB mark).
  flyTo: (lat: number, lon: number) => void;
  // Steer to a position via the course system (the existing goto plumbing).
  goTo: (position: LatLon) => Promise<void>;
}

// Man overboard orchestration: one tap on the strip button marks the spot, publishes the boat-wide
// alarm, and raises the recovery strip; a remote station's notifications.mob raises it here too. Owns
// the immutable mark publication, the MOB alarm effect, and the MOB live-region string. The host
// wires onTrigger, onCancel, and onSteer to the MOB button and strip,
// calls onStreamReconnect from its reconnect refresh chain, and reads mobAlert into LiveRegions and
// mobPublishWarning into the strip.
const WRITE_BLOCKED_WARNING =
  'The boat-wide alarm may not have reached the server. Server write access is needed.';
const OFFLINE_WARNING =
  'The boat-wide alarm may not have reached the server. It retries when the connection returns.';
const UNCONFIRMED_WARNING = 'The boat-wide alarm has not been confirmed by the server yet.';

export function createMobController(deps: MobControllerDeps) {
  const { mob, mobAlarm } = deps;

  // The trigger's honesty channel: set when the boat-wide announcement may not have gone out
  // (write-blocked token, dead socket), cleared by a cancel or a later raise known to have landed.
  let mobPublishWarning = $state<string | undefined>();
  // A broad v1 clear was published while the socket was down, so it must go back out on reconnect
  // or every other station keeps alarming forever.
  let pendingClear = false;

  function publishMobValue(value: unknown): void {
    deps.publishDelta(SK_PATHS.mobNotification, value);
  }

  function publishClear(): void {
    if (!deps.streamOpen()) pendingClear = true;
    publishMobValue(mobClearNotification());
  }

  function publishMark(committed: MobMark): void {
    // The v2 MOB route substitutes server processing-time GPS and time. A standard notification
    // delta preserves the immutable press-time mark at every receiving station.
    publishMobValue(mobNotification(committed.position, committed.epochMs));
    mobPublishWarning = !deps.streamOpen()
      ? OFFLINE_WARNING
      : deps.writeBlocked()
        ? WRITE_BLOCKED_WARNING
        : UNCONFIRMED_WARNING;
  }

  // Another station's alarm cannot confirm delivery of this station's captured mark.
  $effect(() => {
    if (activeMark && mob.confirmsMark(activeMark) && mobPublishWarning !== undefined) {
      mobPublishWarning = undefined;
    }
  });

  // Sound the man-overboard alarm while a mark is active and unacknowledged.
  $effect(() => {
    mobAlarm.update(shouldSoundMobAlarm(mob.active, mob.acknowledged));
  });

  // The MOB channel of the assertive live region, the most urgent announcement in the app. The
  // bearing and range are quantized (5 degrees, 10 meters) so the string settles between
  // meaningful changes: re-deriving on every GPS fix would restart the screen reader
  // mid-sentence for a shift no helm order follows, exactly when the announcement matters most.
  const BEARING_STEP_RAD = (5 * Math.PI) / 180;
  const RANGE_STEP_M = 10;
  const mobAlert = $derived.by(() => {
    if (!mob.active || mob.acknowledged) return '';
    const bearing =
      mob.bearingRad === undefined
        ? undefined
        : Math.round(mob.bearingRad / BEARING_STEP_RAD) * BEARING_STEP_RAD;
    const distance =
      mob.distanceMeters === undefined
        ? undefined
        : Math.round(mob.distanceMeters / RANGE_STEP_M) * RANGE_STEP_M;
    return mobAlertText(bearing, distance, deps.units.mode);
  });

  // Commit the press-time mark, tell the whole boat, and bring the mark into view. Guidance only;
  // the course (and any coupled autopilot) is touched solely by the strip's deliberate Steer to MOB.
  // Without a fix the alarm still raises, position-less, so the crew mobilizes either way.
  let activeMark = $state<MobMark | undefined>();

  function raise(committed: MobMark): void {
    activeMark = committed;
    // A new raise supersedes any clear still owed to the boat.
    pendingClear = false;
    publishMark(committed);
  }

  function onTrigger(mark: MobMark | undefined): void {
    const committed = mob.trigger(mark);
    raise(committed);
    if (committed.position) {
      deps.flyTo(committed.position.latitude, committed.position.longitude);
    }
  }

  // Replay whatever a dropped socket discarded, called by the host on a genuine stream reopen.
  // A published delta has no transport-level replay, so a raise or clear that went out mid-outage
  // is silently lost. Replay the same captured mark, never the boat's reconnect-time position.
  function onStreamReconnect(): void {
    if (activeMark !== undefined && !mob.confirmsMark(activeMark)) {
      raise(activeMark);
      return;
    }
    if (pendingClear && activeMark === undefined) {
      pendingClear = false;
      publishClear();
    }
  }

  function onCancel(): void {
    const localWasActive = activeMark !== undefined;
    activeMark = undefined;
    mobPublishWarning = undefined;
    const streamedIds = mob.remoteNotificationIds;
    mob.cancel();
    if (localWasActive || streamedIds.length === 0 || !deps.notificationsApi()) publishClear();
    if (!deps.notificationsApi() || streamedIds.length === 0) return;
    void resolveMobNotifications(streamedIds, (id) =>
      resolveNotification(deps.origin, deps.getToken(), id),
    ).then((cleared) => {
      if (cleared.some((value) => !value) && activeMark === undefined) publishClear();
    });
  }

  // The deliberate second tap: hand the mark to the course system via the existing goto plumbing.
  function onSteer(): void {
    const mark = mob.position;
    if (mark) void deps.goTo(mark);
  }

  return {
    onTrigger,
    onCancel,
    onSteer,
    onStreamReconnect,
    get mobAlert() {
      return mobAlert;
    },
    get mobPublishWarning() {
      return mobPublishWarning;
    },
  };
}
