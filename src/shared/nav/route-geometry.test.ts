import { describe, expect, it } from 'vitest';
import { degreesToRadians, knotsToMetersPerSecond } from '$shared/lib';
import {
  crossTrackErrorMeters,
  etaSeconds,
  rhumbBearingRad,
  rhumbCrossTrackErrorMeters,
  rhumbDistanceMeters,
  steerSide,
  vmgMps,
} from './route-geometry';

const NM = 1852;

describe('rhumbDistanceMeters', () => {
  it('measures about one nautical mile per minute of latitude due north', () => {
    const d = rhumbDistanceMeters(
      { latitude: 0, longitude: 0 },
      { latitude: 1 / 60, longitude: 0 },
    );
    expect(d).toBeGreaterThan(NM * 0.99);
    expect(d).toBeLessThan(NM * 1.01);
  });

  it('handles an antimeridian crossing as a short hop, not a near-global span', () => {
    const d = rhumbDistanceMeters(
      { latitude: 0, longitude: 179.99 },
      { latitude: 0, longitude: -179.99 },
    );
    expect(d).toBeLessThan(3 * NM);
  });

  it('stays finite at the geographic poles', () => {
    expect(
      rhumbDistanceMeters({ latitude: 90, longitude: 0 }, { latitude: 89.9, longitude: 1 }),
    ).toSatisfy(Number.isFinite);
  });
});

describe('rhumbBearingRad', () => {
  it('is 0 due north and about pi/2 due east', () => {
    expect(
      rhumbBearingRad({ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 0 }),
    ).toBeCloseTo(0, 3);
    expect(
      rhumbBearingRad({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 1 }),
    ).toBeCloseTo(Math.PI / 2, 2);
  });
});

describe('crossTrackErrorMeters', () => {
  it('is zero on the leg and positive to starboard of it', () => {
    const from = { latitude: 0, longitude: 0 };
    const to = { latitude: 0, longitude: 1 }; // leg runs due east
    expect(Math.abs(crossTrackErrorMeters(from, to, { latitude: 0, longitude: 0.5 }))).toBeLessThan(
      1,
    );
    // A point south of an eastbound leg is to starboard (positive).
    expect(crossTrackErrorMeters(from, to, { latitude: -0.01, longitude: 0.5 })).toBeGreaterThan(0);
  });
});

describe('rhumbCrossTrackErrorMeters', () => {
  const from = { latitude: 0, longitude: 0 };
  const to = { latitude: 0, longitude: 1 }; // leg runs due east

  it('is zero when the point is on the leg', () => {
    expect(
      Math.abs(rhumbCrossTrackErrorMeters(from, to, { latitude: 0, longitude: 0.5 })),
    ).toBeLessThan(1);
  });

  it('is positive to starboard and negative to port of an eastbound leg', () => {
    // A point south of an eastbound leg is to starboard (positive); north is to port (negative).
    expect(
      rhumbCrossTrackErrorMeters(from, to, { latitude: -0.01, longitude: 0.5 }),
    ).toBeGreaterThan(0);
    expect(rhumbCrossTrackErrorMeters(from, to, { latitude: 0.01, longitude: 0.5 })).toBeLessThan(
      0,
    );
  });

  it('shares the starboard-positive sign convention with the great-circle cross-track', () => {
    const point = { latitude: -0.01, longitude: 0.5 };
    const rhumb = rhumbCrossTrackErrorMeters(from, to, point);
    const greatCircle = crossTrackErrorMeters(from, to, point);
    expect(Math.sign(rhumb)).toBe(Math.sign(greatCircle));
  });

  it('has a sane magnitude for a small offset', () => {
    // 0.01 degrees of latitude off an eastbound leg is about 1.85 km (one nautical mile per minute,
    // and 0.01 degrees is 0.6 minutes).
    const d = Math.abs(rhumbCrossTrackErrorMeters(from, to, { latitude: -0.01, longitude: 0.5 }));
    expect(d).toBeGreaterThan(NM * 0.5);
    expect(d).toBeLessThan(NM * 0.7);
  });
});

describe('vmgMps', () => {
  it('equals boat speed when heading straight at the mark', () => {
    const v = vmgMps(
      { latitude: 0, longitude: 0 },
      { latitude: 1, longitude: 0 },
      knotsToMetersPerSecond(6),
      degreesToRadians(0),
    );
    expect(v).toBeCloseTo(knotsToMetersPerSecond(6), 5);
  });

  it('is negative when sailing away from the mark', () => {
    const v = vmgMps(
      { latitude: 0, longitude: 0 },
      { latitude: 1, longitude: 0 },
      knotsToMetersPerSecond(6),
      degreesToRadians(180),
    );
    expect(v).toBeLessThan(0);
  });
});

describe('steerSide', () => {
  it('steers to port for a starboard (positive) error and to starboard for a port (negative) one', () => {
    expect(steerSide(50)).toBe('port');
    expect(steerSide(-50)).toBe('starboard');
  });

  it('has no side for a zero or non-finite error', () => {
    expect(steerSide(0)).toBeNull();
    expect(steerSide(Number.NaN)).toBeNull();
  });
});

describe('etaSeconds', () => {
  it('is distance over speed', () => {
    expect(etaSeconds(1852, knotsToMetersPerSecond(6))).toBeCloseTo(
      1852 / knotsToMetersPerSecond(6),
      3,
    );
  });

  it('is undefined for a non-positive speed', () => {
    expect(etaSeconds(1852, 0)).toBeUndefined();
  });

  it('is undefined for non-finite or negative inputs', () => {
    expect(etaSeconds(-1, 2)).toBeUndefined();
    expect(etaSeconds(Number.NaN, 2)).toBeUndefined();
    expect(etaSeconds(10, Number.POSITIVE_INFINITY)).toBeUndefined();
  });
});
