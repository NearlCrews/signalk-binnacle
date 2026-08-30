import type { ActiveNotification } from '$entities/notifications';
import { type AlarmControl, GatedAlarm } from '$shared/audio';
import { clampInt, HeldFlag, type ReactiveClock } from '$shared/lib';
import { steerSide } from '$shared/nav';
import type { PersistedValue } from '$shared/settings';
import {
  isServerXteAlarm,
  isXteBreach,
  XTE_LIMIT_MAX_METERS,
  XTE_LIMIT_MIN_METERS,
  XTE_TONE,
} from './xte-alarm';

// How long the cross-track error must stay past the limit before the alarm sounds: GPS scatter
// and a helm correction already in progress produce momentary excursions that must never wake the
// off watch.
export const XTE_HOLD_MS = 15_000;

// Quiet window after a course activation or an active-leg change. A leg switch pegs the
// cross-track readout against the new leg (the boat stands at the old waypoint, not on the new
// track), and that instant is the crew's own deliberate action, not a drift worth sounding over.
// The hold window still applies afterward, so a real off-track condition sounds one grace plus
// one hold after the switch.
export const XTE_LEG_GRACE_MS = 20_000;

// Which authority owns the audible channel for the cross-track concern right now. 'server' means
// a plugin-raised cross-track alarm is live and already sounds, lists, and announces through the
// generic alarm surface, so this monitor's tone stands down; 'client' means this monitor's own
// judgment is the only alarm there is.
export type XteAlarmStanding = 'server' | 'client';

interface XteMonitorDeps {
  // Getters per house style: each changes over the session, and capturing a value at construction
  // would freeze the monitor on the state the app started with.
  courseActive: () => boolean;
  // Signed cross-track error in meters, starboard-positive like
  // CourseGuidance.crossTrackErrorMeters; an absolute value also works and only loses the
  // steer-side hint in the announcement.
  xteMeters: () => number | undefined;
  // No value fresh enough to alarm on. CourseGuidance already folds the provider TTL and fix
  // staleness into an undefined reading; this hook carries any stricter signal the integrator has.
  xteStale: () => boolean;
  // Identity of the active leg (route href plus point index, or the destination position). Any
  // change re-arms the leg-switch grace.
  legKey: () => string | undefined;
  limit: PersistedValue<number>;
  muted: PersistedValue<boolean>;
  notifications: () => readonly ActiveNotification[];
  clock: ReactiveClock;
  alarm?: AlarmControl;
}

// Distinguishes "no leg observed yet" from a leg whose key is legitimately undefined, so the
// grace arms on the first observation after an activation either way.
const NO_LEG = Symbol('no-leg');

// Owns the off-course alarm: the client threshold judgment with its hold and leg-switch grace,
// the stand-down when a server-raised cross-track alarm already covers the concern, the tone, and
// the live-region text. The cross-track value itself stays in CourseGuidance, so this and the nav
// strip's readout can never disagree about what the error is.
export function createXteMonitor(deps: XteMonitorDeps) {
  const alarm = new GatedAlarm(XTE_TONE, deps.alarm);

  // The stored limit is codec-bounded, but the read clamps anyway so an out-of-band value can
  // never widen the alarm past its documented range.
  const limitMeters = $derived(
    clampInt(deps.limit.value, XTE_LIMIT_MIN_METERS, XTE_LIMIT_MAX_METERS),
  );

  // Grace bookkeeping is plain, not $state: the derived writes it to remember the leg it observed
  // (the HeldFlag memo pattern). An inactive course clears the memo, so the next activation
  // re-arms the grace whatever the leg key is.
  let observedLeg: string | undefined | typeof NO_LEG = NO_LEG;
  let graceUntil = 0;
  const inLegGrace = $derived.by(() => {
    if (!deps.courseActive()) {
      observedLeg = NO_LEG;
      return false;
    }
    const key = deps.legKey();
    if (key !== observedLeg) {
      observedLeg = key;
      graceUntil = deps.clock.now + XTE_LEG_GRACE_MS;
    }
    return deps.clock.now < graceUntil;
  });

  // The course gate stands on its own even though the grace also reads it: the grace reports
  // "not in grace" for an inactive course, so without this a breach-shaped stale readout could
  // alarm with no course at all. Grace before breach: evaluating it on every active visit keeps
  // its leg memo current while the boat is still on track, so a leg change is observed when it
  // happens rather than backdated to the first breach.
  const eligible = $derived.by(
    () =>
      deps.courseActive() &&
      !inLegGrace &&
      isXteBreach(deps.xteMeters(), deps.xteStale(), limitMeters),
  );
  const held = new HeldFlag(deps.clock, XTE_HOLD_MS, () => eligible);
  const alarming = $derived(held.held);

  // A warn or alert grade does not stand the client down: the generic surface keeps those grades
  // visual, and this monitor sounding its own judgment then errs toward being heard.
  const standing = $derived<XteAlarmStanding>(
    deps.notifications().some(isServerXteAlarm) ? 'server' : 'client',
  );

  const sounding = $derived(alarming && standing === 'client' && !deps.muted.value);

  // Follows the tone, not the raw judgment: the announcement channel is audible delivery, so a
  // mute quiets it and a server-owned alarm leaves the announcing to the generic surface's own
  // message. The strip's visual treatment reads `alarming` and stays up either way. Meters, not
  // the strip's nautical miles: the limit is set in meters, and the sentence must name the same
  // unit the crew configured.
  const alert = $derived.by(() => {
    if (!sounding) return '';
    const xte = deps.xteMeters();
    if (xte === undefined) return '';
    const side = steerSide(xte);
    const steer =
      side === null ? '' : side === 'port' ? ' Steer left to return.' : ' Steer right to return.';
    return `Off course: ${Math.round(Math.abs(xte))} m from the leg, past the ${limitMeters} m limit.${steer}`;
  });

  $effect(() => {
    alarm.update(sounding);
  });

  return {
    // Silence the tone outright (teardown). Priming stays with the shared primeAlarmAudio gesture.
    stop: () => alarm.stop(),
    get alarming() {
      return alarming;
    },
    get standing() {
      return standing;
    },
    get sounding() {
      return sounding;
    },
    get alert() {
      return alert;
    },
    get limitMeters() {
      return limitMeters;
    },
    setLimitMeters(meters: number): void {
      // A NaN would sail through clampInt and make the codec-backed set throw; a silent drop is
      // the right answer to a garbage input from a form field.
      if (!Number.isFinite(meters)) return;
      deps.limit.set(clampInt(meters, XTE_LIMIT_MIN_METERS, XTE_LIMIT_MAX_METERS));
    },
    get muted() {
      return deps.muted.value;
    },
    setMuted(value: boolean): void {
      deps.muted.set(value);
    },
  };
}

export type XteMonitor = ReturnType<typeof createXteMonitor>;
