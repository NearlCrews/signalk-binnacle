import type { AlarmTone } from '$shared/audio';

export function isShallowAlarmActive(
  depthMeters: number | undefined,
  depthStale: boolean,
  limitMeters: number | undefined,
): boolean {
  return (
    depthMeters !== undefined &&
    !depthStale &&
    limitMeters !== undefined &&
    depthMeters < limitMeters
  );
}

// A three-beep burst pitched between the anchor drag (660 Hz) and the collision danger (880 Hz)
// alarms, so a half-asleep navigator can tell a shoaling depth from those two by ear. The app
// sounds it through a GatedAlarm while the depth is below the configured threshold.
export const SHALLOW_TONE: AlarmTone = {
  frequency: 750,
  beepMs: 160,
  gapMs: 100,
  beeps: 3,
  periodMs: 1400,
  volume: 0.18,
};

// The stand-down cue for a shallow watch that stops monitoring: a sparse low couplet between the
// arrival (520 Hz) and anchor (660 Hz) pitches, quieter and slower than the shallow alarm itself,
// so losing the watch is audible without sounding like water under the keel. The monitor chirps it
// briefly on the monitoring-to-paused edge through a courtesy channel, then goes silent.
export const SHALLOW_DEGRADE_TONE: AlarmTone = {
  frequency: 590,
  beepMs: 150,
  gapMs: 120,
  beeps: 2,
  periodMs: 2600,
  volume: 0.14,
};
