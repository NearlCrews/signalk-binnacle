import type { AlarmTone } from '$shared/audio';

export function shouldSoundArrivalAlarm(
  arrived: boolean,
  courseActive: boolean,
  muted: boolean,
): boolean {
  return arrived && courseActive && !muted;
}

// A single short rising couplet, distinct from the urgent collision two-beep, so arrival is not
// confused with danger. Lower, sparser, and quieter. The app sounds it through a GatedAlarm while
// the boat is inside the active arrival circle and the arrival alarm is not muted.
export const ARRIVAL_TONE: AlarmTone = {
  frequency: 520,
  beepMs: 180,
  gapMs: 120,
  beeps: 2,
  periodMs: 2500,
  volume: 0.14,
};
