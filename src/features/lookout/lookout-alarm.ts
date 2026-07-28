import type { Severity } from '$entities/collision';
import { type AlarmControl, DANGER_TONE, GatedAlarm } from '$shared/audio';

// Drives the audible alarm from the collision assessment. The alarm sounds only for an
// active danger that has not been acknowledged or muted; a warning is visual only.
export class LookoutAlarm {
  #alarm: GatedAlarm;

  constructor(alarm?: AlarmControl) {
    this.#alarm = new GatedAlarm(DANGER_TONE, alarm);
  }

  // Resume the audio context from a user gesture (browser autoplay policy).
  // Sound the alarm for an active danger that is neither acknowledged nor muted. `escalate` is the
  // hard-inner-ring override: a genuinely close, imminent contact sounds regardless of mute,
  // acknowledge, or anchor, so a wide threshold setting or a stale mute can never silence a real
  // emergency. `anchored` silences the audible alarm at anchor (the busy-anchorage nuisance) while
  // the danger strip stays visible; the escalation override still sounds for an imminent contact.
  update(
    worst: Severity,
    suppressed: boolean,
    muted: boolean,
    escalate = false,
    anchored = false,
  ): void {
    this.#alarm.update(worst === 'danger' && (escalate || (!suppressed && !muted && !anchored)));
  }

  // Silence the alarm outright (e.g. on teardown).
  stop(): void {
    this.#alarm.stop();
  }
}
