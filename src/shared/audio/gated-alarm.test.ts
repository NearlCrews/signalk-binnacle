import { describe, expect, it } from 'vitest';
import { createFakeAlarmControl } from '$shared/testing';
import type { AlarmTone } from './alarm';
import { GatedAlarm } from './gated-alarm';

const TONE: AlarmTone = {
  frequency: 700,
  beepMs: 100,
  gapMs: 100,
  beeps: 2,
  periodMs: 1000,
  volume: 0.1,
};

describe('GatedAlarm', () => {
  it('starts its tone on the rising edge and stops on the falling edge', () => {
    const { control, events, lastTone } = createFakeAlarmControl();
    const alarm = new GatedAlarm(TONE, control);
    alarm.update(true);
    expect(events).toEqual(['start']);
    expect(lastTone()).toBe(TONE);
    alarm.update(false);
    expect(events).toEqual(['start', 'stop']);
  });

  it('does not repeat start or stop while the condition holds', () => {
    const { control, events } = createFakeAlarmControl();
    const alarm = new GatedAlarm(TONE, control);
    alarm.update(false);
    expect(events).toEqual([]);
    alarm.update(true);
    alarm.update(true);
    expect(events).toEqual(['start']);
    alarm.update(false);
    alarm.update(false);
    expect(events).toEqual(['start', 'stop']);
  });

  it('stop() silences outright and re-arms the edge', () => {
    const { control, events } = createFakeAlarmControl();
    const alarm = new GatedAlarm(TONE, control);
    alarm.update(true);
    alarm.stop();
    expect(events).toEqual(['start', 'stop']);
    alarm.update(true);
    expect(events).toEqual(['start', 'stop', 'start']);
  });

  it('restart() re-articulates the tone while sounding', () => {
    const { control, events, lastTone } = createFakeAlarmControl();
    const alarm = new GatedAlarm(TONE, control);
    alarm.update(true);
    alarm.restart();
    expect(events).toEqual(['start', 'stop', 'start']);
    expect(lastTone()).toBe(TONE);
    // The gate stays closed, so the next true is still not a rising edge.
    alarm.update(true);
    expect(events).toEqual(['start', 'stop', 'start']);
    alarm.update(false);
    expect(events).toEqual(['start', 'stop', 'start', 'stop']);
  });

  it('restart() is a no-op while quiet', () => {
    const { control, events } = createFakeAlarmControl();
    const alarm = new GatedAlarm(TONE, control);
    alarm.restart();
    expect(events).toEqual([]);
    alarm.update(true);
    alarm.stop();
    alarm.restart();
    expect(events).toEqual(['start', 'stop']);
  });
});
