import { untrack } from 'svelte';
import { vesselLabel } from '$entities/ais';
import type { AnchorWatch } from '$entities/anchor';
import type { CollisionAssessment } from '$entities/collision';
import type { MobStore } from '$entities/mob';
import type { ActiveNotification, NotificationsStore } from '$entities/notifications';
import type { CollisionMute, GenericAlarm, LookoutAlarm } from '$features/lookout';
import { CollisionNotifier, notificationLabel, selectGenericAlarms } from '$features/lookout';
import type { CompanionStatus } from '$features/prewarm';
import type { TimeTravelController } from '$features/time-travel';
import { MINUTE_MS } from '$shared/lib';
import type { NotificationActionResult, SignalKClient } from '$shared/signalk';
import { acknowledgeNotification, SELF_CONTEXT, silenceNotification } from '$shared/signalk';
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

  function runNotificationAction(
    notification: ActiveNotification,
    action: (
      base: string,
      token: string | undefined,
      id: string,
    ) => Promise<NotificationActionResult>,
    unsupportedMessage: string,
    failMessage: string,
  ): void {
    if (!notification.id) return;
    alarmActionError = undefined;
    if (deps.writeBlocked()) {
      alarmActionError = 'Server write access is needed for this alarm action.';
      return;
    }
    void action(deps.origin, deps.token(), notification.id).then((result) => {
      if (result === 'unsupported') alarmActionError = unsupportedMessage;
      else if (result === 'failed') alarmActionError = failMessage;
    });
  }

  function onSilenceNotification(notification: ActiveNotification): void {
    runNotificationAction(
      notification,
      silenceNotification,
      'This server delegates notification management, so silence is unavailable.',
      'Could not silence the alert. Check the connection and access.',
    );
  }

  function onAcknowledgeNotification(notification: ActiveNotification): void {
    runNotificationAction(
      notification,
      acknowledgeNotification,
      'This server delegates notification management, so acknowledgment is unavailable.',
      'Could not acknowledge the alert. Check the connection and access.',
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
  let genericNotificationAlert = $state('');
  let lastGenericNotificationKey = '';
  $effect(() => {
    const notification = genericNotifications[0];
    if (!notification) {
      lastGenericNotificationKey = '';
      genericNotificationAlert = '';
      return;
    }
    const key = `${notification.path}:${notification.state}:${notification.message}`;
    if (key === lastGenericNotificationKey) return;
    lastGenericNotificationKey = key;
    genericNotificationAlert = `${notification.state}: ${notificationLabel(notification)}. Open Alarms for details.`;
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
    const dangerNow = !deps.collision.suppressed && deps.collision.assessment.worst === 'danger';
    if (deps.mob.active || dangerNow) untrack(() => deps.timeTravel.exit());
  });

  function muteGenericHere(): void {
    deps.genericAlarm.muteActiveHere();
  }

  return {
    toggleCollisionMute,
    onSilenceNotification,
    onAcknowledgeNotification,
    muteGenericHere,
    dispose: collisionPublisher.dispose,
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
