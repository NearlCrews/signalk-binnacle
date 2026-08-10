import { describe, expect, it } from 'vitest';
import { TREND_STALE_AFTER_SEC, trendCoverage } from './trend-metrics';

const NOW = 100_000;

describe('trendCoverage', () => {
  it('returns undefined for a series with no samples, distinct from partial data', () => {
    expect(trendCoverage({ times: [], values: [] }, NOW)).toBeUndefined();
    expect(
      trendCoverage({ times: [NOW - 60, NOW - 30], values: [null, null] }, NOW),
    ).toBeUndefined();
  });

  it('reports a complete, current series as neither partial nor stale', () => {
    const times = Array.from({ length: 10 }, (_, index) => NOW - (10 - index) * 30);
    const coverage = trendCoverage({ times, values: times.map(() => 1) }, NOW);
    expect(coverage).toMatchObject({ partial: false, stale: false, coverageFraction: 1 });
    expect(coverage?.lastSampleAgeSec).toBe(30);
    expect(coverage?.longestGapSec).toBe(30);
  });

  it('marks a null-heavy series partial and finds the longest hole', () => {
    const times = [NOW - 300, NOW - 240, NOW - 180, NOW - 120, NOW - 60];
    const coverage = trendCoverage({ times, values: [1, null, null, 1, 1] }, NOW);
    expect(coverage?.partial).toBe(true);
    expect(coverage?.coverageFraction).toBeCloseTo(0.6);
    expect(coverage?.longestGapSec).toBe(180);
  });

  it('marks a single old sample stale without inventing an interval', () => {
    const coverage = trendCoverage({ times: [NOW - TREND_STALE_AFTER_SEC - 60], values: [1] }, NOW);
    expect(coverage?.stale).toBe(true);
    expect(coverage?.longestGapSec).toBe(0);
    expect(coverage?.partial).toBe(false);
  });

  it('scales the staleness threshold to a coarse series so slow data is not falsely stale', () => {
    // Hourly samples: the newest is 50 minutes old, well within three median intervals.
    const times = [NOW - 4 * 3600, NOW - 3 * 3600, NOW - 2 * 3600, NOW - 3000];
    const coverage = trendCoverage({ times, values: [1, 1, 1, 1] }, NOW);
    expect(coverage?.stale).toBe(false);
  });
});
