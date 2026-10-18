import { describe, expect, it } from 'vitest';
import { readoutBudget } from './readout-budget';

describe('readoutBudget', () => {
  it('shows everything when the columns hold it', () => {
    const all = { time: true, position: true, compact: false, context: true };
    expect(readoutBudget(9, 0)).toEqual(all);
    expect(readoutBudget(Number.POSITIVE_INFINITY, 3)).toEqual(all);
  });

  it('gives way whole: the time first, then the position, then the compact set', () => {
    expect(readoutBudget(8, 0)).toEqual({
      time: false,
      position: true,
      compact: false,
      context: true,
    });
    const core = { time: false, position: false, compact: false, context: true };
    expect(readoutBudget(7, 0)).toEqual(core);
    expect(readoutBudget(6, 0)).toEqual(core);
    expect(readoutBudget(5, 0)).toEqual({
      time: false,
      position: false,
      compact: true,
      context: true,
    });
  });

  it('lets the context cell give way on a bar of one readout column', () => {
    // Very large text on a phone: Status, SOG, and Depth stay, one per row.
    expect(readoutBudget(2, 0).context).toBe(true);
    expect(readoutBudget(1, 0)).toEqual({
      time: false,
      position: false,
      compact: true,
      context: false,
    });
    expect(readoutBudget(1, 3).context).toBe(false);
  });

  it('counts the optional readouts against the same columns', () => {
    // The tablet's ten middle columns with orientation, the anchor watch, and the autopilot on.
    expect(readoutBudget(10, 3)).toEqual({
      time: false,
      position: false,
      compact: false,
      context: true,
    });
    expect(readoutBudget(10, 1)).toEqual({
      time: true,
      position: true,
      compact: false,
      context: true,
    });
    expect(readoutBudget(10, 2)).toEqual({
      time: false,
      position: true,
      compact: false,
      context: true,
    });
  });
});
