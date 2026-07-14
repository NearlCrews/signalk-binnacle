import { untrack } from 'svelte';
import { vesselLabel } from '$entities/ais';
import type { AnchorWatch } from '$entities/anchor';
import type { CollisionAssessment } from '$entities/collision';
import type { MobStore } from '$entities/mob';
import type { ActiveNotification, NotificationsStore } from '$entities/notifications';
import type { CollisionMute, LookoutAlarm } from '$features/lookout';
import { CollisionNotifier } from '$features/lookout';
import type { CompanionStatus } from '$features/prewarm';
import type { TimeTravelStore } from '$features/time-travel';
import { MINUTE_MS } from '$shared/lib';
import type { SignalKClient } from '$shared/signalk';
import {
  acknowledgeNotification,
  postNotification,
  resolveNotification,
  SELF_CONTEXT,
  SK_PATHS,
  silenceNotification,
  updateNotification,
} from '$shared/signalk';

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
  timeTravel: TimeTravelStore;
  mob: MobStore;
}

// Owns collision publication, alarm actions, safety live-region text, and the effects that tie an
// active danger to sound and time-travel exit. It remains app-level because it deliberately composes
// several feature and entity slices, while each feature's own controller stays self-contained.
export function createNotificationsController(deps: NotificationsControllerDeps) {
  let collisionAlertId: string | undefined;
  let alarmActionError = $state<string | undefined>();

  function publishDelta(path: string, value: unknown): void {
    void deps.client.publish({
      context: SELF_CONTEXT,
      updates: [{ values: [{ path, value }] }],
    });
  }

  const collisionNotifier = new CollisionNotifier({
    publish: async (path, value) => {
      const apiAvailable = deps.notificationsApi();
      const token = deps.token();
      if (!apiAvailable) {
        publishDelta(path, value);
        return;
      }
      if (value.state === 'normal') {
        if (collisionAlertId) {
          const cleared = await resolveNotification(deps.origin, token, collisionAlertId);
          collisionAlertId = undefined;
          if (!cleared) publishDelta(path, value);
        }
        return;
      }
      if (collisionAlertId) {
        const updated = await updateNotification(deps.origin, token, collisionAlertId, {
          state: value.state,
          message: value.message,
        });
        if (updated === 'updated') return;
        if (updated === 'failed') {
          publishDelta(path, value);
          return;
        }
        collisionAlertId = undefined;
      }
      collisionAlertId = await postNotification(deps.origin, token, {
        state: value.state,
        message: value.message,
        path: 'navigation.collision',
        includePosition: true,
        includeCreatedAt: true,
      });
      if (!collisionAlertId) publishDelta(path, value);
    },
  });

  function toggleCollisionMute(): void {
    deps.collisionMute.toggle();
    if (!deps.collisionMute.active || !collisionAlertId) return;
    alarmActionError = undefined;
    if (deps.writeBlocked()) {
      alarmActionError =
        'Collision alarm muted on this device. Server write access is needed to silence other stations.';
      return;
    }
    void silenceNotification(deps.origin, deps.token(), collisionAlertId).then((ok) => {
      if (!ok) {
        alarmActionError = 'Could not silence the alert boat-wide. Other stations may still sound.';
      }
    });
  }

  function runNotificationAction(
    notification: ActiveNotification,
    action: (base: string, token: string | undefined, id: string) => Promise<boolean>,
    failMessage: string,
  ): void {
    if (!notification.id) return;
    alarmActionError = undefined;
    if (deps.writeBlocked()) {
      alarmActionError = 'Server write access is needed for this alarm action.';
      return;
    }
    void action(deps.origin, deps.token(), notification.id).then((ok) => {
      if (!ok) alarmActionError = failMessage;
    });
  }

  function onSilenceNotification(notification: ActiveNotification): void {
    runNotificationAction(
      notification,
      silenceNotification,
      'Could not silence the alert. Check the connection and access.',
    );
  }

  function onAcknowledgeNotification(notification: ActiveNotification): void {
    runNotificationAction(
      notification,
      acknowledgeNotification,
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
    deps.notificationsStore
      .list()
      .filter(
        (notification) =>
          !notification.acknowledged &&
          !notification.path.startsWith(SK_PATHS.mobNotification) &&
          notification.path !== SK_PATHS.anchorNotification &&
          notification.path !== 'notifications.navigation.collision',
      ),
  );
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
    const label = notification.message || notification.path.replace(/^notifications\./, '');
    genericNotificationAlert = `${notification.state}: ${label}. Open Alarms for details.`;
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

  return {
    toggleCollisionMute,
    onSilenceNotification,
    onAcknowledgeNotification,
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
