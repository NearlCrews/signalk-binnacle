import type { AlarmTone } from '$shared/audio';

export function shouldSoundMobAlarm(active: boolean, acknowledged: boolean): boolean {
  return active && !acknowledged;
}

// The most urgent tone in the app: a fast four-beep burst pitched above the collision two-beep,
// repeating with almost no gap, so it reads as the emergency it is. The app sounds it through a
// GatedAlarm while an MOB is active and not acknowledged.
export const MOB_TONE: AlarmTone = {
  frequency: 950,
  beepMs: 120,
  gapMs: 80,
  beeps: 4,
  periodMs: 1100,
  volume: 0.2,
};
