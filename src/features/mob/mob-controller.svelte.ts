import type { MobMark, MobStore } from '$entities/mob';
import type { GatedAlarm } from '$shared/audio';
import type { LatLon } from '$shared/geo';
import type { UnitsMode } from '$shared/lib';
import { postMobNotification, resolveNotification, SK_PATHS } from '$shared/signalk';
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
  // Whether the v2 Notifications API is available. A getter because it resolves asynchronously from
  // server feature discovery and the trigger path must branch on its live value.
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
// the in-flight raise so a cancel racing it resolves the eventual id, the MOB alarm effect, and the
// MOB live-region string; the host wires onTrigger, onCancel, and onSteer to the MOB button and strip,
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

  // The broad v1 raise, shared by the no-API path and the failed-POST fallback. The warning is
  // judged at publish time (a delta sent into a closed socket is silently dropped, and one sent
  // with a read-only token is rejected server-side), but never cleared here: a fire-and-forget
  // delta produces no error even when the server refuses it, so only the stream echoing the
  // raise back proves the boat was told, and the echo effect below owns that clearing.
  function publishFallback(committed: MobMark): void {
    publishMobValue(mobNotification(committed.position));
    mobPublishWarning = !deps.streamOpen()
      ? OFFLINE_WARNING
      : deps.writeBlocked()
        ? WRITE_BLOCKED_WARNING
        : UNCONFIRMED_WARNING;
  }

  // The server echoing a sounding notifications.mob back on the stream is the one proof the
  // boat-wide alarm went out; clear the honesty warning only on that evidence.
  $effect(() => {
    if (mob.active && mob.remoteActive && mobPublishWarning !== undefined) {
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
  // Retain every local v2 raise until a cancel can resolve its eventual id. A position-less MOB can
  // be triggered again while already active, so a single pending slot can strand an older alert.
  let localTriggerSequence = 0;
  let activeLocalTrigger: number | undefined;
  // The active trigger's committed mark, retained so a reconnect can replay a raise the dead
  // socket discarded.
  let activeMark: MobMark | undefined;
  const pendingMobAlerts = new Map<number, Promise<string | undefined>>();

  function raise(committed: MobMark): void {
    const sequence = ++localTriggerSequence;
    activeLocalTrigger = sequence;
    activeMark = committed;
    // A new raise supersedes any clear still owed to the boat.
    pendingClear = false;
    if (deps.writeBlocked()) mobPublishWarning = WRITE_BLOCKED_WARNING;
    if (deps.notificationsApi()) {
      // The v2 route attaches the server's own position and timestamp; if the POST fails, fall
      // back to the v1 delta so the boat-wide alarm is never lost to a transport error.
      const pending = postMobNotification(deps.origin, deps.getToken(), 'Man overboard');
      pendingMobAlerts.set(sequence, pending);
      void pending.then((id) => {
        // A canceled or superseded trigger must not raise a broad v1 alarm after its v2 request
        // finishes. The current trigger owns the fallback.
        if (activeLocalTrigger !== sequence) return;
        if (id) {
          mobPublishWarning = undefined;
          return;
        }
        publishFallback(committed);
      });
    } else {
      publishFallback(committed);
    }
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
  // is silently lost. A raise still owed (an active local trigger whose alarm never echoed back on
  // the stream) re-runs the whole chain, a fresh v2 POST first; the active-trigger guard means a
  // cancel racing the reconnect wins. A clear still owed goes back out once no trigger is active.
  function onStreamReconnect(): void {
    if (activeLocalTrigger !== undefined && activeMark !== undefined && !mob.remoteActive) {
      raise(activeMark);
      return;
    }
    if (pendingClear && activeLocalTrigger === undefined) {
      pendingClear = false;
      publishClear();
    }
  }

  function onCancel(): void {
    const canceledThrough = activeLocalTrigger;
    activeLocalTrigger = undefined;
    activeMark = undefined;
    mobPublishWarning = undefined;
    const streamedIds = mob.remoteNotificationIds;
    mob.cancel();
    const pending = [...pendingMobAlerts]
      .filter(([sequence]) => canceledThrough === undefined || sequence <= canceledThrough)
      .map(([sequence, alert]) => {
        pendingMobAlerts.delete(sequence);
        return alert;
      });
    if (pending.length === 0 && streamedIds.length === 0) {
      publishClear();
      return;
    }
    // Resolve each locally raised v2 notification by its id even when its stream echo still keeps
    // the aggregate MOB store active. Only the broad v1 fallback is suppressed by a newer trigger.
    void Promise.all(pending).then(async (pendingIds) => {
      const ids = new Set(streamedIds);
      for (const id of pendingIds) if (id) ids.add(id);
      const cleared = await resolveMobNotifications([...ids], (id) =>
        resolveNotification(deps.origin, deps.getToken(), id),
      );
      // A raise that resolved without an id is exactly the case where the broad v1 fallback may
      // have been published, so the broad clear must go out for it too; clearing an already-normal
      // broad path is harmless.
      const fallbackMayBeRaised = pendingIds.some((id) => id === undefined);
      const anyUnresolved = cleared.some((value) => !value) || fallbackMayBeRaised;
      if (anyUnresolved && activeLocalTrigger === undefined) {
        publishClear();
      }
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
