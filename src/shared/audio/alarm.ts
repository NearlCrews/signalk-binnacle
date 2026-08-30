// A repeating alarm tone, synthesized with the Web Audio API so nothing has to be bundled
// or fetched. Browsers block audio until a user gesture, so call primeAlarmAudio() from one once;
// every alarm shares that context, so after it every alarm can sound on its own when a danger
// arises.

export interface AlarmTone {
  // Beep pitch in Hz.
  frequency: number;
  // Length of each beep and the silence between beeps in a burst, in milliseconds.
  beepMs: number;
  gapMs: number;
  // Beeps per burst, and how often a burst repeats.
  beeps: number;
  periodMs: number;
  // Peak gain, 0..1.
  volume: number;
}

// An urgent two-beep burst every 1.2s: the collision danger alarm.
export const DANGER_TONE: AlarmTone = {
  frequency: 880,
  beepMs: 140,
  gapMs: 90,
  beeps: 2,
  periodMs: 1200,
  volume: 0.18,
};

// The bounds of the per-device master volume. The floor is deliberately above zero: turning the
// slider down must never become a silent boat-wide mute, because mutes are per-alarm decisions a
// navigator arms on purpose, not a slider someone left at the bottom last week.
export const MIN_ALARM_VOLUME = 0.2;
export const MAX_ALARM_VOLUME = 1;

// One multiplier over every tone's own peak gain, applied where the gain node is scheduled, so
// each display can be set to its cabin: quiet enough at the nav station, full over an engine.
let masterVolume = 1;

export function setAlarmVolume(fraction: number): void {
  if (!Number.isFinite(fraction)) return;
  masterVolume = Math.min(MAX_ALARM_VOLUME, Math.max(MIN_ALARM_VOLUME, fraction));
}

export function alarmVolume(): number {
  return masterVolume;
}

// The surface a consumer drives; the real Alarm implements it and tests can fake it. Gesture
// priming is not part of it: the app resumes the one shared context through primeAlarmAudio().
export interface AlarmControl {
  start(tone: AlarmTone): void;
  stop(): void;
}

// One context for the whole app. Browsers cap how many an origin may create, and a gesture primes
// the context it touched, so a per-instance context would leave later alarms suspended and silent
// after the single priming gesture has been spent.
let sharedCtx: AudioContext | undefined;
// The last construction attempt threw (an audio-device fault, a policy refusal). Cleared by a
// later successful construction, so a Retry after the device returns recovers.
let constructionFailed = false;

function sharedContext(): AudioContext | undefined {
  if (!sharedCtx && alarmAudioSupported()) {
    try {
      sharedCtx = new window.AudioContext();
      constructionFailed = false;
    } catch {
      constructionFailed = true;
    }
  }
  return sharedCtx;
}

// Whether this display has the Web Audio API at all. False is terminal: no retry can help, and
// audible alarms are unavailable here.
export function alarmAudioSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.AudioContext === 'function';
}

// Whether the most recent context construction attempt failed. Distinct from unsupported: a retry
// (which attempts construction again) can help.
export function alarmAudioConstructionFailed(): boolean {
  return constructionFailed;
}

function resumeContext(ctx: AudioContext): void {
  // resume() rejects if the context is closing or the gesture requirement is unmet; swallow it so
  // a failed resume never surfaces as an unhandled rejection. The next burst retries the resume.
  void ctx.resume().catch(() => undefined);
}

// Create and resume the shared alarm context. Must run from a user gesture (autoplay policy); a
// call outside one leaves the context suspended, which alarmAudioPrimed() then reports.
export function primeAlarmAudio(): void {
  // A closed context can never resume, and the browser or OS can close it out from under the
  // page (an audio-device reset among others). Without the replacement the Sound off chip would
  // stay up forever with an Enable tap that does nothing. Bursts read sharedContext() live, so
  // every alarm picks the replacement up.
  if (sharedCtx?.state === 'closed') sharedCtx = undefined;
  const ctx = sharedContext();
  if (ctx && ctx.state === 'suspended') resumeContext(ctx);
}

// Whether alarms can actually sound. Deliberately does not build a context: a caller asking
// whether the gesture took must not create the very thing it is asking about.
export function alarmAudioPrimed(): boolean {
  return sharedCtx?.state === 'running';
}

export class Alarm implements AlarmControl {
  #timer: ReturnType<typeof setInterval> | undefined;
  #tone: AlarmTone | undefined;
  #warnedNoAudio = false;
  // Oscillators scheduled but not yet finished, so stop() can cut a burst that is still sounding
  // rather than letting the rest of it play out after the danger has cleared.
  #active = new Set<OscillatorNode>();

  start(tone: AlarmTone): void {
    // Already sounding this tone: leave the running burst loop alone. Compare by the fields that
    // define the audible loop (pitch and period) rather than object identity, so a caller passing
    // a fresh tone object with the same values does not tear down and rebuild the loop each call.
    if (
      this.#timer !== undefined &&
      this.#tone?.frequency === tone.frequency &&
      this.#tone?.periodMs === tone.periodMs
    ) {
      return;
    }
    this.stop();
    const ctx = sharedContext();
    if (!ctx) {
      // No Web Audio: the audible alarm is unavailable. The visual strip and the assertive live
      // region still fire, so the watch is not silent, but a one-time breadcrumb makes a
      // tone-only failure diagnosable rather than a mystery.
      if (!this.#warnedNoAudio) {
        console.warn('Audible alarm unavailable: no Web Audio context; alerts remain visual only.');
        this.#warnedNoAudio = true;
      }
      return;
    }
    if (ctx.state === 'suspended') resumeContext(ctx);
    this.#tone = tone;
    this.#burst(ctx, tone);
    this.#timer = setInterval(() => this.#burst(ctx, tone), tone.periodMs);
  }

  stop(): void {
    if (this.#timer !== undefined) clearInterval(this.#timer);
    this.#timer = undefined;
    this.#tone = undefined;
    // Cut any beeps still scheduled in the current burst, so the alarm silences at once when the
    // danger clears instead of finishing the burst it was partway through.
    for (const osc of this.#active) {
      try {
        osc.stop();
      } catch {
        // Already stopped or never started; nothing to do.
      }
    }
    this.#active.clear();
  }

  #burst(ctx: AudioContext, tone: AlarmTone): void {
    if (ctx.state === 'suspended') resumeContext(ctx);
    // A suspended context freezes currentTime, so scheduling anyway would pile every tick's beeps
    // onto the same timestamp and fire them as one distorted blast the moment a gesture resumes it.
    // Skip the burst until the context runs; the interval keeps retrying the resume above.
    if (ctx.state !== 'running') return;
    const step = (tone.beepMs + tone.gapMs) / 1000;
    for (let i = 0; i < tone.beeps; i += 1) {
      this.#beep(ctx, tone, ctx.currentTime + i * step);
    }
  }

  #beep(ctx: AudioContext, tone: AlarmTone, start: number): void {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = tone.frequency;
    const duration = tone.beepMs / 1000;
    // The device master volume scales every tone at the one place gain is scheduled, so the test
    // tone and a real alarm can never disagree about loudness.
    const peak = tone.volume * masterVolume;
    // A short attack and release so the beep does not click.
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(peak, start + 0.012);
    gain.gain.setValueAtTime(peak, start + duration - 0.02);
    gain.gain.linearRampToValueAtTime(0, start + duration);
    osc.connect(gain).connect(ctx.destination);
    this.#active.add(osc);
    osc.onended = () => this.#active.delete(osc);
    osc.start(start);
    osc.stop(start + duration);
  }
}

// A rapid three-blip pattern faster than any alarm cadence, so a self-test is heard as a check,
// never mistaken for a live alarm on the ladder (MOB 950, danger 880, shallow 750, anchor 660,
// arrival 520, weather 440 Hz).
export const ALARM_TEST_TONE: AlarmTone = {
  frequency: 620,
  beepMs: 90,
  gapMs: 70,
  beeps: 3,
  periodMs: 1500,
  volume: 0.18,
};

const TEST_BURST_MS = ALARM_TEST_TONE.beeps * (ALARM_TEST_TONE.beepMs + ALARM_TEST_TONE.gapMs);

const testAlarm = new Alarm();
let testTimer: ReturnType<typeof setTimeout> | undefined;

// One short bounded burst through the exact output path a real alarm takes (the shared context,
// the gain schedule, the master volume), so hearing it proves an alarm would be heard: the
// pre-sleep check. Called from the Test button's tap, a gesture, so priming here makes the first
// test press both enable audio and prove it in one go. Safe to call repeatedly: each call cuts any
// burst still sounding and re-articulates.
export function playTestTone(): void {
  primeAlarmAudio();
  testAlarm.stop();
  testAlarm.start(ALARM_TEST_TONE);
  clearTimeout(testTimer);
  testTimer = setTimeout(() => testAlarm.stop(), TEST_BURST_MS);
}
