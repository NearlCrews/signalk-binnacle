import { describe, expect, it } from 'vitest';
import type { WeatherGrid } from '$entities/weather';
import { windArrowFeatures } from './wind-arrows';

const grid: WeatherGrid = {
  lats: [0, 1],
  lons: [0, 1],
  times: [1000, 4000],
  windU: [
    [-10, -10, -10, -10],
    [-10, -10, -10, -10],
  ],
  windV: [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ],
};

describe('windArrowFeatures', () => {
  it('draws a line from each cell toward the wind direction, tagged with speed', () => {
    const fc = windArrowFeatures(grid, { lo: 0, hi: 0, frac: 0 });
    expect(fc.features).toHaveLength(4);
    const coords = (fc.features[0].geometry as GeoJSON.LineString).coordinates;
    expect(coords[0]).toEqual([0, 0]);
    expect(coords[1][0]).toBeLessThan(0); // wind toward the west: endpoint lon decreases
    expect(coords[1][1]).toBeCloseTo(0, 6);
    expect(coords).toHaveLength(5);
    expect(coords[3]).toEqual(coords[1]);
    expect(coords[2][0]).toBeGreaterThan(coords[1][0]);
    expect(coords[4][0]).toBeGreaterThan(coords[1][0]);
    expect(coords[2][1] * coords[4][1]).toBeLessThan(0);
    expect((fc.features[0].properties as { speed: number }).speed).toBeCloseTo(10, 4);
  });

  it('skips near-calm cells', () => {
    const calm: WeatherGrid = {
      ...grid,
      windU: [
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ],
      windV: [
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ],
    };
    expect(windArrowFeatures(calm, { lo: 0, hi: 0, frac: 0 }).features).toHaveLength(0);
  });
});
