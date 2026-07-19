import { describe, expect, it } from 'vitest';
import { GatedAlarm } from '$shared/audio';
import { createFakeAlarmControl } from '$shared/testing';
import { MOB_TONE, shouldSoundMobAlarm } from './mob-alarm';

describe('MOB alarm', () => {
  it('sounds for an active unacknowledged MOB and stops when acknowledged or canceled', () => {
    const { control, events, lastTone } = createFakeAlarmControl();
    const alarm = new GatedAlarm(MOB_TONE, control);
    const update = (active: boolean, acknowledged: boolean): void => {
      alarm.update(shouldSoundMobAlarm(active, acknowledged));
    };

    update(true, false);
    update(true, false);
    expect(events).toEqual(['start']);
    expect(lastTone()).toBe(MOB_TONE);

    update(true, true);
    update(false, false);
    expect(events).toEqual(['start', 'stop']);

    update(true, false);
    expect(events).toEqual(['start', 'stop', 'start']);
  });

  it('stops immediately when disposed even after repeated active updates', () => {
    const { control, events } = createFakeAlarmControl();
    const alarm = new GatedAlarm(MOB_TONE, control);

    alarm.update(true);
    alarm.update(true);
    alarm.stop();

    expect(events).toEqual(['start', 'stop']);
  });
});
