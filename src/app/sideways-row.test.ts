import { describe, expect, it } from 'vitest';
import { type SidewaysRoom, tilesBeside } from './sideways-row';

// A short screen: 44 px targets and 4 px gaps, with the readout column floor and height at a text
// size.
function room(middle: number, textScale: number): SidewaysRoom {
  return {
    middle,
    cellWidth: 92 * textScale,
    cellHeight: Math.max(44, 38 * textScale),
    tileWidth: 44,
    tileGap: 4,
    tileHeight: 44,
    gap: 4,
  };
}

describe('tilesBeside', () => {
  it('keeps one row beside the tiles at the default text size', () => {
    // 852 by 393 and 568 by 320: the readouts fit one row beside four tiles, or tie with the
    // stacked bar's two rows.
    expect(tilesBeside(room(740, 1), 4, 4)).toBe(true);
    expect(tilesBeside(room(456, 1), 4, 4)).toBe(true);
  });

  it('sets the tiles beside readouts that wrap either way at very large text', () => {
    // 852 by 393 at 200 percent: three stacked columns still take two readout rows plus the tiles'
    // row, while two columns beside the tiles take the same two readout rows and no more.
    expect(tilesBeside(room(724, 2), 4, 4)).toBe(true);
  });

  it('stacks the tiles when beside them the readouts would take more rows than they save', () => {
    // 568 by 320 at 200 percent: one column beside the tiles would stack four readouts.
    expect(tilesBeside(room(440, 2), 4, 4)).toBe(false);
    // 852 by 393 at 150 percent: one stacked row and the tiles beat two rows beside them.
    expect(tilesBeside(room(732, 1.5), 4, 4)).toBe(false);
    // 932 by 430 at 200 percent: four stacked columns hold every readout on one row.
    expect(tilesBeside(room(804, 2), 4, 4)).toBe(false);
  });

  it('counts the optional readouts and needs no room for absent tiles', () => {
    // 568 by 320 with all three optional readouts: four rows beside the tiles, two stacked.
    expect(tilesBeside(room(456, 1), 4, 7)).toBe(false);
    expect(tilesBeside(room(440, 2), 0, 4)).toBe(true);
  });
});
