import { describe, expect, it } from 'vitest';
import { depthShadingStops, shadeColor } from './color-ramp';

describe('shadeColor', () => {
  it('lightens toward white for a positive ratio', () => {
    expect(shadeColor('#000000', 0.5)).toBe('#808080');
  });

  it('darkens toward black for a negative ratio', () => {
    expect(shadeColor('#ffffff', -0.5)).toBe('#808080');
  });

  it('returns the input unchanged for a zero ratio', () => {
    expect(shadeColor('#a8c9e0', 0)).toBe('#a8c9e0');
  });
});

describe('depthShadingStops', () => {
  it('produces eight monotonically increasing elevation stops ending at the land color', () => {
    const stops = depthShadingStops('#a8c9e0', '#eae6dd');
    const elevations = stops.filter((_, i) => i % 2 === 0) as number[];
    expect(elevations).toEqual([-10000, -1000, -200, -50, -20, -5, -0.01, 0]);
    for (let i = 1; i < elevations.length; i++) {
      expect(elevations[i]).toBeGreaterThan(elevations[i - 1]);
    }
    expect(stops[stops.length - 1]).toBe('#eae6dd');
  });
});
