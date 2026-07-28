import type { ActiveNotification } from '$entities/notifications';

const NOTIFICATIONS_PATH_PREFIX = /^notifications\./;

// What to call this alert on screen. A producer that raised one without a message still has to be
// identifiable, so the path tail stands in for it. Shared so the panel and the strip can never name
// the same alert differently.
export const notificationLabel = (n: ActiveNotification): string =>
  n.message || n.path.replace(NOTIFICATIONS_PATH_PREFIX, '');

// Whether the v2 silence route can act on this alert: it needs a server-assigned id and an explicit
// capability flag, and an emergency is deliberately not silenceable. Shared by the alarms panel and
// the alarm strip so one alert cannot offer Silence in one surface and refuse it in the other.
export const canSilenceNotification = (n: ActiveNotification): boolean =>
  n.id !== undefined &&
  n.state !== 'emergency' &&
  n.canSilence === true &&
  !n.silenced &&
  !n.acknowledged;

// Whether the v2 acknowledge route can act on this alert. Unlike silence, it applies to every
// raised grade, since acknowledging is how an emergency is cleared.
export const canAcknowledgeNotification = (n: ActiveNotification): boolean =>
  n.id !== undefined && n.canAcknowledge === true && !n.acknowledged;
