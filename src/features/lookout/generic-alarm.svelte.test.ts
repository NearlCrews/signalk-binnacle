import { describe, expect, it } from 'vitest';
import type { ActiveNotification } from '$entities/notifications';
import { SK_PATHS } from '$shared/signalk';
import { createFakeAlarmControl } from '$shared/testing';
import { NOTIFICATION_PATH } from './collision-notification';
import {
  GENERIC_ALARM_TONE,
  GenericAlarm,
  isAudibleAlarmNotification,
  selectGenericAlarms,
} from './generic-alarm.svelte';

function raised(overrides: Partial<ActiveNotification> = {}): ActiveNotification {
  return {
    path: 'notifications.environment.fire',
    state: 'alarm',
    message: 'Smoke detected',
    activation: 1,
    ...overrides,
  };
}

const at = (path: string, activation: number): ActiveNotification => raised({ path, activation });

describe('GENERIC_ALARM_TONE', () => {
  it('carries a pitch and cadence of its own', () => {
    // The other alarms hold 520 (arrival), 660 (anchor drag), 750 (shallow), 880 (collision
    // danger), and 950 (man overboard) Hz, so the boat's own alarms are identifiable by ear.
    expect(GENERIC_ALARM_TONE.frequency).toBe(590);
    expect(GENERIC_ALARM_TONE.periodMs).toBe(1700);
  });
});

describe('isAudibleAlarmNotification', () => {
  it('grades every state, method, and silence combination', () => {
    const cases: Array<[string, Partial<ActiveNotification>, boolean]> = [
      ['an alarm with no method field defaults to audible', { method: undefined }, true],
      ['an emergency with no method field is audible', { state: 'emergency' }, true],
      ['an explicit sound request is audible', { method: ['sound'] }, true],
      ['visual and sound together is audible', { method: ['visual', 'sound'] }, true],
      ['an explicit visual-only request stays visual', { method: ['visual'] }, false],
      ['an explicitly empty method stays visual', { method: [] }, false],
      ['a warning is not an alarm grade', { state: 'warn' }, false],
      ['an alert is not an alarm grade', { state: 'alert' }, false],
      ['a silenced alarm is quiet', { silenced: true }, false],
      ['silence beats an explicit sound request', { silenced: true, method: ['sound'] }, false],
    ];
    for (const [name, overrides, expected] of cases) {
      expect(isAudibleAlarmNotification(raised(overrides)), name).toBe(expected);
    }
  });
});

describe('selectGenericAlarms', () => {
  it('drops the alerts another surface already owns', () => {
    const list = [
      raised({ path: 'notifications.environment.fire' }),
      raised({ path: 'notifications.electrical.batteries.house', acknowledged: true }),
      raised({ path: SK_PATHS.mobNotification }),
      raised({ path: `${SK_PATHS.mobNotification}.7f3c-uuid` }),
      raised({ path: SK_PATHS.anchorNotification }),
      raised({ path: NOTIFICATION_PATH }),
      raised({ path: 'notifications.environment.depth.belowTransducer' }),
      raised({ path: 'notifications.environment.depth.belowKeel' }),
    ];
    expect(selectGenericAlarms(list).map((n) => n.path)).toEqual([
      'notifications.environment.fire',
    ]);
  });

  it('keeps a path that merely reads like an owned one', () => {
    // Prefix matching without the separator would swallow an unrelated producer's alerts.
    const list = [
      raised({ path: 'notifications.mobility.lift' }),
      raised({ path: 'notifications.environment.depthSounder' }),
      raised({ path: `${SK_PATHS.anchorNotification}.chain` }),
    ];
    expect(selectGenericAlarms(list)).toHaveLength(3);
  });
});

describe('GenericAlarm', () => {
  it('sounds when an audible alarm arrives and stops when the last one clears', () => {
    const { control, events, lastTone } = createFakeAlarmControl();
    const alarm = new GenericAlarm(control);
    alarm.update([at('notifications.a', 1)]);
    expect(events).toEqual(['start']);
    expect(lastTone()).toBe(GENERIC_ALARM_TONE);
    expect(alarm.sounding).toBe(true);
    alarm.update([]);
    expect(events).toEqual(['start', 'stop']);
    expect(alarm.sounding).toBe(false);
  });

  it('stays quiet for a visual-only or silenced alarm', () => {
    const { control, events } = createFakeAlarmControl();
    const alarm = new GenericAlarm(control);
    alarm.update([
      raised({ path: 'notifications.a', method: ['visual'] }),
      raised({ path: 'notifications.b', silenced: true }),
      raised({ path: 'notifications.c', state: 'warn' }),
    ]);
    expect(events).toEqual([]);
    expect(alarm.sounding).toBe(false);
  });

  it('re-articulates when a second alarm raises while the first is sounding', () => {
    const { control, events } = createFakeAlarmControl();
    const alarm = new GenericAlarm(control);
    alarm.update([at('notifications.a', 1)]);
    alarm.update([at('notifications.a', 1), at('notifications.b', 1)]);
    expect(events).toEqual(['start', 'stop', 'start']);
  });

  it('does not re-articulate on a repeat of the same alarms', () => {
    const { control, events } = createFakeAlarmControl();
    const alarm = new GenericAlarm(control);
    alarm.update([at('notifications.a', 1)]);
    alarm.update([at('notifications.a', 1)]);
    alarm.update([at('notifications.a', 1)]);
    expect(events).toEqual(['start']);
  });

  it('never re-articulates when an alarm clears while another still sounds', () => {
    const { control, events } = createFakeAlarmControl();
    const alarm = new GenericAlarm(control);
    alarm.update([at('notifications.a', 1), at('notifications.b', 1)]);
    alarm.update([at('notifications.a', 1)]);
    expect(events).toEqual(['start']);
  });

  it('re-articulates when a cleared alarm raises again while another still sounds', () => {
    const { control, events } = createFakeAlarmControl();
    const alarm = new GenericAlarm(control);
    alarm.update([at('notifications.a', 1), at('notifications.b', 1)]);
    alarm.update([at('notifications.a', 1)]);
    alarm.update([at('notifications.a', 1), at('notifications.b', 2)]);
    expect(events).toEqual(['start', 'stop', 'start']);
  });

  it('mutes the alarms active here without swallowing the next raise', () => {
    const { control, events } = createFakeAlarmControl();
    const alarm = new GenericAlarm(control);
    alarm.update([at('notifications.a', 1)]);
    alarm.muteActiveHere();
    expect(events).toEqual(['start', 'stop']);
    expect(alarm.sounding).toBe(false);
    expect(alarm.locallyMuted).toBe(true);
    // The same raise republished stays muted.
    alarm.update([at('notifications.a', 1)]);
    expect(events).toEqual(['start', 'stop']);
    // A clear and a fresh raise carries a new activation, which the mute cannot match.
    alarm.update([]);
    expect(alarm.locallyMuted).toBe(false);
    alarm.update([at('notifications.a', 2)]);
    expect(events).toEqual(['start', 'stop', 'start']);
    expect(alarm.locallyMuted).toBe(false);
  });

  it('mutes only the alarms that were active, so a different alarm still sounds', () => {
    const { control, events } = createFakeAlarmControl();
    const alarm = new GenericAlarm(control);
    alarm.update([at('notifications.a', 1)]);
    alarm.muteActiveHere();
    alarm.update([at('notifications.a', 1), at('notifications.b', 1)]);
    expect(events).toEqual(['start', 'stop', 'start']);
    expect(alarm.sounding).toBe(true);
    expect(alarm.locallyMuted).toBe(true);
  });

  it('mutes nothing when no alarm is sounding', () => {
    const { control, events } = createFakeAlarmControl();
    const alarm = new GenericAlarm(control);
    alarm.update([raised({ path: 'notifications.a', method: ['visual'] })]);
    alarm.muteActiveHere();
    expect(events).toEqual([]);
    expect(alarm.locallyMuted).toBe(false);
    // The visual-only alert was never muted, so escalating it to an audible one still sounds.
    alarm.update([at('notifications.a', 1)]);
    expect(events).toEqual(['start']);
  });

  it('forwards prime and silences outright on stop', () => {
    const { control, events } = createFakeAlarmControl();
    const alarm = new GenericAlarm(control);
    alarm.prime();
    alarm.update([at('notifications.a', 1)]);
    alarm.stop();
    expect(events).toEqual(['prime', 'start', 'stop']);
    expect(alarm.sounding).toBe(false);
  });
});
