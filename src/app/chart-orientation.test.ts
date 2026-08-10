import { describe, expect, it } from 'vitest';
import {
  ORIENTATION_MIN_SOG_MPS,
  type OrientationFallback,
  resolveOrientation,
} from './chart-orientation';

const fresh = {
  headingRad: Math.PI / 2,
  headingStale: false,
  cogRad: Math.PI,
  cogStale: false,
  sogMps: 3,
  sogStale: false,
};

describe('resolveOrientation', () => {
  it('keeps north-up at zero bearing regardless of references', () => {
    expect(resolveOrientation({ mode: 'north', ...fresh })).toEqual({
      bearingDeg: 0,
      active: true,
      label: 'North up',
    });
  });

  it('rotates heading-up by fresh true heading and names the reference', () => {
    const result = resolveOrientation({ mode: 'heading', ...fresh });
    expect(result.bearingDeg).toBeCloseTo(90);
    expect(result.active).toBe(true);
    expect(result.label).toBe('Heading up (true)');
  });

  it('falls back to north immediately on a stale or missing heading', () => {
    expect(resolveOrientation({ mode: 'heading', ...fresh, headingStale: true })).toMatchObject({
      bearingDeg: 0,
      active: false,
      fallback: 'stale-heading',
    });
    expect(resolveOrientation({ mode: 'heading', ...fresh, headingRad: undefined })).toMatchObject({
      bearingDeg: 0,
      active: false,
      fallback: 'no-heading',
    });
  });

  it('rotates course-up only with fresh COG and way on', () => {
    expect(resolveOrientation({ mode: 'course', ...fresh }).bearingDeg).toBeCloseTo(180);
    expect(resolveOrientation({ mode: 'course', ...fresh, cogStale: true })).toMatchObject({
      bearingDeg: 0,
      fallback: 'stale-cog',
    });
    const lowSpeed: OrientationFallback = 'low-speed';
    expect(
      resolveOrientation({ mode: 'course', ...fresh, sogMps: ORIENTATION_MIN_SOG_MPS / 2 }),
    ).toMatchObject({ bearingDeg: 0, fallback: lowSpeed });
    expect(resolveOrientation({ mode: 'course', ...fresh, sogStale: true })).toMatchObject({
      bearingDeg: 0,
      fallback: 'low-speed',
    });
  });
});
