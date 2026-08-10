import { describe, expect, it } from 'vitest';
import { crossesLocalMidnight, plannedArrivalMs } from './passage-plan';

describe('plannedArrivalMs', () => {
  it('adds the cumulative time at the planning speed to the departure', () => {
    // 3600 meters at 1 m/s is one hour.
    expect(plannedArrivalMs(1_000_000, 3_600, 1)).toBe(1_000_000 + 3_600_000);
  });

  it('returns unavailable for zero, negative, or non-finite inputs', () => {
    expect(plannedArrivalMs(1_000_000, 3_600, 0)).toBeUndefined();
    expect(plannedArrivalMs(1_000_000, 3_600, -1)).toBeUndefined();
    expect(plannedArrivalMs(1_000_000, Number.NaN, 1)).toBeUndefined();
    expect(plannedArrivalMs(Number.NaN, 3_600, 1)).toBeUndefined();
  });
});

describe('crossesLocalMidnight', () => {
  it('is false within one local day and true across it', () => {
    const noon = new Date(2026, 7, 10, 12, 0).getTime();
    const evening = new Date(2026, 7, 10, 23, 30).getTime();
    const nextMorning = new Date(2026, 7, 11, 1, 30).getTime();
    expect(crossesLocalMidnight(noon, evening)).toBe(false);
    expect(crossesLocalMidnight(evening, nextMorning)).toBe(true);
    // A month boundary is a day change too.
    const monthEnd = new Date(2026, 7, 31, 23, 0).getTime();
    const monthStart = new Date(2026, 8, 1, 1, 0).getTime();
    expect(crossesLocalMidnight(monthEnd, monthStart)).toBe(true);
  });
});
