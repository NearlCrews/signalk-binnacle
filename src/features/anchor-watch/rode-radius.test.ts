import { describe, expect, it } from 'vitest';
import {
  RODE_GPS_MARGIN_M,
  RODE_RADIUS_STEP_M,
  type RodeInputs,
  suggestWatchRadius,
} from './rode-radius';

const complete: RodeInputs = { rodeMeters: 50, depthMeters: 30, boatLengthMeters: 12 };

describe('suggestWatchRadius', () => {
  it('is incomplete while any input is missing', () => {
    expect(suggestWatchRadius({ ...complete, rodeMeters: undefined }).state).toBe('incomplete');
    expect(suggestWatchRadius({ ...complete, depthMeters: undefined }).state).toBe('incomplete');
    expect(suggestWatchRadius({ ...complete, boatLengthMeters: undefined }).state).toBe(
      'incomplete',
    );
    expect(
      suggestWatchRadius({
        rodeMeters: undefined,
        depthMeters: undefined,
        boatLengthMeters: undefined,
      }).state,
    ).toBe('incomplete');
  });

  it('rejects non-finite inputs as incomplete rather than computing on them', () => {
    expect(suggestWatchRadius({ ...complete, rodeMeters: Number.NaN }).state).toBe('incomplete');
    expect(suggestWatchRadius({ ...complete, depthMeters: Number.POSITIVE_INFINITY }).state).toBe(
      'incomplete',
    );
    expect(
      suggestWatchRadius({ ...complete, boatLengthMeters: Number.NEGATIVE_INFINITY }).state,
    ).toBe('incomplete');
  });

  it('treats zero and negative inputs as not entered', () => {
    expect(suggestWatchRadius({ ...complete, rodeMeters: 0 }).state).toBe('incomplete');
    expect(suggestWatchRadius({ ...complete, rodeMeters: -5 }).state).toBe('incomplete');
    expect(suggestWatchRadius({ ...complete, depthMeters: 0 }).state).toBe('incomplete');
    expect(suggestWatchRadius({ ...complete, depthMeters: -3 }).state).toBe('incomplete');
    expect(suggestWatchRadius({ ...complete, boatLengthMeters: 0 }).state).toBe('incomplete');
    expect(suggestWatchRadius({ ...complete, boatLengthMeters: -1 }).state).toBe('incomplete');
  });

  it('calls a rode no longer than the depth an error, not a zero-swing suggestion', () => {
    expect(suggestWatchRadius({ ...complete, rodeMeters: 30 }).state).toBe('rode-short');
    expect(suggestWatchRadius({ ...complete, rodeMeters: 12 }).state).toBe('rode-short');
  });

  it('computes the horizontal swing and rounds the radius up to the step', () => {
    // 3-4-5 triangle: swing 40, plus boat 12 and margin 10 is 62, rounded up to 65.
    const suggestion = suggestWatchRadius(complete);
    expect(suggestion).toEqual({ state: 'ok', swingMeters: 40, radiusMeters: 65 });
  });

  it('leaves an exact multiple of the step alone', () => {
    // Swing 40 plus boat 5 plus margin 10 is exactly 55.
    const suggestion = suggestWatchRadius({ ...complete, boatLengthMeters: 5 });
    expect(suggestion).toEqual({ state: 'ok', swingMeters: 40, radiusMeters: 55 });
  });

  it('rounds up, never to nearest', () => {
    // Swing 40 plus boat 10.5 plus margin 10 is 60.5: nearest would be 60, up is 65.
    const suggestion = suggestWatchRadius({ ...complete, boatLengthMeters: 10.5 });
    expect(suggestion.state).toBe('ok');
    if (suggestion.state === 'ok') expect(suggestion.radiusMeters).toBe(65);
  });

  it('handles a rode barely past the depth', () => {
    const suggestion = suggestWatchRadius({
      rodeMeters: 30.5,
      depthMeters: 30,
      boatLengthMeters: 12,
    });
    expect(suggestion.state).toBe('ok');
    if (suggestion.state === 'ok') {
      expect(suggestion.swingMeters).toBeCloseTo(Math.sqrt(30.5 ** 2 - 30 ** 2), 10);
      expect(suggestion.radiusMeters).toBe(30);
    }
  });

  it('pins the published constants the copy and rounding depend on', () => {
    expect(RODE_GPS_MARGIN_M).toBe(10);
    expect(RODE_RADIUS_STEP_M).toBe(5);
  });
});
