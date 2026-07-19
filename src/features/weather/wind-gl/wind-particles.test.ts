import { describe, expect, it } from 'vitest';
import { MAX_WIND_TRAIL_PIXELS, windTrailSize } from './wind-particles';

describe('windTrailSize', () => {
  it('keeps ordinary drawing buffers at their native size', () => {
    expect(windTrailSize(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it('caps high-density buffers while preserving their aspect ratio', () => {
    const size = windTrailSize(7680, 4320);

    expect(size.width * size.height).toBeLessThanOrEqual(MAX_WIND_TRAIL_PIXELS);
    expect(size.width).toBeLessThanOrEqual(2048);
    expect(size.height).toBeLessThanOrEqual(2048);
    expect(size.width / size.height).toBeCloseTo(7680 / 4320, 2);
  });

  it('scales both dimensions when the longest axis reaches its cap', () => {
    expect(windTrailSize(8000, 1000)).toEqual({ width: 2048, height: 256 });
  });

  it('returns a valid minimum target for unusable dimensions', () => {
    expect(windTrailSize(Number.NaN, 0)).toEqual({ width: 1, height: 1 });
  });
});
