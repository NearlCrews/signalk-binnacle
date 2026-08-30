import { describe, expect, it } from 'vitest';
import { COG_MIN_SOG_MPS } from './course-vector';
import {
  blendLonLat,
  createOwnShipReckoner,
  DEAD_RECKONING_CONVERGE_MS,
  DEAD_RECKONING_HORIZON_MS,
  deadReckonedPosition,
  MOTION_SNAP_METERS,
} from './dead-reckoning';
import { geodesicDestination, haversineMeters } from './distance';

const EAST = Math.PI / 2;

describe('deadReckonedPosition', () => {
  it('advances the fix along the course at the given speed', () => {
    const [lon, lat] = deadReckonedPosition(0, 0, EAST, 5, 2_000);
    const [expectedLon, expectedLat] = geodesicDestination(0, 0, EAST, 10);
    expect(lon).toBeCloseTo(expectedLon, 12);
    expect(lat).toBeCloseTo(expectedLat, 12);
  });

  it('returns the fix itself exactly at zero elapsed time', () => {
    expect(deadReckonedPosition(36.8, -121.7, EAST, 5, 0)).toEqual([-121.7, 36.8]);
  });

  it('treats negative elapsed time as zero', () => {
    expect(deadReckonedPosition(36.8, -121.7, EAST, 5, -500)).toEqual([-121.7, 36.8]);
  });

  it('caps the extrapolation at the horizon', () => {
    const atHorizon = deadReckonedPosition(0, 0, EAST, 5, DEAD_RECKONING_HORIZON_MS);
    const past = deadReckonedPosition(0, 0, EAST, 5, DEAD_RECKONING_HORIZON_MS * 4);
    expect(past).toEqual(atHorizon);
  });
});

describe('blendLonLat', () => {
  it('interpolates linearly and clamps the fraction', () => {
    expect(blendLonLat([0, 0], [1, 2], 0.5)).toEqual([0.5, 1]);
    expect(blendLonLat([0, 0], [1, 2], -1)).toEqual([0, 0]);
    expect(blendLonLat([0, 0], [1, 2], 2)).toEqual([1, 2]);
  });

  it('takes the short way across the antimeridian and wraps the result', () => {
    const [lon, lat] = blendLonLat([179.9, 10], [-179.9, 10], 0.5);
    expect(lon).toBeCloseTo(-180, 9);
    expect(lat).toBe(10);
    const [pastLon] = blendLonLat([179.9, 10], [-179.9, 10], 0.75);
    expect(pastLon).toBeCloseTo(-179.95, 9);
  });
});

describe('createOwnShipReckoner', () => {
  const underway = (latitude: number, longitude: number) => ({
    latitude,
    longitude,
    cogRad: EAST,
    sogMps: 5,
  });

  it('reports no position before any fix', () => {
    const reckoner = createOwnShipReckoner();
    expect(reckoner.position(0)).toBeUndefined();
    expect(reckoner.active(0)).toBe(false);
  });

  it('draws the first fix exactly and reckons forward from it', () => {
    const reckoner = createOwnShipReckoner();
    reckoner.accept(underway(0, 0), 1_000);
    expect(reckoner.position(1_000)).toEqual([0, 0]);
    expect(reckoner.position(2_000)).toEqual(deadReckonedPosition(0, 0, EAST, 5, 1_000));
    expect(reckoner.active(2_000)).toBe(true);
  });

  it('holds at the horizon point and goes inactive when the reckoning runs out', () => {
    const reckoner = createOwnShipReckoner();
    reckoner.accept(underway(0, 0), 0);
    const held = reckoner.position(DEAD_RECKONING_HORIZON_MS + 5_000);
    expect(held).toEqual(deadReckonedPosition(0, 0, EAST, 5, DEAD_RECKONING_HORIZON_MS));
    expect(reckoner.active(DEAD_RECKONING_HORIZON_MS + 5_000)).toBe(false);
  });

  it('disables reckoning without course, without speed, and below the speed floor', () => {
    for (const fix of [
      { latitude: 10, longitude: 20, cogRad: undefined, sogMps: 5 },
      { latitude: 10, longitude: 20, cogRad: EAST, sogMps: undefined },
      { latitude: 10, longitude: 20, cogRad: EAST, sogMps: COG_MIN_SOG_MPS / 2 },
    ]) {
      const reckoner = createOwnShipReckoner();
      reckoner.accept(fix, 0);
      expect(reckoner.position(2_000)).toEqual([20, 10]);
      expect(reckoner.active(2_000)).toBe(false);
    }
  });

  it('converges onto the new reckoning over the convergence window', () => {
    const reckoner = createOwnShipReckoner();
    reckoner.accept(underway(0, 0), 0);
    const drawn = reckoner.position(1_000);
    if (!drawn) throw new Error('expected a drawn position');
    // The next fix lands a little off the reckoning, well inside the plausibility bound.
    const next = underway(0.00001, drawn[0]);
    reckoner.accept(next, 1_000);
    const midway = reckoner.position(1_000 + DEAD_RECKONING_CONVERGE_MS / 2);
    if (!midway) throw new Error('expected a drawn position');
    const target = deadReckonedPosition(
      next.latitude,
      next.longitude,
      EAST,
      5,
      DEAD_RECKONING_CONVERGE_MS / 2,
    );
    expect(midway).toEqual(blendLonLat(drawn, target, 0.5));
    // Past the window the drawn position rides the new reckoning exactly.
    const settled = reckoner.position(1_000 + DEAD_RECKONING_CONVERGE_MS);
    expect(settled).toEqual(
      deadReckonedPosition(next.latitude, next.longitude, EAST, 5, DEAD_RECKONING_CONVERGE_MS),
    );
  });

  it('stays active through the convergence window even when reckoning is disabled', () => {
    const reckoner = createOwnShipReckoner();
    reckoner.accept({ latitude: 0, longitude: 0, cogRad: undefined, sogMps: undefined }, 0);
    reckoner.accept({ latitude: 0.0001, longitude: 0, cogRad: undefined, sogMps: undefined }, 500);
    expect(reckoner.active(500)).toBe(true);
    expect(reckoner.position(500 + DEAD_RECKONING_CONVERGE_MS / 2)).toEqual(
      blendLonLat([0, 0], [0, 0.0001], 0.5),
    );
    expect(reckoner.active(500 + DEAD_RECKONING_CONVERGE_MS)).toBe(false);
  });

  it('snaps without convergence when the fix jumps past the plausibility bound', () => {
    const reckoner = createOwnShipReckoner();
    reckoner.accept(underway(0, 0), 0);
    const jumped = underway(1, 1);
    expect(haversineMeters(0, 0, 1, 1)).toBeGreaterThan(MOTION_SNAP_METERS);
    reckoner.accept(jumped, 100);
    expect(reckoner.position(100)).toEqual([1, 1]);
  });

  it('does not converge when the fix repeats the drawn position exactly', () => {
    const reckoner = createOwnShipReckoner();
    const still = { latitude: 36.8, longitude: -121.7, cogRad: undefined, sogMps: undefined };
    reckoner.accept(still, 0);
    reckoner.accept(still, 1_000);
    expect(reckoner.position(1_000)).toEqual([-121.7, 36.8]);
    expect(reckoner.active(1_000)).toBe(false);
  });

  it('reset clears the fix', () => {
    const reckoner = createOwnShipReckoner();
    reckoner.accept(underway(0, 0), 0);
    reckoner.reset();
    expect(reckoner.position(100)).toBeUndefined();
    expect(reckoner.active(100)).toBe(false);
  });
});
