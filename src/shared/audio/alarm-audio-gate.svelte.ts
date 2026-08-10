import { HeldFlag, type ReactiveClock } from '$shared/lib';
import { alarmAudioPrimed } from './alarm';

// The one explanation every panel shows beside a blocked gate, so the wording cannot drift
// between surfaces.
export const ALARM_AUDIO_BLOCKED_NOTE =
  'Alarm sound is off: the browser blocks audio until this display is tapped or a key is pressed. Any tap turns it on.';

// How long the shared context must stay unprimed before the gate reports blocked. A priming
// gesture resumes the context asynchronously, so an instant read would flash the warning during
// normal startup and on the very tap that opens the panel carrying it.
const UNPRIMED_GRACE_MS = 2_000;

// Alarm audio readiness as a reactive value. The shared AudioContext's state is plain browser
// state that nothing reactive tracks, so a surface warning that alarms cannot sound must re-check
// it as the clock ticks: after an unattended reload (a PWA update on a helm display) no gesture
// ever arrives to prime the context, every alarm is visual-only, and no event fires to say so.
// Seeded, so the grace counts from page load rather than from the first read.
export class AlarmAudioGate {
  #unprimed: HeldFlag;

  constructor(clock: ReactiveClock, primed: () => boolean = alarmAudioPrimed) {
    this.#unprimed = new HeldFlag(clock, UNPRIMED_GRACE_MS, () => !primed(), true);
  }

  // True once alarms have been unable to sound past the priming grace: every alarm is
  // visual-only until a tap or key press resumes the shared context.
  get blocked(): boolean {
    return this.#unprimed.held;
  }
}
