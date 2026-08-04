import type { ActiveNotification } from '$entities/notifications';

const NOTIFICATIONS_PATH_PREFIX = /^notifications\./;

// What to call this alert on screen. A producer that raised one without a message still has to be
// identifiable, so the path tail stands in for it. Shared so the panel and the strip can never name
// the same alert differently.
export const notificationLabel = (n: ActiveNotification): string =>
  n.message || n.path.replace(NOTIFICATIONS_PATH_PREFIX, '');

// The grades that raise a surface: the alarm strip renders these two and nothing else, and the
// assertive live region announces the same two, so a low-grade "warn" cannot interrupt a screen
// reader for an alert that produces neither sound nor strip.
export const isRaisedNotification = (n: ActiveNotification): boolean =>
  n.state === 'alarm' || n.state === 'emergency';

// The alert a surface speaks for: worst first by grade, never by list order, so neither the strip
// nor the announcement can be captured by whichever alert the caller sorted to the front. Takes a
// raw or an already-filtered list, since both callers hold one or the other.
export const worstRaisedNotification = (
  list: readonly ActiveNotification[],
): ActiveNotification | undefined =>
  list.find((n) => n.state === 'emergency') ?? list.find(isRaisedNotification);

// Helm voice for a raised grade, so a surface never shows or speaks the raw Signal K enum.
export const notificationGrade = (n: ActiveNotification): 'Alarm' | 'Emergency' =>
  n.state === 'emergency' ? 'Emergency' : 'Alarm';

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
