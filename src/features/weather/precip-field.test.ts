import { describe, expect, it } from 'vitest';
import type { WeatherGrid } from '$entities/weather';
import { precipFieldRgba } from './precip-field';

function grid(): WeatherGrid {
  const cells = 4; // 2x2
  return {
    lats: [0, 1],
    lons: [0, 1],
    times: [0],
    windU: [new Array(cells).fill(0)],
    windV: [new Array(cells).fill(0)],
    precipitation: [[10, 10, 0, 0]],
  };
}

const bracket = { lo: 0, hi: 0, frac: 0 };

describe('precipFieldRgba', () => {
  it('builds an RGBA buffer at grid resolution, north up', () => {
    const f = precipFieldRgba(grid(), bracket, 'day');
    expect(f?.width).toBe(2);
    expect(f?.height).toBe(2);
    expect(f?.data.length).toBe(2 * 2 * 4);
    // Canvas row 0 is the northernmost grid row (lats[1]), the dry (0 mm) row -> alpha 0.
    expect(f?.data[3]).toBe(0);
    // The southern row (lats[0]) has 10 mm/h -> alpha > 0.
    const southAlpha = f?.data[(1 * 2 + 0) * 4 + 3] ?? 0;
    expect(southAlpha).toBeGreaterThan(0);
  });

  it('is empty without precipitation data', () => {
    const g = grid();
    g.precipitation = undefined;
    expect(precipFieldRgba(g, bracket, 'day')).toBeUndefined();
  });

  it('holds the preceding-hour value instead of smearing totals between hours', () => {
    const g = grid();
    g.times = [0, 3_600_000];
    g.precipitation = [new Array(4).fill(0), new Array(4).fill(10)];
    g.precipitationInterpolation = 'step';
    const halfway = precipFieldRgba(g, { lo: 0, hi: 1, frac: 0.5 }, 'day');
    const alpha = Array.from(halfway?.data ?? []).filter((_, index) => index % 4 === 3);
    expect(alpha.every((value) => value === 0)).toBe(true);
  });
});
