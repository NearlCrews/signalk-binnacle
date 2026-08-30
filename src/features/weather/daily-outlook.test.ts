import { describe, expect, it } from 'vitest';
import type { WeatherGrid } from '$entities/weather';
import { HOUR_MS } from '$shared/lib';
import { dailyOutlook, gridOutlookSamples, outlookDayName, startOfLocalDay } from './daily-outlook';
import type { PointConditions } from './signalk-weather';

// Local-time constructions keep the grouping expectations true in any zone the suite runs in.
const day0 = new Date(2026, 5, 10).getTime();
const atHour = (day: number, hour: number) => day0 + day * 24 * HOUR_MS + hour * HOUR_MS;

describe('startOfLocalDay', () => {
  it('floors to local midnight and is idempotent', () => {
    const noon = atHour(0, 12);
    expect(startOfLocalDay(noon)).toBe(day0);
    expect(startOfLocalDay(startOfLocalDay(noon))).toBe(day0);
  });
});

describe('outlookDayName', () => {
  it('reads a short weekday and is blank for NaN', () => {
    expect(outlookDayName(day0)).toMatch(/^\S+$/);
    expect(outlookDayName(Number.NaN)).toBe('');
  });
});

describe('dailyOutlook', () => {
  it('groups by local day after the covered day and summarizes wind, gusts, and precipitation', () => {
    const rows: PointConditions[] = [
      // Same local day as afterMs: already covered by the hourly list, never restated.
      { timeMs: atHour(0, 21), windMs: 30, gustMs: 40, precipitationMm: 9 },
      { timeMs: atHour(1, 3), windMs: 5, fromRad: 0.1, gustMs: 8, precipitationMm: 1 },
      {
        timeMs: atHour(1, 9),
        windMs: 10,
        fromRad: 0.05,
        gustMs: 14,
        precipitationMm: 2,
        riskCues: ['Dense fog'],
      },
      { timeMs: atHour(1, 15), windMs: 8, fromRad: 6.2, riskCues: ['Gale-force wind'] },
      { timeMs: atHour(2, 3), windMs: 3 },
      { timeMs: Number.NaN, windMs: 99 },
    ];

    const days = dailyOutlook(rows, atHour(0, 20));

    expect(days).toHaveLength(2);
    expect(days[0]).toMatchObject({
      dayStartMs: atHour(1, 0),
      windMinMs: 5,
      windMaxMs: 10,
      gustMaxMs: 14,
      precipTotalMm: 3,
      worstRiskCue: 'Gale-force wind',
    });
    // All three directions sit in the north sector; the mean stays near north.
    expect(days[0].dominantFromRad).toBeGreaterThan(0);
    expect(days[0].dominantFromRad).toBeLessThan(0.1);
    expect(days[1]).toMatchObject({ dayStartMs: atHour(2, 0), windMinMs: 3, windMaxMs: 3 });
    expect(days[1].dominantFromRad).toBeUndefined();
    expect(days[1].worstRiskCue).toBeUndefined();
  });

  it('reports the most-populated direction sector, not a mean across a veer', () => {
    const rows: PointConditions[] = [
      { timeMs: atHour(1, 3), windMs: 5, fromRad: 3.1 },
      { timeMs: atHour(1, 9), windMs: 5, fromRad: 3.2 },
      { timeMs: atHour(1, 15), windMs: 5, fromRad: 0 },
    ];

    const [day] = dailyOutlook(rows, atHour(0, 20));
    expect(day.dominantFromRad).toBeCloseTo(3.15, 2);
  });

  it('surfaces an unrecognized cue rather than dropping it', () => {
    const rows: PointConditions[] = [{ timeMs: atHour(1, 3), riskCues: ['Freezing spray'] }];
    expect(dailyOutlook(rows, atHour(0, 20))[0].worstRiskCue).toBe('Freezing spray');
  });

  it('caps the outlook at seven days', () => {
    const rows: PointConditions[] = Array.from({ length: 9 }, (_, day) => ({
      timeMs: atHour(day + 1, 12),
      windMs: 5,
    }));
    expect(dailyOutlook(rows, atHour(0, 20))).toHaveLength(7);
  });
});

describe('gridOutlookSamples', () => {
  const gale = -20; // 20 m/s westerly component, comfortably gale force
  const grid: WeatherGrid = {
    lats: [0, 1],
    lons: [0, 1],
    times: [atHour(0, 20), atHour(1, 2), atHour(1, 8)],
    windU: Array.from({ length: 3 }, () => [gale, gale, gale, gale]),
    windV: Array.from({ length: 3 }, () => [0, 0, 0, 0]),
  };

  it('samples every grid step from the requested time on, with risk cues applied', () => {
    const samples = gridOutlookSamples(grid, [0.5, 0.5], atHour(1, 0));

    expect(samples.map((sample) => sample.timeMs)).toEqual([atHour(1, 2), atHour(1, 8)]);
    expect(samples[0].windMs).toBeCloseTo(20, 5);
    expect(samples[0].riskCues).toContain('Gale-force wind');
  });

  it('returns nothing for a position outside the grid', () => {
    expect(gridOutlookSamples(grid, [5, 5], atHour(0, 0))).toEqual([]);
  });
});
