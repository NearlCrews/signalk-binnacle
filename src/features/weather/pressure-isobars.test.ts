import { describe, expect, it } from 'vitest';
import type { WeatherGrid } from '$entities/weather';
import { isobarFeatures } from './pressure-isobars';

// Pressure rises linearly with longitude (constant across latitude), in Pa.
function rampGrid(): WeatherGrid {
  const lons = [0, 1, 2, 3, 4];
  const lats = [0, 1, 2];
  const hpa = [1006.5, 1009.5, 1012.5, 1015.5, 1018.5];
  const cells = lats.length * lons.length;
  const row = new Array(cells).fill(0);
  const pressure = new Array(cells);
  for (let r = 0; r < lats.length; r += 1)
    for (let c = 0; c < lons.length; c += 1) pressure[r * lons.length + c] = hpa[c] * 100;
  return { lats, lons, times: [0], windU: [row], windV: [row], pressureMsl: [pressure] };
}

const bracket = { lo: 0, hi: 0, frac: 0 };

describe('isobarFeatures', () => {
  it.each([
    [1015, 1015],
    [1013, 1015],
  ])('does not invent contours for a %s to %s hPa field', (low, high) => {
    const grid = rampGrid();
    grid.pressureMsl = [
      grid.lats.flatMap(() => grid.lons.map((_, c) => (low + ((high - low) * c) / 4) * 100)),
    ];
    expect(isobarFeatures(grid, bracket).lines.features).toEqual([]);
  });
  it('contours the field at the hPa interval', () => {
    const { lines, labels } = isobarFeatures(rampGrid(), bracket, 4);
    // Levels 1008, 1012, 1016 each cross both cell rows -> 2 segments each.
    expect(lines.features).toHaveLength(6);
    const levels = [...new Set(lines.features.map((f) => f.properties?.pressureHpa))].sort(
      (a, b) => a - b,
    );
    expect(levels).toEqual([1008, 1012, 1016]);
    for (const f of lines.features) {
      expect(f.geometry.type).toBe('LineString');
      expect((f.geometry as GeoJSON.LineString).coordinates).toHaveLength(2);
    }
    expect(labels.features.length).toBeGreaterThan(0);
    for (const f of labels.features) expect((f.properties?.pressureHpa as number) % 4).toBe(0);
  });

  it('is empty without pressure data', () => {
    const g = rampGrid();
    g.pressureMsl = undefined;
    expect(isobarFeatures(g, bracket, 4).lines.features).toHaveLength(0);
  });
});
