import { describe, expect, it } from 'vitest';
import { windColor } from './wind-colormap';

describe('windColor', () => {
  it('returns an rgba tuple in 0..1 for day', () => {
    const c = windColor(0, 'day');
    expect(c).toHaveLength(4);
    for (const v of c) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
  it('uses a red-band ramp at night, red above blue', () => {
    const c = windColor(20, 'night-red');
    expect(c[0]).toBeGreaterThan(c[2]);
    expect(c[2]).toBe(0);
  });
});
