import { describe, expect, it } from 'vitest';
import { GatedAlarm } from '$shared/audio';
import { createFakeAlarmControl } from '$shared/testing';
import { ANCHOR_TONE, shouldSoundAnchorAlarm } from './anchor-alarm';

describe('anchor alarm', () => {
  it('sounds while dragging, then silences when acknowledged or cleared', () => {
    const { control, events, lastTone } = createFakeAlarmControl();
    const alarm = new GatedAlarm(ANCHOR_TONE, control);
    const update = (dragging: boolean, acknowledged: boolean): void => {
      alarm.update(shouldSoundAnchorAlarm(dragging, acknowledged, false, false));
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

  it('sounds a held fix-lost episode until its own acknowledge, independent of dragging', () => {
    expect(shouldSoundAnchorAlarm(false, false, true, false)).toBe(true);
    expect(shouldSoundAnchorAlarm(false, false, true, true)).toBe(false);
    expect(shouldSoundAnchorAlarm(false, false, false, false)).toBe(false);
    // A drag acknowledge does not silence the fix-lost episode, nor the other way around.
    expect(shouldSoundAnchorAlarm(true, true, true, false)).toBe(true);
    expect(shouldSoundAnchorAlarm(true, false, true, true)).toBe(true);
  });
});
