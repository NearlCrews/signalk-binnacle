import { describe, expect, it } from 'vitest';
import { MAX_MEASURE_POINTS, MeasureStore } from './measure.svelte';

const A = { latitude: 0, longitude: 0 };
const B = { latitude: 0.001, longitude: 0 };
const C = { latitude: 0.002, longitude: 0 };

describe('MeasureStore', () => {
  it('ignores taps while not armed', () => {
    const measure = new MeasureStore();
    measure.add(A);
    expect(measure.points).toHaveLength(0);
  });

  it('collects points and derives legs with range and bearing', () => {
    const measure = new MeasureStore();
    measure.start();
    measure.add(A);
    measure.add(B);
    expect(measure.legs).toHaveLength(1);
    expect(measure.legs[0].distanceMeters).toBeCloseTo(111.19, 0);
    // Due north.
    expect((measure.legs[0].bearingRad * 180) / Math.PI).toBeCloseTo(0, 5);
  });

  it('sums the legs into the running total', () => {
    const measure = new MeasureStore();
    measure.start();
    measure.add(A);
    measure.add(B);
    measure.add(C);
    expect(measure.legs).toHaveLength(2);
    expect(measure.totalMeters).toBeCloseTo(222.39, 0);
    expect(measure.lastLeg?.to).toEqual(C);
  });

  it('undo removes the last point, clear removes them all, both keep the tool armed', () => {
    const measure = new MeasureStore();
    measure.start();
    measure.add(A);
    measure.add(B);
    measure.undo();
    expect(measure.points).toHaveLength(1);
    measure.clear();
    expect(measure.points).toHaveLength(0);
    expect(measure.active).toBe(true);
  });

  it('accepts a seed point immediately after arming, the "Measure from here" contract', () => {
    const measure = new MeasureStore();
    measure.start();
    measure.add(A);
    expect(measure.points).toHaveLength(1);
    expect(measure.points[0]).toEqual(A);
  });

  it('re-arming mid-measurement is a deliberate destructive reset', () => {
    // "Measure from here" means "start a fresh measurement"; extending an in-progress one is a
    // plain chart tap. A future guard that preserves points on start() would change that contract.
    const measure = new MeasureStore();
    measure.start();
    measure.add(A);
    measure.add(B);
    measure.start();
    measure.add(C);
    expect(measure.points).toHaveLength(1);
    expect(measure.points[0]).toEqual(C);
  });

  it('start gives a clean slate and stop clears everything', () => {
    const measure = new MeasureStore();
    measure.start();
    measure.add(A);
    measure.stop();
    expect(measure.active).toBe(false);
    expect(measure.points).toHaveLength(0);
    measure.start();
    expect(measure.points).toHaveLength(0);
  });

  it('rejects invalid and duplicate consecutive points', () => {
    const measure = new MeasureStore();
    measure.start();
    expect(measure.add({ latitude: Number.NaN, longitude: 0 })).toBe(false);
    expect(measure.add({ latitude: 91, longitude: 0 })).toBe(false);
    expect(measure.add(A)).toBe(true);
    expect(measure.add(A)).toBe(false);
    expect(measure.points).toEqual([A]);
  });

  it('caps the number of points and accepts more after undo', () => {
    const measure = new MeasureStore();
    measure.start();
    for (let index = 0; index < MAX_MEASURE_POINTS; index += 1) {
      expect(measure.add({ latitude: 0, longitude: index / 10_000 })).toBe(true);
    }
    expect(measure.atLimit).toBe(true);
    expect(measure.add({ latitude: 1, longitude: 1 })).toBe(false);
    measure.undo();
    expect(measure.atLimit).toBe(false);
    expect(measure.add({ latitude: 1, longitude: 1 })).toBe(true);
  });

  it('copies accepted points and replaces the collection identity', () => {
    const measure = new MeasureStore();
    const point = { ...A };
    measure.start();
    const initial = measure.points;
    measure.add(point);
    const afterFirst = measure.points;
    measure.add(B);
    expect(afterFirst).not.toBe(initial);
    expect(measure.points).not.toBe(afterFirst);
    point.latitude = 10;
    expect(measure.points[0]).toEqual(A);
  });
});
