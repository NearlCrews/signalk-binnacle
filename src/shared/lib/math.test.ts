import { describe, expect, it } from 'vitest';
import { compareOptionalNumber, isSafeNonNegativeInteger } from './math';

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
