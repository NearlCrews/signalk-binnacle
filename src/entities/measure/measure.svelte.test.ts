import { describe, expect, it } from 'vitest';
import { MAX_MEASURE_POINTS, MeasureStore } from './measure.svelte';

const A = { latitude: 0, longitude: 0 };
const B = { latitude: 0.001, longitude: 0 };
const C = { latitude: 0.002, longitude: 0 };

describe('MeasureStore', () => {
  it('ignores taps while not armed', () => {
    const measure = new MeasureStore();
    measure.add(A);
    expect(measure.vertices).toHaveLength(0);
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
    expect(measure.vertices).toHaveLength(1);
    measure.clear();
    expect(measure.vertices).toHaveLength(0);
    expect(measure.active).toBe(true);
  });

  it('moves a middle point, recomputes adjacent legs, and undoes the completed operation', () => {
    const measure = new MeasureStore();
    measure.start();
    measure.add(A);
    measure.add(B);
    measure.add({ latitude: 0.001, longitude: 0.001 });
    const priorTotal = measure.totalMeters;
    expect(measure.selectIndex(1)).toBe(true);
    const selectedId = measure.selectedId;
    expect(measure.moveSelected({ latitude: 0.0005, longitude: 0.002 })).toBe(true);
    expect(measure.selectedId).toBe(selectedId);
    expect(measure.vertices[1].position).toEqual({ latitude: 0.0005, longitude: 0.002 });
    expect(measure.legs).toHaveLength(2);
    expect(measure.totalMeters).not.toBeCloseTo(priorTotal, 5);

    measure.undo();
    expect(measure.vertices[1].position).toEqual(B);
    expect(measure.totalMeters).toBeCloseTo(priorTotal, 5);
    measure.undo();
    expect(measure.vertices).toHaveLength(2);
  });

  it('deletes and restores a middle point with the same stable id and index', () => {
    const measure = new MeasureStore();
    measure.start();
    measure.add(A);
    measure.add(B);
    measure.add(C);
    expect(measure.selectIndex(1)).toBe(true);
    const selectedId = measure.selectedId;
    expect(measure.deleteSelected()).toBe(true);
    expect(measure.vertices.map((vertex) => vertex.position)).toEqual([A, C]);
    expect(measure.legs).toHaveLength(1);

    measure.undo();
    expect(measure.vertices.map((vertex) => vertex.position)).toEqual([A, B, C]);
    expect(measure.vertices[1].id).toBe(selectedId);
    expect(measure.selectedIndex).toBe(1);
  });

  it('deletes endpoints and the sole point, then leaves Undo available', () => {
    const measure = new MeasureStore();
    measure.start();
    measure.add(A);
    expect(measure.selectIndex(0)).toBe(true);
    expect(measure.deleteSelected()).toBe(true);
    expect(measure.isEmpty).toBe(true);
    expect(measure.canUndo).toBe(true);
    measure.undo();
    expect(measure.vertices.map((vertex) => vertex.position)).toEqual([A]);

    measure.add(B);
    measure.selectIndex(0);
    expect(measure.deleteSelected()).toBe(true);
    expect(measure.vertices.map((vertex) => vertex.position)).toEqual([B]);
  });

  it('rejects moves that are invalid or duplicate an adjacent point without adding history', () => {
    const measure = new MeasureStore();
    measure.start();
    measure.add(A);
    measure.add(B);
    measure.add(C);
    measure.selectIndex(1);
    expect(measure.moveSelected(A)).toBe(false);
    expect(measure.moveSelected(C)).toBe(false);
    expect(measure.moveSelected({ latitude: Number.NaN, longitude: 0 })).toBe(false);
    expect(measure.vertices.map((vertex) => vertex.position)).toEqual([A, B, C]);
    measure.undo();
    expect(measure.vertices.map((vertex) => vertex.position)).toEqual([A, B]);
  });

  it('rejects deletion when it would join duplicate neighbors', () => {
    const measure = new MeasureStore();
    measure.start();
    measure.add(A);
    measure.add(B);
    measure.add(A);
    measure.selectIndex(1);
    expect(measure.canDeleteSelected).toBe(false);
    expect(measure.deleteSelected()).toBe(false);
    expect(measure.vertices.map((vertex) => vertex.position)).toEqual([A, B, A]);
  });

  it('previews and cancels a move without changing the committed measurement or history', () => {
    const measure = new MeasureStore();
    measure.start();
    measure.add(A);
    measure.add(B);
    measure.selectIndex(1);
    expect(measure.armMove()).toBe(true);
    expect(measure.previewSelected({ latitude: 0.001, longitude: 0.001 })).toBe(true);
    expect(measure.displayVertices[1].position).toEqual({ latitude: 0.001, longitude: 0.001 });
    expect(measure.vertices[1].position).toEqual(B);
    measure.cancelMove();
    expect(measure.displayVertices).toBe(measure.vertices);
    measure.undo();
    expect(measure.vertices.map((vertex) => vertex.position)).toEqual([A]);
  });

  // The overlay reads these on every tick of the shared overlay clock and skips its repaint when
  // the identity is unchanged, so a repeated read during an armed move must not allocate again.
  it('holds the display memo across repeated reads outside a reactive context', () => {
    const measure = new MeasureStore();
    measure.start();
    measure.add(A);
    measure.add(B);
    measure.selectIndex(1);
    measure.armMove();
    measure.previewSelected({ latitude: 0.001, longitude: 0.001 });

    const vertices = measure.displayVertices;
    const legs = measure.displayLegs;
    expect(measure.displayVertices).toBe(vertices);
    expect(measure.displayLegs).toBe(legs);

    measure.previewSelected({ latitude: 0.002, longitude: 0.002 });
    expect(measure.displayVertices).not.toBe(vertices);
    expect(measure.displayVertices[1].position).toEqual({ latitude: 0.002, longitude: 0.002 });

    measure.cancelMove();
    expect(measure.displayVertices).toBe(measure.vertices);
  });

  it('accepts a seed point immediately after arming, the "Measure from here" contract', () => {
    const measure = new MeasureStore();
    measure.start();
    measure.add(A);
    expect(measure.vertices).toHaveLength(1);
    expect(measure.vertices[0].position).toEqual(A);
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
    expect(measure.vertices).toHaveLength(1);
    expect(measure.vertices[0].position).toEqual(C);
  });

  it('does not reuse vertex ids across measurement sessions', () => {
    const measure = new MeasureStore();
    measure.start();
    measure.add(A);
    const priorId = measure.vertices[0].id;

    measure.start();
    measure.add(B);

    expect(measure.vertices[0].id).not.toBe(priorId);
  });

  it('start gives a clean slate and stop clears everything', () => {
    const measure = new MeasureStore();
    measure.start();
    measure.add(A);
    measure.stop();
    expect(measure.active).toBe(false);
    expect(measure.vertices).toHaveLength(0);
    measure.start();
    expect(measure.vertices).toHaveLength(0);
    expect(measure.canUndo).toBe(false);
    expect(measure.selectedId).toBeUndefined();
    expect(measure.moveArmed).toBe(false);
  });

  it('rejects invalid and duplicate consecutive points', () => {
    const measure = new MeasureStore();
    measure.start();
    expect(measure.add({ latitude: Number.NaN, longitude: 0 })).toBe(false);
    expect(measure.add({ latitude: 91, longitude: 0 })).toBe(false);
    expect(measure.add(A)).toBe(true);
    expect(measure.add(A)).toBe(false);
    expect(measure.vertices.map((vertex) => vertex.position)).toEqual([A]);
  });

  it('caps the number of points and accepts more after undo', () => {
    const measure = new MeasureStore();
    measure.start();
    for (let index = 0; index < MAX_MEASURE_POINTS; index += 1) {
      expect(measure.add({ latitude: 0, longitude: index / 10_000 })).toBe(true);
    }
    expect(measure.atLimit).toBe(true);
    expect(measure.add({ latitude: 1, longitude: 1 })).toBe(false);
    measure.selectIndex(Math.floor(MAX_MEASURE_POINTS / 2));
    expect(measure.moveSelected({ latitude: 1, longitude: 2 })).toBe(true);
    expect(measure.deleteSelected()).toBe(true);
    expect(measure.atLimit).toBe(false);
    measure.undo();
    expect(measure.atLimit).toBe(true);
    measure.undo();
    expect(measure.atLimit).toBe(true);
    measure.undo();
    expect(measure.atLimit).toBe(false);
    expect(measure.add({ latitude: 1, longitude: 1 })).toBe(true);
  });

  it('copies accepted points and replaces the collection identity', () => {
    const measure = new MeasureStore();
    const point = { ...A };
    measure.start();
    const initial = measure.vertices;
    measure.add(point);
    const afterFirst = measure.vertices;
    measure.add(B);
    expect(afterFirst).not.toBe(initial);
    expect(measure.vertices).not.toBe(afterFirst);
    point.latitude = 10;
    expect(measure.vertices[0].position).toEqual(A);
  });
});
