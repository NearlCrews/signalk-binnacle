import { describe, expect, it } from 'vitest';
import { GatedAlarm } from '$shared/audio';
import { createFakeAlarmControl } from '$shared/testing';
import { ARRIVAL_TONE, shouldSoundArrivalAlarm } from './arrival-alarm';

describe('arrival alarm', () => {
  it('sounds on active arrival, then stops when muted, cleared, or navigation ends', () => {
    const { control, events, lastTone } = createFakeAlarmControl();
    const alarm = new GatedAlarm(ARRIVAL_TONE, control);
    const update = (arrived: boolean, courseActive: boolean, muted: boolean): void => {
      alarm.update(shouldSoundArrivalAlarm(arrived, courseActive, muted));
    };

    update(true, true, false);
    update(true, true, false);
    expect(events).toEqual(['start']);
    expect(lastTone()).toBe(ARRIVAL_TONE);

    update(true, true, true);
    update(false, true, false);
    update(true, false, false);
    expect(events).toEqual(['start', 'stop']);

    update(true, true, false);
    expect(events).toEqual(['start', 'stop', 'start']);
  });

  it('stops immediately when disposed and can sound after re-arming', () => {
    const { control, events } = createFakeAlarmControl();
    const alarm = new GatedAlarm(ARRIVAL_TONE, control);

    alarm.update(true);
    alarm.stop();
    alarm.update(true);

    expect(events).toEqual(['start', 'stop', 'start']);
  });
});
