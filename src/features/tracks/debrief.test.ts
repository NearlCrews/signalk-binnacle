import { describe, expect, it } from 'vitest';
import type { TrackPoint } from '$entities/track';
import { METERS_PER_NAUTICAL_MILE } from '$shared/lib';
import { haversineMeters } from '$shared/nav';
import {
  computePassageDebrief,
  DEBRIEF_MIN_DISTANCE_METERS,
  DEBRIEF_MIN_DURATION_SECONDS,
  debriefReady,
  type PassageDebrief,
} from './debrief';

function point(lat: number, t: number, sog: number, gap?: boolean): TrackPoint {
  return gap ? { lat, lon: 0, t, sog, gap } : { lat, lon: 0, t, sog };
}

function metersBetween(latA: number, latB: number): number {
  return haversineMeters(latA, 0, latB, 0);
}

describe('computePassageDebrief', () => {
  it('returns undefined for empty and single-point recordings', () => {
    expect(computePassageDebrief([])).toBeUndefined();
    expect(computePassageDebrief([point(0, 0, 2)])).toBeUndefined();
  });

  it('attributes a moving leg to underway time with its distance and speeds', () => {
    const debrief = computePassageDebrief([point(0, 0, 2), point(0.01, 600_000, 3)]);
    const leg = metersBetween(0, 0.01);
    expect(debrief).toBeDefined();
    expect(debrief?.startMs).toBe(0);
    expect(debrief?.endMs).toBe(600_000);
    expect(debrief?.totalSeconds).toBe(600);
    expect(debrief?.underwaySeconds).toBe(600);
    expect(debrief?.stoppedSeconds).toBe(0);
    expect(debrief?.distanceMeters).toBeCloseTo(leg, 6);
    expect(debrief?.avgUnderwaySog).toBeCloseTo(leg / 600, 6);
    expect(debrief?.maxUnderwaySog).toBe(3);
    expect(debrief?.longestLeg).toMatchObject({ startMs: 0, endMs: 600_000, durationSeconds: 600 });
    expect(debrief?.longestLeg?.distanceMeters).toBeCloseTo(leg, 6);
  });

  it('counts a station-holding leg as stopped and ignores its SOG jitter', () => {
    // A metre of drift over ten minutes with a jittering GPS reporting way on both fixes.
    const debrief = computePassageDebrief([point(0, 0, 1.5), point(0.00001, 600_000, 2)]);
    expect(debrief?.underwaySeconds).toBe(0);
    expect(debrief?.stoppedSeconds).toBe(600);
    expect(debrief?.avgUnderwaySog).toBe(0);
    expect(debrief?.maxUnderwaySog).toBe(0);
    expect(debrief?.longestLeg).toBeUndefined();
    expect(debrief?.distanceMeters).toBeCloseTo(metersBetween(0, 0.00001), 6);
  });

  it('splits continuous legs at stops and keeps the one covering the most distance', () => {
    const debrief = computePassageDebrief([
      point(0, 0, 2),
      point(0.01, 600_000, 2),
      point(0.01001, 1_800_000, 0.1),
      point(0.03, 2_400_000, 4),
    ]);
    expect(debrief?.underwaySeconds).toBe(1200);
    expect(debrief?.stoppedSeconds).toBe(1200);
    expect(debrief?.longestLeg).toMatchObject({ startMs: 1_800_000, endMs: 2_400_000 });
    expect(debrief?.longestLeg?.distanceMeters).toBeCloseTo(metersBetween(0.01001, 0.03), 6);
  });

  it('never bridges a recording gap with distance, time, or a continuous leg', () => {
    const debrief = computePassageDebrief([
      point(0, 0, 2),
      point(0.01, 600_000, 2),
      point(0.05, 1_200_000, 2, true),
      point(0.07, 1_800_000, 2),
    ]);
    expect(debrief?.distanceMeters).toBeCloseTo(
      metersBetween(0, 0.01) + metersBetween(0.05, 0.07),
      6,
    );
    // The dropout leg's ten minutes belong to neither bucket.
    expect(debrief?.underwaySeconds).toBe(1200);
    expect(debrief?.stoppedSeconds).toBe(0);
    expect(debrief?.totalSeconds).toBe(1800);
    expect(debrief?.longestLeg).toMatchObject({ startMs: 1_200_000, endMs: 1_800_000 });
  });

  it('skips a non-advancing timestamp instead of dividing by zero', () => {
    const debrief = computePassageDebrief([point(0, 0, 2), point(0.01, 0, 2)]);
    expect(debrief?.distanceMeters).toBe(0);
    expect(debrief?.underwaySeconds).toBe(0);
    expect(debrief?.stoppedSeconds).toBe(0);
    expect(debrief?.longestLeg).toBeUndefined();
  });
});

describe('debriefReady', () => {
  const base: PassageDebrief = {
    startMs: 0,
    endMs: 0,
    totalSeconds: DEBRIEF_MIN_DURATION_SECONDS,
    underwaySeconds: 0,
    stoppedSeconds: 0,
    distanceMeters: DEBRIEF_MIN_DISTANCE_METERS,
    avgUnderwaySog: 0,
    maxUnderwaySog: 0,
    longestLeg: undefined,
  };

  it('requires both the duration and the distance floors, inclusive', () => {
    expect(debriefReady(base)).toBe(true);
    expect(debriefReady({ ...base, totalSeconds: DEBRIEF_MIN_DURATION_SECONDS - 1 })).toBe(false);
    expect(debriefReady({ ...base, distanceMeters: DEBRIEF_MIN_DISTANCE_METERS - 1 })).toBe(false);
  });

  it('states the distance floor as a quarter of a nautical mile', () => {
    expect(DEBRIEF_MIN_DISTANCE_METERS).toBe(METERS_PER_NAUTICAL_MILE / 4);
  });
});
