import { describe, expect, it } from 'vitest';
import { themedColorTable } from './legend-theme';
import type { LegendEntry } from './radar-types';

// A simple legend with one transparent empty bin, one normal return, and one Doppler accent.
const legend: LegendEntry[] = [
  { color: '#00000000', label: 'none' },
  { color: '#10ff20ff', label: 'normal return' },
  { color: '#ff0000ff', label: 'doppler approaching' },
  { color: '#0000ffff', label: 'history trail' },
];

describe('themedColorTable', () => {
  it('returns a 256-entry RGBA lookup table (1024 bytes)', () => {
    expect(themedColorTable(legend, 'day')).toHaveLength(256 * 4);
  });

  it('keeps value 0 fully transparent in every theme', () => {
    for (const theme of ['day', 'dusk', 'night-red'] as const) {
      const table = themedColorTable(legend, theme);
      expect(table[3]).toBe(0);
    }
  });

  describe('day theme', () => {
    it('passes all channels through unchanged for normal returns', () => {
      const table = themedColorTable(legend, 'day');
      // Index 1: #10ff20ff
      expect(Array.from(table.slice(1 * 4, 1 * 4 + 4))).toEqual([0x10, 0xff, 0x20, 0xff]);
    });

    it('passes accent entries through unchanged', () => {
      const table = themedColorTable(legend, 'day');
      expect(Array.from(table.slice(2 * 4, 2 * 4 + 4))).toEqual([0xff, 0x00, 0x00, 0xff]);
    });
  });

  describe('night-red theme', () => {
    it('collapses a normal return to a pure red channel (g and b zeroed)', () => {
      const table = themedColorTable(legend, 'night-red');
      // Index 1: #10ff20 -> r=max(0x10,0xff,0x20)=0xff, g=0, b=0
      expect(table[1 * 4 + 1]).toBe(0); // green zeroed
      expect(table[1 * 4 + 2]).toBe(0); // blue zeroed
      expect(table[1 * 4]).toBe(0xff); // red = max(r,g,b)
    });

    it('preserves a Doppler accent entry (label contains "doppler") without modification', () => {
      const table = themedColorTable(legend, 'night-red');
      // Index 2: doppler approaching #ff0000 must remain [255, 0, 0, 255]
      expect(Array.from(table.slice(2 * 4, 2 * 4 + 4))).toEqual([0xff, 0x00, 0x00, 0xff]);
    });

    it('keeps a history/trail accent distinguishable without blue', () => {
      const table = themedColorTable(legend, 'night-red');
      expect(Array.from(table.slice(3 * 4, 3 * 4 + 4))).toEqual([191, 0, 0, 255]);
    });
  });

  describe('dusk theme', () => {
    it('dims a normal return to 70% intensity', () => {
      const table = themedColorTable(legend, 'dusk');
      // Index 1: #10ff20 -> r=round(0x10*0.7)=11, g=round(0xff*0.7)=179, b=round(0x20*0.7)=22
      expect(table[1 * 4]).toBe(Math.round(0x10 * 0.7));
      expect(table[1 * 4 + 1]).toBe(Math.round(0xff * 0.7));
      expect(table[1 * 4 + 2]).toBe(Math.round(0x20 * 0.7));
    });

    it('preserves an accent entry at full brightness in dusk', () => {
      const table = themedColorTable(legend, 'dusk');
      // Index 2: doppler approaching #ff0000 must remain [255, 0, 0, 255]
      expect(Array.from(table.slice(2 * 4, 2 * 4 + 4))).toEqual([0xff, 0x00, 0x00, 0xff]);
    });
  });

  describe('accent detection', () => {
    it('treats a label containing "approach" as an accent', () => {
      const accentLegend: LegendEntry[] = [
        { color: '#00000000', label: 'none' },
        { color: '#00ff00ff', label: 'approach target' },
      ];
      const table = themedColorTable(accentLegend, 'night-red');
      expect(Array.from(table.slice(1 * 4, 1 * 4 + 4))).toEqual([191, 0, 0, 255]);
    });

    it('treats a label containing "reced" as an accent', () => {
      const recedLegend: LegendEntry[] = [
        { color: '#00000000', label: 'none' },
        { color: '#0000ffff', label: 'receding' },
      ];
      const table = themedColorTable(recedLegend, 'night-red');
      expect(Array.from(table.slice(1 * 4, 1 * 4 + 4))).toEqual([191, 0, 0, 255]);
    });
  });

  it('has no green or blue pixels anywhere in the night-red table', () => {
    const table = themedColorTable(legend, 'night-red');
    for (let value = 0; value < 256; value += 1) {
      expect(table[value * 4 + 1]).toBe(0);
      expect(table[value * 4 + 2]).toBe(0);
    }
  });
});
