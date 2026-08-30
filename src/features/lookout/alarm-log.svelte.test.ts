import { describe, expect, it } from 'vitest';
import { MAX_HANDOFF_FACT_TEXT } from '$entities/handoff';
import { formatClockTime } from '$shared/lib';
import {
  alarmChronologyFact,
  alarmLogTail,
  createAlarmLog,
  MAX_ALARM_LOG_ENTRIES,
} from './alarm-log.svelte';

function harness(startMs = Date.parse('2026-08-28T22:00:00')) {
  const clock = { now: startMs };
  return { clock, log: createAlarmLog(clock) };
}

describe('createAlarmLog', () => {
  it('records entries with the clock time, in order', () => {
    const { clock, log } = harness();
    log.record({ kind: 'raised', label: 'Shallow water', detail: 'depth 2.1 m' });
    clock.now += 60_000;
    log.record({ kind: 'silenced', label: 'Shallow water' });

    expect(log.entries).toHaveLength(2);
    expect(log.entries[0]).toMatchObject({ kind: 'raised', label: 'Shallow water' });
    expect(log.entries[1].timeMs - log.entries[0].timeMs).toBe(60_000);
  });

  it('keeps only the most recent entries past the bound', () => {
    const { clock, log } = harness();
    for (let i = 0; i < MAX_ALARM_LOG_ENTRIES + 5; i += 1) {
      clock.now += 1000;
      log.record({ kind: 'raised', label: `event ${i}` });
    }
    expect(log.entries).toHaveLength(MAX_ALARM_LOG_ENTRIES);
    expect(log.entries[0].label).toBe('event 5');
    expect(log.entries.at(-1)?.label).toBe(`event ${MAX_ALARM_LOG_ENTRIES + 4}`);
  });
});

describe('alarmLogTail', () => {
  it('returns the most recent entries as compact clock-time lines', () => {
    const { clock, log } = harness();
    for (let i = 0; i < 7; i += 1) {
      log.record({ kind: 'raised', label: `event ${i}` });
    }
    clock.now += 5 * 60_000;
    log.record({ kind: 'muted', label: 'Collision alarm', detail: '30 min' });

    const tail = alarmLogTail(log);
    expect(tail).toHaveLength(5);
    expect(tail[0]).toBe(`${formatClockTime(log.entries[3].timeMs)} Raised: event 3`);
    expect(tail.at(-1)).toBe(`${formatClockTime(clock.now)} Muted: Collision alarm, 30 min`);
  });
});

describe('alarmChronologyFact', () => {
  it('is absent for a quiet session and compact otherwise', () => {
    const { log } = harness();
    expect(alarmChronologyFact(log)).toBeUndefined();

    log.record({ kind: 'raised', label: 'Anchor drag' });
    log.record({ kind: 'acknowledged', label: 'Anchor drag' });
    const fact = alarmChronologyFact(log);
    expect(fact?.label).toBe('Alarms this session');
    expect(fact?.value).toBe(alarmLogTail(log).join('; '));
  });

  it('never outsizes the handoff fact bound, dropping oldest lines first', () => {
    const { log } = harness();
    const long = 'x'.repeat(90);
    for (let i = 0; i < 5; i += 1) {
      log.record({ kind: 'raised', label: `${long} ${i}` });
    }
    const fact = alarmChronologyFact(log);
    expect(fact).toBeDefined();
    expect((fact?.value.length ?? 0) <= MAX_HANDOFF_FACT_TEXT).toBe(true);
    // The newest line survives the trim.
    expect(fact?.value).toContain(`${long} 4`);
  });

  it('clips a single line that alone exceeds the bound rather than losing the fact', () => {
    const { log } = harness();
    log.record({ kind: 'raised', label: 'y'.repeat(MAX_HANDOFF_FACT_TEXT + 50) });
    const fact = alarmChronologyFact(log);
    expect(fact?.value).toHaveLength(MAX_HANDOFF_FACT_TEXT);
  });
});
