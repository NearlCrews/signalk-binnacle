import { describe, expect, it } from 'vitest';
import { GatedAlarm } from '$shared/audio';
import { createFakeAlarmControl } from '$shared/testing';
import { ANCHOR_TONE, shouldSoundAnchorAlarm } from './anchor-alarm';

describe('anchor alarm', () => {
  it('sounds while dragging, then silences when acknowledged or cleared', () => {
    const { control, events, lastTone } = createFakeAlarmControl();
    const alarm = new GatedAlarm(ANCHOR_TONE, control);
    const update = (dragging: boolean, acknowledged: boolean): void => {
      alarm.update(shouldSoundAnchorAlarm(dragging, acknowledged));
    };

    update(true, false);
    update(true, false);
    expect(events).toEqual(['start']);
    expect(lastTone()).toBe(ANCHOR_TONE);

    update(true, true);
    update(false, true);
    expect(events).toEqual(['start', 'stop']);

    update(true, false);
    expect(events).toEqual(['start', 'stop', 'start']);
  });

  it('stops immediately when disposed and can be re-armed', () => {
    const { control, events } = createFakeAlarmControl();
    const alarm = new GatedAlarm(ANCHOR_TONE, control);

    alarm.update(true);
    alarm.stop();
    alarm.update(true);

    expect(events).toEqual(['start', 'stop', 'start']);
  });
});
