import { describe, expect, it } from 'vitest';
import { DEG_TO_RAD } from '$shared/lib';
import {
  TREND_STALE_AFTER_SEC,
  trendAnnotation,
  trendCoverage,
  trendDangerSide,
  trendNoiseFloor,
} from './trend-metrics';

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

describe('trendAnnotation', () => {
  const series = (values: ReadonlyArray<number | null>) => ({
    times: values.map((_, index) => index),
    values,
  });

  it('returns undefined without at least two samples', () => {
    expect(trendAnnotation(series([]), 1)).toBeUndefined();
    expect(trendAnnotation(series([null, null]), 1)).toBeUndefined();
    expect(trendAnnotation(series([null, 4, null]), 1)).toBeUndefined();
  });

  it('skips null and non-finite slots when finding endpoints and extremes', () => {
    const annotation = trendAnnotation(series([null, 4, Number.NaN, 2, 6, null]), 1);
    expect(annotation).toMatchObject({
      firstIndex: 1,
      lastIndex: 4,
      minIndex: 3,
      maxIndex: 4,
      netChange: 2,
      verdict: 'rising',
    });
  });

  it('grades the first-to-last change against the noise floor', () => {
    expect(trendAnnotation(series([10, 12]), 1)?.verdict).toBe('rising');
    expect(trendAnnotation(series([12, 10]), 1)?.verdict).toBe('falling');
    expect(trendAnnotation(series([10, 10.5]), 1)?.verdict).toBe('steady');
    // A change exactly at the floor is still noise.
    expect(trendAnnotation(series([10, 11]), 1)?.verdict).toBe('steady');
    expect(trendAnnotation(series([10, 11]), 1)?.netChange).toBe(1);
  });
});

describe('trend annotation policy', () => {
  it('calls out the risky end of each display kind', () => {
    expect(trendDangerSide('depth')).toBe('min');
    expect(trendDangerSide('pressure')).toBe('min');
    expect(trendDangerSide('voltage')).toBe('min');
    expect(trendDangerSide('ratio')).toBe('min');
    expect(trendDangerSide('speed')).toBe('max');
    expect(trendDangerSide('rpm')).toBe('max');
    expect(trendDangerSide('current')).toBe('max');
    expect(trendDangerSide('power')).toBe('max');
    expect(trendDangerSide('temperature')).toBe('both');
    expect(trendDangerSide('volume')).toBe('both');
    expect(trendDangerSide('count')).toBe('both');
  });

  it('keeps the noise floors in SI units', () => {
    expect(trendNoiseFloor('pressure')).toBe(100);
    expect(trendNoiseFloor('speed')).toBe(0.25);
    expect(trendNoiseFloor('rpm')).toBeCloseTo(50 / 60, 10);
    expect(trendNoiseFloor('rate-of-turn')).toBeCloseTo(DEG_TO_RAD / 60, 10);
  });
});
