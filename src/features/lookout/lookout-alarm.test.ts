import { describe, expect, it } from 'vitest';
import type { Severity } from '$entities/collision';
import { createFakeAlarmControl } from '$shared/testing';
import { LookoutAlarm } from './lookout-alarm';

describe('LookoutAlarm', () => {
  it('sounds for an active, unacknowledged, unmuted danger', () => {
    const { control, events } = createFakeAlarmControl();
    new LookoutAlarm(control).update('danger', false, false);
    expect(events).toEqual(['start']);
  });

  it('stays silent when acknowledged, muted, or not a danger', () => {
    const cases: Array<[Severity, boolean, boolean]> = [
      ['danger', true, false], // acknowledged
      ['danger', false, true], // muted
      ['warning', false, false], // warning is visual only
      ['clear', false, false],
    ];
    for (const [worst, suppressed, muted] of cases) {
      const { control, events } = createFakeAlarmControl();
      new LookoutAlarm(control).update(worst, suppressed, muted);
      expect(events).toEqual([]);
    }
  });

  it('silences a sounding alarm once it is acknowledged or muted', () => {
    const { control, events } = createFakeAlarmControl();
    const alarm = new LookoutAlarm(control);
    alarm.update('danger', false, false);
    alarm.update('danger', true, false);
    expect(events).toEqual(['start', 'stop']);
  });

  it('sounds despite mute or acknowledge when escalating past the inner ring', () => {
    // A muted danger and an acknowledged danger both stay silent normally, but the escalation
    // override forces the alarm so a close, imminent contact cannot be silenced.
    for (const [suppressed, muted] of [
      [false, true],
      [true, false],
      [true, true],
    ] as Array<[boolean, boolean]>) {
      const { control, events } = createFakeAlarmControl();
      new LookoutAlarm(control).update('danger', suppressed, muted, true);
      expect(events).toEqual(['start']);
    }
  });

  it('does not sound a non-danger even when escalating', () => {
    const { control, events } = createFakeAlarmControl();
    new LookoutAlarm(control).update('warning', false, false, true);
    expect(events).toEqual([]);
  });

  it('stays silent for a danger while at anchor (the busy-anchorage nuisance)', () => {
    const { control, events } = createFakeAlarmControl();
    new LookoutAlarm(control).update('danger', false, false, false, true);
    expect(events).toEqual([]);
  });

  it('still sounds at anchor when escalating past the inner ring', () => {
    const { control, events } = createFakeAlarmControl();
    new LookoutAlarm(control).update('danger', false, false, true, true);
    expect(events).toEqual(['start']);
  });

  it('stop() silences the alarm', () => {
    const { control, events } = createFakeAlarmControl();
    new LookoutAlarm(control).stop();
    expect(events).toEqual(['stop']);
  });
});
