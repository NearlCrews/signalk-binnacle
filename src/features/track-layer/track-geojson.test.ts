import { describe, expect, it } from 'vitest';
import type { TrackPoint } from '$entities/track';
import { trackSegments } from './track-geojson';

const p = (lon: number, sog: number, gap?: boolean): TrackPoint => ({
  lat: 0,
  lon,
  t: 0,
  sog,
  gap,
});

describe('trackSegments', () => {
  it('emits one segment per consecutive pair', () => {
    const fc = trackSegments([p(0, 1), p(0.001, 2), p(0.002, 3)]);
    expect(fc.features).toHaveLength(2);
    expect(fc.features[0].properties).toEqual({ sog: 2 });
    expect(fc.features[1].properties).toEqual({ sog: 3 });
  });

  it('skips the segment across a gap', () => {
    const fc = trackSegments([p(0, 1), p(1, 2, true), p(1.001, 3)]);
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].properties).toEqual({ sog: 3 });
  });

  it('splits a crossing fix pair at the antimeridian', () => {
    const geometry = trackSegments([p(179, 1), p(-179, 2)]).features[0].geometry;
    expect(geometry).toEqual({
      type: 'MultiLineString',
      coordinates: [
        [
          [179, 0],
          [180, 0],
        ],
        [
          [-180, 0],
          [-179, 0],
        ],
      ],
    });
  });
});
