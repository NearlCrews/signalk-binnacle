import type { MobMark, MobStore } from '$entities/mob';
import type { GatedAlarm } from '$shared/audio';
import type { LatLon } from '$shared/geo';
import type { UnitsMode } from '$shared/lib';
import { postMobNotification, resolveNotification, SK_PATHS } from '$shared/signalk';
import { mobClearNotification, mobNotification } from './mob-notification';

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
// and reads mobAlert into LiveRegions.
export function createMobController(deps: MobControllerDeps) {
  const { mob, mobAlarm } = deps;

  function publishMobValue(value: unknown): void {
    deps.publishDelta(SK_PATHS.mobNotification, value);
  }

  // Sound the man-overboard alarm while a mark is active and unacknowledged.
  $effect(() => {
    mobAlarm.update(mob.active && !mob.acknowledged);
  });

  // The MOB channel of the assertive live region, the most urgent announcement in the app.
  const mobAlert = $derived.by(() => {
    if (!mob.active || mob.acknowledged) return '';
    return 'Man overboard. Steer back to the mark.';
  });

  // Commit the press-time mark, tell the whole boat, and bring the mark into view. Guidance only;
  // the course (and any coupled autopilot) is touched solely by the strip's deliberate Steer to MOB.
  // Without a fix the alarm still raises, position-less, so the crew mobilizes either way.
  // Retain every local v2 raise until a cancel can resolve its eventual id. A position-less MOB can
  // be triggered again while already active, so a single pending slot can strand an older alert.
  let localTriggerSequence = 0;
  let activeLocalTrigger: number | undefined;
  const pendingMobAlerts = new Map<number, Promise<string | undefined>>();
  function onTrigger(mark: MobMark | undefined): void {
    const sequence = ++localTriggerSequence;
    activeLocalTrigger = sequence;
    const committed = mob.trigger(mark);
    if (deps.notificationsApi()) {
      // The v2 route attaches the server's own position and timestamp; if the POST fails, fall
      // back to the v1 delta so the boat-wide alarm is never lost to a transport error.
      const pending = postMobNotification(deps.origin, deps.getToken(), 'Man overboard');
      pendingMobAlerts.set(sequence, pending);
      void pending.then((id) => {
        // A canceled or superseded trigger must not raise a broad v1 alarm after its v2 request
        // finishes. The current trigger owns the fallback.
        if (!id && activeLocalTrigger === sequence) {
          publishMobValue(mobNotification(committed.position));
        }
      });
    } else {
      publishMobValue(mobNotification(committed.position));
    }
    if (committed.position) {
      deps.flyTo(committed.position.latitude, committed.position.longitude);
    }
  }

  function onCancel(): void {
    const canceledThrough = activeLocalTrigger;
    activeLocalTrigger = undefined;
    mob.cancel();
    const pending = [...pendingMobAlerts]
      .filter(([sequence]) => canceledThrough === undefined || sequence <= canceledThrough)
      .map(([sequence, alert]) => {
        pendingMobAlerts.delete(sequence);
        return alert;
      });
    if (pending.length === 0) {
      publishMobValue(mobClearNotification());
      return;
    }
    // Resolve each locally raised v2 notification by its id even when its stream echo still keeps
    // the aggregate MOB store active. Only the broad v1 fallback is suppressed by a newer trigger.
    void Promise.all(
      pending.map(async (alert) => {
        const id = await alert;
        return id ? resolveNotification(deps.origin, deps.getToken(), id) : false;
      }),
    ).then((cleared) => {
      if (cleared.some((value) => !value) && activeLocalTrigger === undefined) {
        publishMobValue(mobClearNotification());
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
    get mobAlert() {
      return mobAlert;
    },
  };
}
