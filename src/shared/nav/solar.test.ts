import { describe, expect, it } from 'vitest';
import { isAfterDark, sunTimes } from './solar';

const MIN = 60_000;

function riseSet(result: ReturnType<typeof sunTimes>): { sunriseMs: number; sunsetMs: number } {
  if (result === undefined || typeof result === 'string') {
    throw new Error(`expected rise and set times, got ${String(result)}`);
  }
  return result;
}

// Published almanac epochs, asserted to within three minutes: the approximation's stated accuracy
// band, generous enough that leap-second and refraction differences cannot flake the suite.
function expectNear(actualMs: number, expectedIso: string, toleranceMin = 3): void {
  expect(Math.abs(actualMs - Date.parse(expectedIso))).toBeLessThanOrEqual(toleranceMin * MIN);
}

describe('sunTimes', () => {
  it('matches the almanac for a mid-northern-latitude solstice (Boston)', () => {
    const t = riseSet(sunTimes(Date.parse('2026-06-21T12:00:00Z'), 42.3601, -71.0589));
    expectNear(t.sunriseMs, '2026-06-21T09:07:00Z');
    expectNear(t.sunsetMs, '2026-06-22T00:25:00Z');
  });

  it('matches the almanac for a southern-hemisphere winter day (Sydney)', () => {
    const t = riseSet(sunTimes(Date.parse('2026-06-21T02:00:00Z'), -33.8688, 151.2093));
    expectNear(t.sunriseMs, '2026-06-20T21:01:00Z');
    expectNear(t.sunsetMs, '2026-06-21T06:54:00Z');
  });

  it('matches the almanac at high latitude (Reykjavik near the solstice)', () => {
    const t = riseSet(sunTimes(Date.parse('2026-06-21T12:00:00Z'), 64.1265, -21.8174));
    expectNear(t.sunriseMs, '2026-06-21T02:55:00Z');
    expectNear(t.sunsetMs, '2026-06-22T00:03:00Z');
  });

  it('gives the equator a day just over twelve hours at the equinox', () => {
    const t = riseSet(sunTimes(Date.parse('2026-03-20T17:00:00Z'), -0.18, -78.47));
    const dayLengthMin = (t.sunsetMs - t.sunriseMs) / MIN;
    // Twelve hours plus roughly seven minutes from refraction and the solar disc's width.
    expect(dayLengthMin).toBeGreaterThan(12 * 60 + 3);
    expect(dayLengthMin).toBeLessThan(12 * 60 + 11);
  });

  it('brackets a local midday query between its own rise and set', () => {
    const query = Date.parse('2026-06-21T16:00:00Z');
    const t = riseSet(sunTimes(query, 42.3601, -71.0589));
    expect(t.sunriseMs).toBeLessThan(query);
    expect(t.sunsetMs).toBeGreaterThan(query);
  });

  it('reports the polar day and the polar night (Longyearbyen)', () => {
    expect(sunTimes(Date.parse('2026-06-21T12:00:00Z'), 78.2232, 15.6267)).toBe('always-up');
    expect(sunTimes(Date.parse('2026-12-21T12:00:00Z'), 78.2232, 15.6267)).toBe('always-down');
  });

  it('handles the poles themselves without dividing into nonsense', () => {
    expect(sunTimes(Date.parse('2026-06-21T12:00:00Z'), 90, 0)).toBe('always-up');
    expect(sunTimes(Date.parse('2026-06-21T12:00:00Z'), -90, 0)).toBe('always-down');
  });

  it('rejects non-finite and out-of-range inputs', () => {
    expect(sunTimes(Number.NaN, 42, -71)).toBeUndefined();
    expect(sunTimes(Date.now(), Number.NaN, -71)).toBeUndefined();
    expect(sunTimes(Date.now(), 42, Number.POSITIVE_INFINITY)).toBeUndefined();
    expect(sunTimes(Date.now(), 95, -71)).toBeUndefined();
  });
});

describe('isAfterDark', () => {
  // Detroit-ish (43 N, 83 W) on 2026-08-11: sunset 00:41:47Z, next sunrise 10:33:52Z.
  const lat = 43;
  const lon = -83;

  it('keeps the twilight margin past sunset light and the deeper evening dark', () => {
    expect(isAfterDark(Date.parse('2026-08-11T00:52:00Z'), lat, lon)).toBe(false);
    expect(isAfterDark(Date.parse('2026-08-11T01:27:00Z'), lat, lon)).toBe(true);
  });

  it('keeps the twilight margin before sunrise light and the earlier morning dark', () => {
    expect(isAfterDark(Date.parse('2026-08-11T10:15:00Z'), lat, lon)).toBe(false);
    expect(isAfterDark(Date.parse('2026-08-11T09:30:00Z'), lat, lon)).toBe(true);
  });

  it('is light through the middle of the day and dark in the middle of the night', () => {
    expect(isAfterDark(Date.parse('2026-08-11T18:00:00Z'), lat, lon)).toBe(false);
    expect(isAfterDark(Date.parse('2026-08-11T06:00:00Z'), lat, lon)).toBe(true);
  });

  it('honors a zero margin, going dark right at sunset', () => {
    expect(isAfterDark(Date.parse('2026-08-11T00:45:00Z'), lat, lon, 0)).toBe(true);
    expect(isAfterDark(Date.parse('2026-08-11T00:45:00Z'), lat, lon)).toBe(false);
  });

  it('treats the polar day as light and the polar night as dark at any hour', () => {
    expect(isAfterDark(Date.parse('2026-06-21T00:00:00Z'), 78.2232, 15.6267)).toBe(false);
    expect(isAfterDark(Date.parse('2026-12-21T12:00:00Z'), 78.2232, 15.6267)).toBe(true);
  });

  it('never flags an unresolvable input as dark', () => {
    expect(isAfterDark(Number.NaN, lat, lon)).toBe(false);
    expect(isAfterDark(Date.now(), Number.NaN, lon)).toBe(false);
  });
});
