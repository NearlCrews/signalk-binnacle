import { describe, expect, it } from 'vitest';
import {
  compareOptionalNumber,
  isSafeNonNegativeInteger,
  lerpAngle,
  nearestBySorted,
} from './math';

const DEG = Math.PI / 180;

describe('lerpAngle', () => {
  it('blends across the 0/2 pi seam through the short arc', () => {
    // A plain lerp would sweep 350 -> 10 through 180, pointing a wave arrow backwards.
    const mid = lerpAngle(350 * DEG, 10 * DEG, 0.5);
    expect(Math.min(mid, 2 * Math.PI - mid)).toBeCloseTo(0, 6);
  });

  it('blends within a quadrant like a linear interpolation', () => {
    expect(lerpAngle(10 * DEG, 50 * DEG, 0.5)).toBeCloseTo(30 * DEG, 6);
  });

  it('returns the endpoints at the fraction bounds', () => {
    expect(lerpAngle(45 * DEG, 200 * DEG, 0)).toBeCloseTo(45 * DEG, 6);
    expect(lerpAngle(45 * DEG, 200 * DEG, 1)).toBeCloseTo(200 * DEG, 6);
  });

  it('normalizes into [0, 2 pi)', () => {
    const blended = lerpAngle(350 * DEG, 350 * DEG, 0.5);
    expect(blended).toBeGreaterThanOrEqual(0);
    expect(blended).toBeLessThan(2 * Math.PI);
  });

  it('propagates NaN rather than borrowing the other side, so caller guards still reject', () => {
    expect(lerpAngle(Number.NaN, 1, 0.5)).toBeNaN();
    expect(lerpAngle(1, Number.NaN, 0.5)).toBeNaN();
    expect(lerpAngle(Number.NaN, Number.NaN, 0.5)).toBeNaN();
    expect(lerpAngle(undefined as unknown as number, 1, 0.5)).toBeNaN();
  });
});

describe('compareOptionalNumber', () => {
  it('orders finite numbers ascending by default', () => {
    expect(compareOptionalNumber(1, 2)).toBeLessThan(0);
    expect(compareOptionalNumber(2, 1)).toBeGreaterThan(0);
    expect(compareOptionalNumber(1, 1)).toBe(0);
  });

  it('orders finite numbers descending when asked', () => {
    expect(compareOptionalNumber(1, 2, 'desc')).toBeGreaterThan(0);
    expect(compareOptionalNumber(2, 1, 'desc')).toBeLessThan(0);
  });

  it('sorts undefined and non-finite last regardless of direction', () => {
    expect(compareOptionalNumber(undefined, 5)).toBe(1);
    expect(compareOptionalNumber(5, undefined)).toBe(-1);
    expect(compareOptionalNumber(undefined, 5, 'desc')).toBe(1);
    expect(compareOptionalNumber(5, undefined, 'desc')).toBe(-1);
    expect(compareOptionalNumber(Number.NaN, 5)).toBe(1);
    expect(compareOptionalNumber(undefined, undefined)).toBe(0);
  });
});

describe('nearestBySorted', () => {
  const at = (...ts: number[]) => ts.map((t) => ({ t }));
  const time = (item: { t: number }) => item.t;

  it('returns undefined for an empty array', () => {
    expect(nearestBySorted([], time, 0)).toBeUndefined();
  });

  it('returns the only element regardless of the target', () => {
    expect(nearestBySorted(at(5), time, -100)?.t).toBe(5);
    expect(nearestBySorted(at(5), time, 5)?.t).toBe(5);
    expect(nearestBySorted(at(5), time, 999)?.t).toBe(5);
  });

  it('finds an exact hit', () => {
    expect(nearestBySorted(at(0, 10, 20), time, 10)?.t).toBe(10);
  });

  it('finds the nearest between two samples', () => {
    expect(nearestBySorted(at(0, 1000, 2000), time, 900)?.t).toBe(1000);
    expect(nearestBySorted(at(0, 1000, 2000), time, 1100)?.t).toBe(1000);
  });

  it('breaks a tie toward the earlier sample', () => {
    expect(nearestBySorted(at(0, 1000), time, 500)?.t).toBe(0);
  });

  it('clamps to the first sample before the range', () => {
    expect(nearestBySorted(at(10, 20, 30), time, -5)?.t).toBe(10);
  });

  it('clamps to the last sample after the range', () => {
    expect(nearestBySorted(at(10, 20, 30), time, 100)?.t).toBe(30);
  });

  it('walks outward to the nearest sample matching the predicate', () => {
    const samples = [
      { t: 0, ok: true },
      { t: 1000, ok: false },
      { t: 2000, ok: true },
    ];
    expect(
      nearestBySorted(
        samples,
        (s) => s.t,
        1100,
        (s) => s.ok,
      )?.t,
    ).toBe(2000);
    expect(
      nearestBySorted(
        samples,
        (s) => s.t,
        400,
        (s) => s.ok,
      )?.t,
    ).toBe(0);
  });

  it('returns undefined when no sample matches the predicate', () => {
    expect(nearestBySorted(at(0, 10, 20), time, 5, () => false)).toBeUndefined();
  });
});

describe('isSafeNonNegativeInteger', () => {
  it('accepts zero and safe positive integers', () => {
    expect(isSafeNonNegativeInteger(0)).toBe(true);
    expect(isSafeNonNegativeInteger(Number.MAX_SAFE_INTEGER)).toBe(true);
  });

  it('rejects negative, fractional, unsafe, and non-number values', () => {
    expect(isSafeNonNegativeInteger(-1)).toBe(false);
    expect(isSafeNonNegativeInteger(1.5)).toBe(false);
    expect(isSafeNonNegativeInteger(Number.MAX_SAFE_INTEGER + 1)).toBe(false);
    expect(isSafeNonNegativeInteger('1')).toBe(false);
  });
});
