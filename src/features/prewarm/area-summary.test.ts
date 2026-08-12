import { describe, expect, it } from 'vitest';
import { areaSummary, bboxSpanText, chartCountText, detailLabel } from './area-summary';

describe('bboxSpanText', () => {
  it('reports an approximate span in whole nautical miles', () => {
    // One degree of latitude is 60 nm; one degree of longitude at 60 N is about 30 nm.
    expect(bboxSpanText([-84, 59.5, -83, 60.5])).toBe('about 30 by 60 nm');
  });

  it('measures an antimeridian-crossing box through the seam, not the long way around', () => {
    const text = bboxSpanText([179, -1, -179, 1]);
    expect(text).toBe('about 120 by 120 nm');
  });

  it('returns undefined for degenerate or invalid boxes', () => {
    expect(bboxSpanText([0, 10, 5, 10])).toBeUndefined();
    expect(bboxSpanText([0, 20, 5, 10])).toBeUndefined();
    expect(bboxSpanText([Number.NaN, 0, 5, 10])).toBeUndefined();
    // Zero WIDTH, with real height, so it clears the latitude guard and reaches the longitude
    // arithmetic. Unwrapping a west-equals-east box would call it half the globe wide.
    expect(bboxSpanText([0, 40, 0, 50])).toBeUndefined();
  });
});

describe('detailLabel', () => {
  it('names the matching preset and falls back to custom', () => {
    expect(detailLabel(6, 12)).toBe('Coastal detail');
    expect(detailLabel(5, 9)).toBe('Overview detail');
    expect(detailLabel(6, 15)).toBe('Harbor detail');
    expect(detailLabel(3, 18)).toBe('Custom detail');
  });
});

describe('chartCountText', () => {
  it('counts charts and calls out unavailable ones', () => {
    expect(chartCountText(['a'], 0)).toBe('1 chart');
    expect(chartCountText(['a', 'b', 'c'], 0)).toBe('3 charts');
    expect(chartCountText(['a', 'b', 'c'], 1)).toBe('3 charts, 1 unavailable');
  });
});

describe('areaSummary', () => {
  it('joins detail, chart count, and span, and never claims readiness', () => {
    const text = areaSummary({
      bbox: [-84, 59.5, -83, 60.5],
      minzoom: 6,
      maxzoom: 12,
      sourceIds: ['a', 'b'],
      unavailableSourceIds: ['b'],
    });
    expect(text).toBe('Coastal detail · 2 charts, 1 unavailable · about 30 by 60 nm');
    expect(text).not.toMatch(/ready|passage/i);
  });

  // Zero on both axes, so it exits on the latitude guard; the longitude half is covered above.
  it('omits the span for a degenerate box rather than inventing one', () => {
    expect(
      areaSummary({
        bbox: [0, 10, 0, 10],
        minzoom: 6,
        maxzoom: 12,
        sourceIds: ['a'],
        unavailableSourceIds: [],
      }),
    ).toBe('Coastal detail · 1 chart');
  });
});
