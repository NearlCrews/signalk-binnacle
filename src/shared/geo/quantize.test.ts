import { describe, expect, it } from 'vitest';
import { parseLatLonKey, quantizeCellDeg, quantizeLatLonKey } from './quantize';

describe('quantizeCellDeg', () => {
  it('snaps to the nearest tenth of a degree and always keeps one decimal', () => {
    expect(quantizeCellDeg(37.7749)).toBe('37.8');
    expect(quantizeCellDeg(-122.4194)).toBe('-122.4');
    expect(quantizeCellDeg(0)).toBe('0.0');
  });

  it('holds one key across drift inside a cell and changes at the boundary', () => {
    expect(quantizeCellDeg(0.04)).toBe(quantizeCellDeg(-0.04));
    expect(quantizeCellDeg(0.05)).toBe('0.1');
  });

  it('never emits a negative zero, so a cell straddling the equator keeps one key', () => {
    expect(quantizeCellDeg(-0.02)).toBe('0.0');
    expect(quantizeCellDeg(-0.02)).toBe(quantizeCellDeg(0.02));
  });
});

describe('quantizeLatLonKey', () => {
  it('rounds to three decimals by default', () => {
    expect(quantizeLatLonKey({ latitude: 37.774929, longitude: -122.419418 })).toBe(
      '37.775,-122.419',
    );
  });

  it('returns an equal string for two fixes inside the same cell', () => {
    const a = quantizeLatLonKey({ latitude: 37.7749291, longitude: -122.4194181 });
    const b = quantizeLatLonKey({ latitude: 37.7749294, longitude: -122.4194189 });
    expect(a).toBe(b);
  });

  it('honors an explicit precision', () => {
    expect(quantizeLatLonKey({ latitude: 37.774929, longitude: -122.419418 }, 1)).toBe(
      '37.8,-122.4',
    );
    expect(quantizeLatLonKey({ latitude: 37.774929, longitude: -122.419418 }, 0)).toBe('38,-122');
  });

  it('pads to the requested decimals so a whole degree still keys consistently', () => {
    expect(quantizeLatLonKey({ latitude: 10, longitude: -20 })).toBe('10.000,-20.000');
  });
});

describe('parseLatLonKey', () => {
  it('round-trips a quantized key back to its cell position', () => {
    const key = quantizeLatLonKey({ latitude: 37.774929, longitude: -122.419418 });
    expect(parseLatLonKey(key)).toEqual({ latitude: 37.775, longitude: -122.419 });
  });

  it('reads a negative latitude and a positive longitude', () => {
    expect(parseLatLonKey('-33.868,151.209')).toEqual({ latitude: -33.868, longitude: 151.209 });
  });

  it('rejects a key that is not a coordinate pair', () => {
    expect(parseLatLonKey('')).toBeUndefined();
    expect(parseLatLonKey('nope')).toBeUndefined();
    expect(parseLatLonKey('37.775')).toBeUndefined();
    expect(parseLatLonKey('37.775,-122.419,10')).toBeUndefined();
  });

  it('rejects a non-numeric component instead of returning NaN', () => {
    expect(parseLatLonKey('north,-122.419')).toBeUndefined();
    expect(parseLatLonKey('37.775,west')).toBeUndefined();
  });

  it('rejects an empty component rather than reading it as zero', () => {
    expect(parseLatLonKey(',')).toBeUndefined();
    expect(parseLatLonKey('37.775,')).toBeUndefined();
    expect(parseLatLonKey(',-122.419')).toBeUndefined();
    expect(parseLatLonKey(' , ')).toBeUndefined();
  });

  it('rejects coordinates outside the valid ranges', () => {
    expect(parseLatLonKey('91,0')).toBeUndefined();
    expect(parseLatLonKey('-91,0')).toBeUndefined();
    expect(parseLatLonKey('0,181')).toBeUndefined();
    expect(parseLatLonKey('0,-181')).toBeUndefined();
    expect(parseLatLonKey('Infinity,0')).toBeUndefined();
  });

  it('accepts the range limits and the origin', () => {
    expect(parseLatLonKey('90,180')).toEqual({ latitude: 90, longitude: 180 });
    expect(parseLatLonKey('-90,-180')).toEqual({ latitude: -90, longitude: -180 });
    expect(parseLatLonKey('0,0')).toEqual({ latitude: 0, longitude: 0 });
  });
});
