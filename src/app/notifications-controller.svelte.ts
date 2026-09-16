import { untrack } from 'svelte';
import { vesselLabel } from '$entities/ais';
import type { AnchorWatch } from '$entities/anchor';
import type { CollisionAssessment } from '$entities/collision';
import type { MobStore } from '$entities/mob';
import type { ActiveNotification, NotificationsStore } from '$entities/notifications';
import type { AlarmLogKind, CollisionMute, GenericAlarm, LookoutAlarm } from '$features/lookout';
import {
  CollisionNotifier,
  canAcknowledgeNotification,
  canSilenceNotification,
  isRaisedNotification,
  notificationGrade,
  notificationLabel,
  selectGenericAlarms,
  worstRaisedNotification,
} from '$features/lookout';
import type { CompanionStatus } from '$features/prewarm';
import type { TimeTravelController } from '$features/time-travel';
import { MINUTE_MS } from '$shared/lib';
import type { NotificationActionResult, SignalKClient } from '$shared/signalk';
import {
  acknowledgeAllNotifications,
  acknowledgeNotification,
  fetchRaisedNotificationPaths,
  fetchRaisedNotificationsById,
  SELF_CONTEXT,
  silenceAllNotifications,
  silenceNotification,
} from '$shared/signalk';
import { createCollisionNotificationPublisher } from './collision-notification-publisher';

interface NotificationsControllerDeps {
  origin: string;
  token: () => string | undefined;
  notificationsApi: () => boolean;
  writeBlocked: () => boolean;
  client: SignalKClient;
  collision: CollisionAssessment;
  collisionMute: CollisionMute;
  lookoutAlarm: LookoutAlarm;
  anchor: AnchorWatch;
  notificationsStore: NotificationsStore;
  companionStatus: CompanionStatus;
  timeTravel: TimeTravelController;
  mob: MobStore;
  genericAlarm: GenericAlarm;
  // The urn-form self context from the hello frame, for matching the v2 notification list's
  // per-entry context. A getter because it lands only once the stream delivers.
  selfContext: () => string | undefined;
  // The session alarm chronology; the controller records raise and clear edges plus every
  // silence, acknowledge, and mute it performs. Optional so tests without a log stay valid.
  log?: (entry: { kind: AlarmLogKind; label: string; detail?: string; source?: string }) => void;
  // The one depth notification path the shallow monitor currently sounds itself, or undefined. A
  // getter because the claim moves with the winning depth path and the server's zones.
  ownedDepthNotificationPath: () => string | undefined;
  // Whether the anchor entity sounds the anchor notification itself (server mode). A getter
  // because the mode changes over the session.
  anchorNotificationCovered: () => boolean;
}

// Owns collision publication, alarm actions, safety live-region text, and the effects that tie an
// active danger to sound and time-travel exit. It remains app-level because it deliberately composes
// several feature and entity slices, while each feature's own controller stays self-contained.
export function createNotificationsController(deps: NotificationsControllerDeps) {
  let alarmActionError = $state<string | undefined>();
  let disposed = false;
  const confirmationWaiters = new Set<{ settled: () => boolean; finish: () => void }>();

  $effect(() => {
    void deps.notificationsStore.version;
    for (const waiter of confirmationWaiters) if (waiter.settled()) waiter.finish();
  });

  async function confirmNotificationAction(
    original: readonly ActiveNotification[],
    kind: 'silenced' | 'acknowledged',
    token: string | undefined,
  ): Promise<boolean> {
    const settled = (): boolean => {
      const current = deps.notificationsStore.list();
      return original.every((before) => {
        const after = current.find((candidate) => candidate.path === before.path);
        return (
          !after ||
          after.id !== before.id ||
          after.activation !== before.activation ||
          after[kind] === true ||
          (kind === 'silenced' && after.acknowledged === true)
        );
      });
    };
    if (settled()) return true;
    await new Promise<void>((resolve) => {
      const waiter = {
        settled,
        finish: () => {
          clearTimeout(timer);
          confirmationWaiters.delete(waiter);
          resolve();
        },
      };
      const timer = setTimeout(waiter.finish, 3_000);
      confirmationWaiters.add(waiter);
    });
    if (disposed || token !== deps.token()) return false;
    if (!settled()) await reconcileAfterReconnect(token);
    return !disposed && token === deps.token() && settled();
  }

  function publishDelta(path: string, value: unknown): void {
    void deps.client.publish({
      context: SELF_CONTEXT,
      updates: [{ values: [{ path, value }] }],
    });
  }

  const collisionPublisher = createCollisionNotificationPublisher({
    origin: deps.origin,
    token: deps.token,
    apiAvailable: deps.notificationsApi,
    publishDelta,
  });
  const collisionNotifier = new CollisionNotifier({ publish: collisionPublisher.publish });

  function toggleCollisionMute(): void {
    deps.collisionMute.toggle();
    if (deps.collisionMute.active) deps.log?.({ kind: 'muted', label: 'Collision alarm' });
    const alertId = collisionPublisher.alertId;
    if (!deps.collisionMute.active || !alertId) return;
    alarmActionError = undefined;
    if (deps.writeBlocked()) {
      alarmActionError =
        'Collision alarm muted on this device. Server write access is needed to silence other stations.';
      return;
    }
    void silenceNotification(deps.origin, deps.token(), alertId).then((result) => {
      if (result === 'unsupported') {
        alarmActionError =
          'Collision alarm muted on this device. This server delegates notification management, so boat-wide silence is unavailable.';
      } else if (result === 'failed') {
        alarmActionError = 'Could not silence the alert boat-wide. Other stations may still sound.';
      }
    });
  }

  async function runNotificationAction(
    notification: ActiveNotification,
    action: (
      base: string,
      token: string | undefined,
      id: string,
    ) => Promise<NotificationActionResult>,
    unsupportedMessage: string,
    failMessage: string,
    logKind: 'silenced' | 'acknowledged',
  ): Promise<void> {
    if (!notification.id) return;
    alarmActionError = undefined;
    if (deps.writeBlocked()) {
      alarmActionError = 'Server write access is needed for this alarm action.';
      return;
    }
    const token = deps.token();
    const result = await action(deps.origin, token, notification.id);
    if (disposed || token !== deps.token()) return;
    if (result === 'unsupported') alarmActionError = unsupportedMessage;
    else if (result === 'failed') alarmActionError = failMessage;
    else if (await confirmNotificationAction([notification], logKind, token))
      deps.log?.({
        kind: logKind,
        label: notificationLabel(notification),
        source: notification.path,
      });
    else if (!disposed && token === deps.token())
      alarmActionError =
        'The server accepted the request, but the alarm status is unconfirmed. Retry or use Mute here on the alarm strip.';
  }

  // An alarm flood is one tap: the server's bulk routes apply to every active alarm at once. The
  // same write gate and error grammar as the per-id actions, logged once as a bulk entry.
  async function runBulkNotificationAction(
    action: (base: string, token: string | undefined) => Promise<NotificationActionResult>,
    logKind: 'silenced' | 'acknowledged',
    failMessage: string,
  ): Promise<void> {
    alarmActionError = undefined;
    if (deps.writeBlocked()) {
      alarmActionError = 'Server write access is needed for this alarm action.';
      return;
    }
    const token = deps.token();
    const original = deps.notificationsStore
      .list()
      .filter(logKind === 'silenced' ? canSilenceNotification : canAcknowledgeNotification);
    const result = await action(deps.origin, token);
    if (disposed || token !== deps.token()) return;
    if (result === 'unsupported') {
      alarmActionError =
        'This server delegates notification management, so bulk actions are unavailable.';
    } else if (result === 'failed') {
      alarmActionError = failMessage;
    } else if (await confirmNotificationAction(original, logKind, token)) {
      deps.log?.({ kind: logKind, label: 'All active alarms' });
    } else if (!disposed && token === deps.token()) {
      alarmActionError =
        'The server accepted the request, but some alarm statuses are unconfirmed. Retry or use Mute here on the alarm strip.';
    }
  }

  function onSilenceAllNotifications(): Promise<void> {
    return runBulkNotificationAction(
      silenceAllNotifications,
      'silenced',
      'Could not silence every alert. Check the connection and access.',
    );
  }

  function onAcknowledgeAllNotifications(): Promise<void> {
    return runBulkNotificationAction(
      acknowledgeAllNotifications,
      'acknowledged',
      'Could not acknowledge every alert. Check the connection and access.',
    );
  }

  function onSilenceNotification(notification: ActiveNotification): Promise<void> {
    return runNotificationAction(
      notification,
      silenceNotification,
      'This server delegates notification management, so silence is unavailable.',
      'Could not silence the alert. Check the connection and access.',
      'silenced',
    );
  }

  function onAcknowledgeNotification(notification: ActiveNotification): Promise<void> {
    return runNotificationAction(
      notification,
      acknowledgeNotification,
      'This server delegates notification management, so acknowledgment is unavailable.',
      'Could not acknowledge the alert. Check the connection and access.',
      'acknowledged',
    );
  }

  $effect(() => {
    deps.lookoutAlarm.update(
      deps.collision.assessment.worst,
      deps.collision.suppressed,
      deps.collisionMute.active,
      deps.collision.escalating,
      deps.anchor.watching,
    );
  });

  const collisionAlert = $derived.by(() => {
    const { contacts } = deps.collision.assessment;
    if ((deps.collision.suppressed && !deps.collision.escalating) || contacts.length === 0)
      return '';
    const nearest = contacts[0];
    const who = vesselLabel(nearest.name, nearest.id);
    const lead = nearest.severity === 'warning' ? 'Collision warning' : 'Collision danger';
    return `${lead}: ${who}. Open Nearby vessels for closest-pass details.`;
  });

  const genericNotifications = $derived(
    selectGenericAlarms(deps.notificationsStore.list(), {
      ownedDepthPath: deps.ownedDepthNotificationPath(),
      anchorCovered: deps.anchorNotificationCovered(),
    }),
  );
  $effect(() => {
    deps.genericAlarm.update(genericNotifications);
  });

  // The chronology's raise and clear edges, keyed by path so a persistent alarm republished every
  // delta cycle records once. Only raised states count as active; a downgrade to normal or a
  // reconcile removal both read as cleared.
  let loggedRaised = new Map<string, string>();
  $effect(() => {
    if (!deps.log) return;
    const current = new Map<string, string>();
    for (const notification of genericNotifications) {
      if (!isRaisedNotification(notification)) continue;
      current.set(notification.path, notificationLabel(notification));
    }
    for (const [path, label] of current) {
      if (!loggedRaised.has(path))
        untrack(() => deps.log?.({ kind: 'raised', label, source: path }));
    }
    for (const [path, label] of loggedRaised) {
      if (!current.has(path)) untrack(() => deps.log?.({ kind: 'cleared', label, source: path }));
    }
    loggedRaised = current;
  });
  // A pure function of the worst generic notification, so it is a derived. It used to be an effect
  // with a hand-tracked key, which re-implemented what a derived does and could desynchronize on any
  // future early return. Assigning an equal string to the live region is already a no-op, so the key
  // was buying nothing the runtime does not do itself.
  //
  // Only the grades the alarm strip renders reach the assertive region: a "warn" that produces no
  // sound and no strip must not interrupt a screen reader mid-sentence. The gate is deliberately the
  // strip's grade test rather than isAudibleAlarmNotification, which is also false for a silenced
  // alarm and for an explicit method list without 'sound', both of which the strip still shows.
  const genericNotificationAlert = $derived.by(() => {
    const notification = worstRaisedNotification(genericNotifications);
    if (!notification) return '';
    const grade = notificationGrade(notification);
    return `${grade}: ${notificationLabel(notification)}. Open Alarms for details.`;
  });

  const muteAlert = $derived(deps.collisionMute.active ? 'Collision alarm muted.' : '');
  const muteRemainingMin = $derived(
    Math.max(1, Math.ceil(deps.collisionMute.remainingMs / MINUTE_MS)),
  );

  let companionAnnounce = $state('');
  let companionWasDown = false;
  $effect(() => {
    const state = deps.companionStatus.state;
    const down = deps.companionStatus.down;
    if (down === companionWasDown) return;
    companionWasDown = down;
    companionAnnounce = down
      ? state === 'error'
        ? 'Chart Locker reported a server error.'
        : 'Chart Locker is not responding.'
      : 'Chart Locker is responding again.';
  });

  $effect(() => {
    collisionNotifier.update(deps.collision.assessment);
  });

  $effect(() => {
    if (!deps.timeTravel.active) return;
    const dangerNow =
      deps.collision.assessment.worst === 'danger' &&
      (!deps.collision.suppressed || deps.collision.escalating);
    if (deps.mob.active || dangerNow) untrack(() => deps.timeTravel.exit());
  });

  function muteGenericHere(): void {
    for (const notification of deps.genericAlarm.muteActiveHere()) {
      deps.log?.({
        kind: 'muted',
        label: notificationLabel(notification),
        source: notification.path,
        detail: 'On this device only.',
      });
    }
  }

  // Repair the notifications mirror after a stream reopen: alarms cleared or reaped server-side
  // during the outage sent no clearing delta on the new socket, so the mirror is reconciled
  // against a REST snapshot. The v2 id-keyed list is the preferred source because it carries each
  // alarm's id and status, so a reconciled alarm keeps its Silence and Acknowledge actions; the
  // v1 tree walk recovers only bare paths and remains the pre-2.28 fallback. An undefined
  // snapshot from both means the fetch failed; the mirror stays untouched then, keeping the
  // fail-safe direction. The returned promise settles after the reconcile, so a caller can order
  // replay decisions that read the mirror behind it.
  async function reconcileAfterReconnect(token: string | undefined): Promise<void> {
    const snapshotEpoch = Date.now();
    if (deps.notificationsApi()) {
      const byId = await fetchRaisedNotificationsById(deps.origin, token, deps.selfContext());
      if (disposed || token !== deps.token()) return;
      if (byId) {
        deps.notificationsStore.reconcileWithValues(byId, snapshotEpoch);
        return;
      }
    }
    const paths = await fetchRaisedNotificationPaths(deps.origin, token);
    if (disposed || token !== deps.token()) return;
    if (paths) deps.notificationsStore.reconcile(paths, snapshotEpoch);
  }

  return {
    toggleCollisionMute,
    onSilenceNotification,
    onAcknowledgeNotification,
    onSilenceAllNotifications,
    onAcknowledgeAllNotifications,
    muteGenericHere,
    reconcileAfterReconnect,
    dispose() {
      disposed = true;
      for (const waiter of confirmationWaiters) waiter.finish();
      collisionPublisher.dispose();
    },
    get genericAlarms() {
      return genericNotifications;
    },
    get genericSounding() {
      return deps.genericAlarm.sounding;
    },
    get genericLocallyMuted() {
      return deps.genericAlarm.locallyMuted;
    },
    get collisionAlert() {
      return collisionAlert;
    },
    get notificationAlert() {
      return genericNotificationAlert;
    },
    get muteAlert() {
      return muteAlert;
    },
    get muteRemainingMin() {
      return muteRemainingMin;
    },
    get companionAnnounce() {
      return companionAnnounce;
    },
    get alarmActionError() {
      return alarmActionError;
    },
  };
}
