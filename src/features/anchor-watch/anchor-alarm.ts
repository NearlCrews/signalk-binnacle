import type { AlarmTone } from '$shared/audio';

export function shouldSoundAnchorAlarm(dragging: boolean, acknowledged: boolean): boolean {
  return dragging && !acknowledged;
}

// A three-beep burst, pitched between the urgent collision two-beep (880 Hz) and the calm arrival
// couplet (520 Hz), so a half-asleep navigator can tell which alarm woke them before reading a
// screen. The app sounds it through a GatedAlarm while a drag is active and not acknowledged.
export const ANCHOR_TONE: AlarmTone = {
  frequency: 660,
  beepMs: 150,
  gapMs: 100,
  beeps: 3,
  periodMs: 1600,
  volume: 0.18,
};
