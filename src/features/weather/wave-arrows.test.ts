import { describe, expect, it } from 'vitest';
import type { WeatherGrid } from '$entities/weather';
import { waveArrowFeatures } from './wave-arrows';

function grid(): WeatherGrid {
  const cells = 16; // 4x4 so the stride keeps at least one arrow
  return {
    lats: [0, 1, 2, 3],
    lons: [0, 1, 2, 3],
    times: [0],
    windU: [new Array(cells).fill(0)],
    windV: [new Array(cells).fill(0)],
    waveHeight: [new Array(cells).fill(2)],
    waveDirection: [new Array(cells).fill(0)], // from north -> travels south
    wavePeriod: [new Array(cells).fill(6)],
  };
}

const bracket = { lo: 0, hi: 0, frac: 0 };

describe('waveArrowFeatures', () => {
  it('emits sparse arrows', () => {
    const fc = waveArrowFeatures(grid(), bracket);
    expect(fc.features.length).toBeGreaterThan(0);
    expect(fc.features.length).toBeLessThan(16);
  });

  it('skips cells whose height is missing', () => {
    const g = grid();
    g.waveHeight = [new Array(16).fill(Number.NaN)];
    expect(waveArrowFeatures(g, bracket).features).toHaveLength(0);
  });

  it('is empty without wave data', () => {
    const g = grid();
    g.waveDirection = undefined;
    expect(waveArrowFeatures(g, bracket).features).toHaveLength(0);
  });

  it('blends direction the short way across the 0/2 pi seam', () => {
    const g = grid();
    const cells = 16;
    // Two steps straddling north: 350 degrees and 10 degrees. Blended at the midpoint the travel
    // vector must point south (the reverse of a from-north direction), not north.
    g.waveDirection = [
      new Array(cells).fill(350 * (Math.PI / 180)),
      new Array(cells).fill(10 * (Math.PI / 180)),
    ];
    g.waveHeight = [new Array(cells).fill(2), new Array(cells).fill(2)];
    const fc = waveArrowFeatures(g, { lo: 0, hi: 1, frac: 0.5 });
    const [first] = fc.features;
    expect(first).toBeDefined();
    const line = first.geometry as GeoJSON.LineString;
    const [[startLon, startLat], [endLon, endLat]] = line.coordinates;
    // Travelling south: the arrow ends below where it starts, and does not swing east or west.
    expect(endLat).toBeLessThan(startLat);
    expect(endLon).toBeCloseTo(startLon, 6);
  });

  it('skips a cell whose direction is missing in both bracketing steps', () => {
    const g = grid();
    g.waveDirection = [new Array(16).fill(Number.NaN)];
    expect(waveArrowFeatures(g, bracket).features).toHaveLength(0);
  });
});
