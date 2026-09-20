import { describe, expect, it } from 'vitest';
import { isobarColors } from './pressure-colors';

describe('isobarColors', () => {
  it('returns a line, label, and halo color per theme', () => {
    const day = isobarColors('day');
    expect(day.line).toMatch(/^#|rgb/);
    expect(day.label).toMatch(/^#|rgb/);
    expect(day.halo).toMatch(/^#|rgb/);
  });

  it('uses no blue at night-red', () => {
    const { line } = isobarColors('night-red');
    const [r, , b] = parseRgb(line);
    expect(r).toBeGreaterThan(b);
    expect(b).toBe(0);
    expect(parseRgb(isobarColors('night-red').label)[2]).toBe(0);
  });
});

function parseRgb(s: string): [number, number, number] {
  const m = s.match(/rgba?\(([^)]+)\)/);
  if (!m) return [0, 0, 0];
  const [r, g, b] = m[1].split(',').map((v) => Number.parseFloat(v));
  return [r, g, b];
}
