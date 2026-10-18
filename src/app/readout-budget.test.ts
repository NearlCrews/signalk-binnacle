import { describe, expect, it } from 'vitest';
import { readoutBudget } from './readout-budget';

describe('readoutBudget', () => {
  it('shows everything when the columns hold it', () => {
    expect(readoutBudget(9, 0)).toEqual({ time: true, position: true, compact: false });
    expect(readoutBudget(Number.POSITIVE_INFINITY, 3)).toEqual({
      time: true,
      position: true,
      compact: false,
    });
  });

  it('gives way whole: the time first, then the position, then the compact set', () => {
    expect(readoutBudget(8, 0)).toEqual({ time: false, position: true, compact: false });
    expect(readoutBudget(7, 0)).toEqual({ time: false, position: false, compact: false });
    expect(readoutBudget(6, 0)).toEqual({ time: false, position: false, compact: false });
    expect(readoutBudget(5, 0)).toEqual({ time: false, position: false, compact: true });
  });

  it('counts the optional readouts against the same columns', () => {
    // The tablet's ten middle columns with orientation, the anchor watch, and the autopilot on.
    expect(readoutBudget(10, 3)).toEqual({ time: false, position: false, compact: false });
    expect(readoutBudget(10, 1)).toEqual({ time: true, position: true, compact: false });
    expect(readoutBudget(10, 2)).toEqual({ time: false, position: true, compact: false });
  });
});
