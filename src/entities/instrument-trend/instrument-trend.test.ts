import { describe, expect, it } from 'vitest';
import {
  cleanTrendInstrumentIds,
  DEFAULT_TREND_INSTRUMENT_IDS,
  isTrendInstrumentId,
} from './instrument-trend';

describe('trend instrument ids', () => {
  it('keeps unavailable ids while deduplicating and capping at eight', () => {
    expect(
      cleanTrendInstrumentIds([
        'depth',
        'future-sensor',
        'depth',
        'three',
        'four',
        'five',
        'six',
        'seven',
        'eight',
        'nine',
      ]),
    ).toEqual(['depth', 'future-sensor', 'three', 'four', 'five', 'six', 'seven', 'eight']);
  });

  it('uses the legacy four-chart default for a malformed stored value', () => {
    expect(cleanTrendInstrumentIds('depth')).toEqual([...DEFAULT_TREND_INSTRUMENT_IDS]);
  });

  it('rejects empty, padded, overlong, and control-bearing ids', () => {
    expect(isTrendInstrumentId('')).toBe(false);
    expect(isTrendInstrumentId(' depth')).toBe(false);
    expect(isTrendInstrumentId('x'.repeat(257))).toBe(false);
    expect(isTrendInstrumentId('depth\nother')).toBe(false);
    expect(isTrendInstrumentId('battery:house')).toBe(true);
  });
});
