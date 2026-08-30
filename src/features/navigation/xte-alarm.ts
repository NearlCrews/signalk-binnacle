import type { ActiveNotification } from '$entities/notifications';
import type { AlarmTone } from '$shared/audio';
import { NOTIFICATIONS_PREFIX } from '$shared/signalk';

// Half a typical 185 m arrival circle: far enough that GPS scatter and normal helming never touch
// it, close enough that a shorthanded crew hears about a drift long before the leg is lost.
export const DEFAULT_XTE_LIMIT_METERS = 90;
export const XTE_LIMIT_MIN_METERS = 20;
export const XTE_LIMIT_MAX_METERS = 2000;

export function isXteBreach(
  xteMeters: number | undefined,
  xteStale: boolean,
  limitMeters: number,
): boolean {
  return xteMeters !== undefined && !xteStale && Math.abs(xteMeters) > limitMeters;
}

const XTE_PATH_PREFIX = `${NOTIFICATIONS_PREFIX}navigation.`;

// Whether a server-raised notification claims the cross-track concern at alarm grade. The shipped
// course-provider raises only the arrival and perpendicular notifications, so a cross-track alarm
// arrives from meta.zones on one of the cross-track paths (navigation.course.calcValues,
// navigation.courseGreatCircle, navigation.courseRhumbline) or from a dedicated plugin; matching
// any navigation-subtree path whose segments name cross-track error covers all of those without
// spelling each producer's path. Silenced and acknowledged alarms still count: both are deliberate
// crew decisions about exactly this concern, and the client re-sounding over them would undo the
// quiet they chose.
export function isServerXteAlarm(n: ActiveNotification): boolean {
  if (n.state !== 'alarm' && n.state !== 'emergency') return false;
  if (!n.path.startsWith(XTE_PATH_PREFIX)) return false;
  return n.path
    .slice(XTE_PATH_PREFIX.length)
    .toLowerCase()
    .split('.')
    .some((segment) => segment.includes('crosstrack') || segment === 'xte');
}

// A single long tone repeated every few seconds, the steady off-course cadence dedicated
// autopilot heads use, so it reads as "steering problem" by ear and cannot be confused with any
// of the multi-beep burst alarms. The pitch sits between the generic equipment alarm (590 Hz) and
// the anchor drag (660 Hz); the pattern, not the pitch, is what separates it.
export const XTE_TONE: AlarmTone = {
  frequency: 620,
  beepMs: 500,
  gapMs: 0,
  beeps: 1,
  periodMs: 2600,
  volume: 0.16,
};
