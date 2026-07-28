import type { ActiveNotification } from '$entities/notifications';
import { type AlarmControl, type AlarmTone, GatedAlarm } from '$shared/audio';
import { SK_PATHS } from '$shared/signalk';
import { NOTIFICATION_PATH } from './collision-notification';

// A two-beep burst every 1.7 s, pitched below every alarm Binnacle computes itself (520 arrival,
// 660 anchor drag, 750 shallow, 880 collision danger, 950 man overboard) and paced slower than any
// of them: this is the boat's own equipment calling, not a hazard Binnacle is tracking, so it must
// be identifiable by ear without competing with the navigation alarms.
export const GENERIC_ALARM_TONE: AlarmTone = {
  frequency: 590,
  beepMs: 180,
  gapMs: 120,
  beeps: 2,
  periodMs: 1700,
  volume: 0.18,
};

// Path equality or a real child, never a bare prefix: notifications.mobility must not read as part
// of the notifications.mob subtree. Matches how the MOB store itself claims its paths.
const inSubtree = (path: string, base: string): boolean =>
  path === base || path.startsWith(`${base}.`);

// Whether this alert should make a sound. An alarm or emergency grade is the audible bar: warn and
// alert stay visual even with an explicit 'sound' method, deliberately, so the audible channel is
// reserved for the grades a watchkeeper must act on and lower grades cannot train the ear to tune
// the tone out. Within the bar, a producer that named no method gets the safe default: an unheard
// alarm is the failure mode that matters, so only an explicit method list without 'sound' stays
// visual. A server-side silence stops the sound while the alert stays listed.
export function isAudibleAlarmNotification(n: ActiveNotification): boolean {
  if (n.state !== 'alarm' && n.state !== 'emergency') return false;
  if (n.silenced) return false;
  return n.method === undefined || n.method.includes('sound');
}

// The alerts the generic surface owns: everything raised except the ones another surface already
// renders and sounds. Acknowledged alerts drop out entirely, since acknowledging is how an alert is
// cleared from this app's view. The anchor exclusion is deliberately an exact match while MOB is a
// subtree: it mirrors how the anchor entity itself claims its path, and a child id the server files
// under it errs safe by sounding here rather than being dropped. It also holds only while the
// anchor entity is actually consuming that notification (server mode): a foreign producer raising
// the anchor path on a boat whose watch is off or client-side must sound here, not vanish.
// ownedDepthPath is the ONE depth notification path the shallow monitor is sounding at this moment;
// every other depth notification, a plugin detector or zones on a path that did not win, stays
// generic so a grounding alarm can never go silent.
interface GenericAlarmExclusions {
  ownedDepthPath?: string;
  // Whether the anchor entity currently sounds the anchor notification itself. Defaults to true,
  // the shipped anchor-plugin arrangement.
  anchorCovered?: boolean;
}

export function selectGenericAlarms(
  list: readonly ActiveNotification[],
  exclusions: GenericAlarmExclusions = {},
): ActiveNotification[] {
  const { ownedDepthPath, anchorCovered = true } = exclusions;
  return list.filter(
    (n) =>
      !n.acknowledged &&
      !inSubtree(n.path, SK_PATHS.mobNotification) &&
      (!anchorCovered || n.path !== SK_PATHS.anchorNotification) &&
      n.path !== NOTIFICATION_PATH &&
      (ownedDepthPath === undefined || n.path !== ownedDepthPath),
  );
}

// Sounds the tone while any inbound Signal K alarm is audible, and re-articulates it when another
// one raises so a second alarm during a running burst loop is not absorbed by the first.
//
// Reactive because the alarm strip renders `sounding` and `locallyMuted` directly: the controller
// drives update() from an effect, and a plain field would leave those reads untracked, so a mute
// tapped on the strip would not visibly take.
export class GenericAlarm {
  #alarm: GatedAlarm;
  #sounding = $state(false);
  #locallyMuted = $state(false);
  // The last list handed to update(), so muting can re-evaluate against it without waiting for the
  // next delta: a mute must silence the boat the moment it is tapped.
  #last: readonly ActiveNotification[] = [];
  // Path to the activation it last sounded at, the key that decides re-articulation. An activation
  // only advances on a quiet-to-sounding transition, so a value greater than what a path last
  // sounded at means a genuinely new raise, and a path leaving the set can never trigger one.
  #soundedAt = new Map<string, number>();
  // Path to the activation muted on this device, the man-overboard idiom: keying the mute to the
  // exact raise means it expires the moment the alert re-raises, so a device-local mute can never
  // swallow a future alarm.
  #mutedAt = new Map<string, number>();

  constructor(alarm?: AlarmControl) {
    this.#alarm = new GatedAlarm(GENERIC_ALARM_TONE, alarm);
  }

  update(notifications: readonly ActiveNotification[]): void {
    this.#last = notifications;
    const audible = notifications.filter(isAudibleAlarmNotification);
    this.#pruneMutes(audible);
    const unmuted = audible.filter((n) => this.#mutedAt.get(n.path) !== n.activation);
    const rearticulate = unmuted.some((n) => n.activation > (this.#soundedAt.get(n.path) ?? 0));
    this.#soundedAt.clear();
    for (const n of unmuted) this.#soundedAt.set(n.path, n.activation);
    // Ordered before update() and silent while quiet, so a rising edge starts the tone exactly once.
    if (rearticulate) this.#alarm.restart();
    this.#alarm.update(unmuted.length > 0);
    this.#sounding = unmuted.length > 0;
    this.#locallyMuted = audible.some((n) => this.#mutedAt.get(n.path) === n.activation);
  }

  // Silence the alarms sounding right now on this device only, leaving the alerts listed and other
  // stations sounding. The escape hatch for a chatty producer when the server cannot silence.
  muteActiveHere(): void {
    for (const n of this.#last) {
      if (isAudibleAlarmNotification(n)) this.#mutedAt.set(n.path, n.activation);
    }
    this.update(this.#last);
  }

  // Silence outright (teardown). The next update starts the tone again if an alarm is still up.
  stop(): void {
    this.#alarm.stop();
    this.#sounding = false;
    this.#soundedAt.clear();
  }

  get sounding(): boolean {
    return this.#sounding;
  }

  get locallyMuted(): boolean {
    return this.#locallyMuted;
  }

  // Drop mutes whose alert is no longer raised, so the record tracks only live alerts.
  #pruneMutes(audible: readonly ActiveNotification[]): void {
    if (this.#mutedAt.size === 0) return;
    const live = new Set(audible.map((n) => n.path));
    for (const path of this.#mutedAt.keys()) {
      if (!live.has(path)) this.#mutedAt.delete(path);
    }
  }
}
