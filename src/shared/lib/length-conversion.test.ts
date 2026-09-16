import { describe, expect, it } from 'vitest';
import { lengthFromDisplay, lengthToDisplay, METRIC_UNITS } from './units';

describe('length editing conversion', () => {
  it('uses the length category rather than unrelated profile categories', () => {
    const mixed = { ...METRIC_UNITS, length: 'ft' as const };
    expect(lengthToDisplay(30.48, mixed)).toBeCloseTo(100);
    expect(lengthFromDisplay(100, mixed)).toBeCloseTo(30.48);
  });
  it.each(['metric', 'imperial'] as const)('round trips unchanged SI limits for %s', (units) => {
    for (const value of [0, 20, 100, 250, 2000]) {
      expect(lengthFromDisplay(lengthToDisplay(value, units), units)).toBeCloseTo(value, 10);
    }
  });
});
