import { Alarm, type AlarmControl, type AlarmTone } from './alarm';

// A tone that sounds while a condition holds. Every feature alarm (collision, arrival, anchor
// drag, man overboard) is this same shape: the per-feature policy (what counts as "should sound")
// stays at the call site, and this owns the start/stop edge and the autoplay prime. Edge-triggered
// on purpose: start fires once on the rising edge and stop once on the falling edge, so a fake in
// tests sees the transitions, not a call per reactive tick.
export class GatedAlarm {
  #alarm: AlarmControl;
  #tone: AlarmTone;
  #sounding = false;

  constructor(tone: AlarmTone, alarm: AlarmControl = new Alarm()) {
    this.#tone = tone;
    this.#alarm = alarm;
  }

  // Edge-triggered: only a change starts or stops the tone, so a condition re-evaluated every frame
  // does not restart the burst loop. Priming the audio context is primeAlarmAudio's job, not this.
  update(shouldSound: boolean): void {
    if (shouldSound === this.#sounding) return;
    this.#sounding = shouldSound;
    if (shouldSound) this.#alarm.start(this.#tone);
    else this.#alarm.stop();
  }

  // Re-articulate an already sounding tone: a second alarm raised while the first is running must
  // be heard, and the running burst loop would otherwise absorb it (Alarm.start leaves a loop of
  // the same tone alone). Silent when quiet, so this can never be the thing that starts a sound.
  restart(): void {
    if (!this.#sounding) return;
    this.#alarm.stop();
    this.#alarm.start(this.#tone);
  }

  // Silence outright (teardown), regardless of the last condition.
  stop(): void {
    this.#sounding = false;
    this.#alarm.stop();
  }
}
