import { HeldFlag, type ReactiveClock } from '$shared/lib';
import { alarmAudioConstructionFailed, alarmAudioPrimed, alarmAudioSupported } from './alarm';

// The one explanation every panel shows beside a blocked gate, so the wording cannot drift
// between surfaces.
export const ALARM_AUDIO_BLOCKED_NOTE =
  'Alarm sound is off: the browser blocks audio until this display is tapped or a key is pressed. Any tap turns it on.';

// The one explanation for a failed audio device, shared for the same reason: retrying construction
// is the same thing priming does, so the fix a navigator can act on is identical.
export const ALARM_AUDIO_FAILED_NOTE =
  'Alarm sound failed to start on this display. Any tap tries again, which can recover once the audio device is back.';

// Terminal: no Web Audio here at all, so there is no action to offer, only the fact.
export const ALARM_AUDIO_UNSUPPORTED_NOTE =
  'Audible alarms are unavailable on this display. Alerts remain visual only.';

// The honest capability grades. 'blocked' means any gesture will help; 'failed' means the last
// context construction threw and a later gesture may help once the audio device returns;
// 'unsupported' is terminal: audible alarms are unavailable on this display.
export type AlarmAudioState = 'ready' | 'blocked' | 'failed' | 'unsupported';

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
  #supported: () => boolean;
  #failed: () => boolean;

  constructor(
    clock: ReactiveClock,
    primed: () => boolean = alarmAudioPrimed,
    supported: () => boolean = alarmAudioSupported,
    failed: () => boolean = alarmAudioConstructionFailed,
  ) {
    this.#unprimed = new HeldFlag(clock, UNPRIMED_GRACE_MS, () => !primed(), true);
    this.#supported = supported;
    this.#failed = failed;
  }

  get state(): AlarmAudioState {
    // Reading the held flag first keeps this reactive on the clock, so a later construction
    // failure or device recovery is re-read as the clock ticks.
    const unprimedHeld = this.#unprimed.held;
    if (!this.#supported()) return 'unsupported';
    if (this.#failed()) return 'failed';
    return unprimedHeld ? 'blocked' : 'ready';
  }

  // True once alarms have been unable to sound past the priming grace and a gesture would help:
  // every alarm is visual-only until a tap or key press resumes the shared context. The terminal
  // grades are deliberately excluded, so a tap-to-enable note never shows where no tap can help.
  get blocked(): boolean {
    return this.state === 'blocked';
  }
}

/**
 * The explanation an alarm surface renders for a degraded audio grade, or undefined when audio is
 * ready. Every surface that can sound (the Alarms and Anchor panels, and Help) reads this one
 * mapping, so a navigator meets the same words wherever they notice the alarm is silent.
 */
export function alarmAudioNote(state: AlarmAudioState): string | undefined {
  if (state === 'blocked') return ALARM_AUDIO_BLOCKED_NOTE;
  if (state === 'failed') return ALARM_AUDIO_FAILED_NOTE;
  if (state === 'unsupported') return ALARM_AUDIO_UNSUPPORTED_NOTE;
  return undefined;
}
