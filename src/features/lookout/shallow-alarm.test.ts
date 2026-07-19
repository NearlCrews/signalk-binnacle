import { describe, expect, it } from 'vitest';
import { GatedAlarm } from '$shared/audio';
import { createFakeAlarmControl } from '$shared/testing';
import { isShallowAlarmActive, SHALLOW_TONE } from './shallow-alarm';

describe('shallow-water alarm', () => {
  it('sounds below the threshold, then stops for stale, cleared, or safe depth data', () => {
    const { control, events, lastTone } = createFakeAlarmControl();
    const alarm = new GatedAlarm(SHALLOW_TONE, control);
    const update = (
      depthMeters: number | undefined,
      depthStale: boolean,
      limitMeters: number | undefined,
    ): void => {
      alarm.update(isShallowAlarmActive(depthMeters, depthStale, limitMeters));
    };

    update(2.9, false, 3);
    update(2.8, false, 3);
    expect(events).toEqual(['start']);
    expect(lastTone()).toBe(SHALLOW_TONE);

    update(2.8, true, 3);
    update(undefined, false, 3);
    update(4, false, 3);
    expect(events).toEqual(['start', 'stop']);

    update(2.5, false, 3);
    update(2.5, false, undefined);
    expect(events).toEqual(['start', 'stop', 'start', 'stop']);
  });

  it('stops immediately when disposed', () => {
    const { control, events } = createFakeAlarmControl();
    const alarm = new GatedAlarm(SHALLOW_TONE, control);

    alarm.update(true);
    alarm.stop();

    expect(events).toEqual(['start', 'stop']);
  });
});
