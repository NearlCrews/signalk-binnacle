import { describe, expect, it } from 'vitest';
import {
  clockwiseRadarSpan,
  FULL_CIRCLE_RADIANS,
  isBoundedRadarAngleRange,
  radarAngleInRange,
} from './radar-angle';

describe('radar angle bounds', () => {
  const range = { min: -Math.PI, max: Math.PI, unit: 'rad' };

  it('normalizes an extreme finite bearing in constant-time arithmetic', () => {
    const normalized = radarAngleInRange(1_000_000_000, range);
    expect(normalized).toBeGreaterThanOrEqual(range.min);
    expect(normalized).toBeLessThanOrEqual(range.max);
  });

  it('rejects provider domains outside one normal radar revolution', () => {
    expect(isBoundedRadarAngleRange(range)).toBe(true);
    expect(
      isBoundedRadarAngleRange({
        min: -1_000_000,
        max: 1_000_000,
        unit: 'rad',
      }),
    ).toBe(false);
    expect(
      isBoundedRadarAngleRange({
        min: -FULL_CIRCLE_RADIANS,
        max: FULL_CIRCLE_RADIANS,
        unit: 'rad',
      }),
    ).toBe(false);
  });

  it('bounds every clockwise span to one revolution', () => {
    expect(clockwiseRadarSpan(-1_000_000, 1_000_000)).toBeGreaterThan(0);
    expect(clockwiseRadarSpan(-1_000_000, 1_000_000)).toBeLessThanOrEqual(FULL_CIRCLE_RADIANS);
  });
});
