import { describe, expect, it } from 'vitest';
import type { TrackPoint } from '$entities/track';
import { douglasPeucker } from './simplify';

const p = (lat: number, lon: number, gap?: boolean): TrackPoint => ({
  lat,
  lon,
  t: 0,
  sog: 1,
  gap,
});

describe('douglasPeucker', () => {
  it('collapses a near-collinear run to its endpoints', () => {
    const run = [p(0, 0), p(0, 0.0005), p(0, 0.001)];
    expect(douglasPeucker(run, 0.0001)).toEqual([p(0, 0), p(0, 0.001)]);
  });

  it('keeps a point that deviates beyond the tolerance', () => {
    const run = [p(0, 0), p(0.01, 0.0005), p(0, 0.001)];
    expect(douglasPeucker(run, 0.0001).length).toBe(3);
  });

  it('never drops a gap point and never merges across a break', () => {
    // A straight run, a break, then another straight run.
    const points = [p(0, 0), p(0, 0.0005), p(0, 0.001), p(1, 1, true), p(1, 1.0005), p(1, 1.001)];
    const out = douglasPeucker(points, 0.0001);
    expect(out.some((x) => x.gap)).toBe(true);
    expect(out).toEqual([p(0, 0), p(0, 0.001), p(1, 1, true), p(1, 1.001)]);
  });

  it('simplifies a short collinear run across the antimeridian', () => {
    const run = [p(0, 179.9), p(0, -180), p(0, -179.9)];
    expect(douglasPeucker(run, 0.01)).toEqual([p(0, 179.9), p(0, -179.9)]);
  });
});
