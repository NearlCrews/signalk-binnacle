import { describe, expect, it } from 'vitest';
import {
  type Bbox4,
  bboxCenter,
  bboxContains,
  bboxContainsPoint,
  boundsOfPoints,
  normalizeBounds,
  padBbox,
  splitAtAntimeridian,
} from './bounds';

describe('bboxContainsPoint', () => {
  const box: [number, number, number, number] = [-10, -5, 10, 5];
  it('is true for a point inside, including on an edge', () => {
    expect(bboxContainsPoint(box, { latitude: 0, longitude: 0 })).toBe(true);
    expect(bboxContainsPoint(box, { latitude: 5, longitude: -10 })).toBe(true);
  });
  it('is false for a point outside in either axis', () => {
    expect(bboxContainsPoint(box, { latitude: 0, longitude: 11 })).toBe(false);
    expect(bboxContainsPoint(box, { latitude: -6, longitude: 0 })).toBe(false);
  });
});

describe('normalizeBounds', () => {
  it('passes a normal box straight through', () => {
    expect(normalizeBounds([-122, 36, -121, 37])).toEqual([
      [-122, 36],
      [-121, 37],
    ]);
  });

  it('rejects a box with any non-finite coordinate', () => {
    expect(normalizeBounds([Number.NaN, 0, 1, 1])).toBeNull();
    expect(normalizeBounds([0, 0, Number.POSITIVE_INFINITY, 1])).toBeNull();
  });

  it('rejects an inverted box with south above north', () => {
    expect(normalizeBounds([-122, 37, -121, 36])).toBeNull();
  });

  it('fits an antimeridian-crossing box by unwrapping east past west', () => {
    const corners = normalizeBounds([170, 0, -170, 10]);
    expect(corners).not.toBeNull();
    const [[w], [e]] = corners as [[number, number], [number, number]];
    expect(w).toBe(170);
    expect(e).toBe(190);
    expect(e).toBeGreaterThan(w);
  });

  it('pads a zero-area point box so it has a real extent', () => {
    const corners = normalizeBounds([5, 5, 5, 5]);
    expect(corners).not.toBeNull();
    const [[w, s], [e, n]] = corners as [[number, number], [number, number]];
    expect(w).toBeLessThan(5);
    expect(e).toBeGreaterThan(5);
    expect(s).toBeLessThan(5);
    expect(n).toBeGreaterThan(5);
  });
});

describe('bboxCenter', () => {
  it('returns the center of a normal box', () => {
    expect(bboxCenter([-10, 20, 10, 40])).toEqual({ latitude: 30, longitude: 0 });
  });

  it('uses the short span for an antimeridian-crossing box', () => {
    expect(bboxCenter([170, -10, -170, 10])).toEqual({ latitude: 0, longitude: 180 });
  });
});

describe('boundsOfPoints', () => {
  it('returns undefined for an empty set', () => {
    expect(boundsOfPoints([])).toBeUndefined();
  });

  it('encloses a normal set with west below east', () => {
    expect(
      boundsOfPoints([
        { latitude: 36, longitude: -122 },
        { latitude: 37, longitude: -121 },
      ]),
    ).toEqual([-122, 36, -121, 37]);
  });

  it('returns a west > east crossing box for an antimeridian-straddling set', () => {
    // 179 and -179 are 2 degrees apart across the seam, not 358 the long way around.
    expect(
      boundsOfPoints([
        { latitude: 0, longitude: 179 },
        { latitude: 10, longitude: -179 },
      ]),
    ).toEqual([179, 0, -179, 10]);
  });

  it('keeps the naive box for a wide non-crossing set', () => {
    // -10 to 10 is 20 degrees the direct way, narrower than crossing the seam, so no wrap.
    expect(
      boundsOfPoints([
        { latitude: 0, longitude: -10 },
        { latitude: 0, longitude: 10 },
      ]),
    ).toEqual([-10, 0, 10, 0]);
  });
});

describe('padBbox', () => {
  it('pads a normal box outward by the fraction', () => {
    expect(padBbox([0, 0, 10, 20], 0.1)).toEqual([-1, -2, 11, 22]);
  });

  it('pads an antimeridian-crossing box across the seam', () => {
    // The span is 20 degrees the short way (170 east across 180 to -170), so 0.1 pads 2 a side.
    const padded = padBbox([170, 0, -170, 10], 0.1);
    expect(padded[0]).toBeCloseTo(168);
    expect(padded[2]).toBeCloseTo(-168);
    // Still a crossing box (west > east), which normalizeBounds unwraps for the fit.
    expect(padded[0]).toBeGreaterThan(padded[2]);
  });

  it('keeps an unwrapped east edge unwrapped so the coverage check can succeed', () => {
    // What MapLibre reports for a viewport sitting on the antimeridian. Clamping the padded east
    // back to 180 made bboxContains fail against this viewport on every move.
    const viewport: Bbox4 = [170, 0, 190, 10];
    const padded = padBbox(viewport, 0.5);
    expect(padded).toEqual([160, -5, 200, 15]);
    expect(bboxContains(padded, viewport)).toBe(true);
  });

  it('keeps an unwrapped west edge unwrapped', () => {
    const viewport: Bbox4 = [-190, 0, -170, 10];
    const padded = padBbox(viewport, 0.5);
    expect(padded).toEqual([-200, -5, -160, 15]);
    expect(bboxContains(padded, viewport)).toBe(true);
  });

  it('still clamps latitude to the Web Mercator limit', () => {
    const padded = padBbox([0, -84, 10, 84], 0.5);
    expect(padded[1]).toBe(-85);
    expect(padded[3]).toBe(85);
  });
});

describe('splitAtAntimeridian', () => {
  it('passes an in-range box through as one request box', () => {
    expect(splitAtAntimeridian([10, 0, 20, 5])).toEqual([[10, 0, 20, 5]]);
  });

  it('passes the exact world edges through untouched', () => {
    expect(splitAtAntimeridian([-180, -85, 180, 85])).toEqual([[-180, -85, 180, 85]]);
  });

  it('cuts an unwrapped east edge into two in-range boxes at the seam', () => {
    expect(splitAtAntimeridian([160, -5, 200, 15])).toEqual([
      [160, -5, 180, 15],
      [-180, -5, -160, 15],
    ]);
  });

  it('cuts an unwrapped west edge into two in-range boxes at the seam', () => {
    expect(splitAtAntimeridian([-200, -5, -160, 15])).toEqual([
      [160, -5, 180, 15],
      [-180, -5, -160, 15],
    ]);
  });

  it('collapses a box wider than the world to the whole world', () => {
    expect(splitAtAntimeridian([-400, -10, 400, 10])).toEqual([[-180, -10, 180, 10]]);
  });

  it('rewraps a wholly out-of-range box that does not actually cross the seam', () => {
    expect(splitAtAntimeridian([190, 0, 200, 5])).toEqual([[-170, 0, -160, 5]]);
  });

  it('yields no request box for a non-finite input', () => {
    expect(splitAtAntimeridian([Number.NaN, 0, 10, 5])).toEqual([]);
  });

  it('emits only in-range longitudes for every padded viewport at the seam', () => {
    for (const west of [170, 175, 178, -190, -185]) {
      for (const box of splitAtAntimeridian(padBbox([west, 0, west + 6, 10], 0.5))) {
        expect(box[0]).toBeGreaterThanOrEqual(-180);
        expect(box[2]).toBeLessThanOrEqual(180);
        expect(box[0]).toBeLessThanOrEqual(box[2]);
      }
    }
  });
});
