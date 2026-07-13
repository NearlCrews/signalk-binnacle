import { describe, expect, it } from 'vitest';
import type { TrackPoint } from '$entities/track';
import { toGeoJsonString, trackGeoJsonFilename } from './track-export';

const p = (lat: number, lon: number, gap?: boolean): TrackPoint => ({
  lat,
  lon,
  t: 0,
  sog: 1,
  gap,
});

describe('trackGeoJsonFilename', () => {
  it('creates a portable bounded filename', () => {
    expect(trackGeoJsonFilename(' Port/Starboard?.. ')).toBe('Port-Starboard-.geojson');
    expect(trackGeoJsonFilename('x'.repeat(200))).toHaveLength(128);
    expect(trackGeoJsonFilename('...')).toBe('track.geojson');
  });
});

describe('toGeoJsonString', () => {
  it('serializes a MultiLineString Feature split at gaps', () => {
    const feature = JSON.parse(
      toGeoJsonString('Voyage', [p(1, 2), p(3, 4), p(5, 6, true), p(7, 8)]),
    );
    expect(feature.type).toBe('Feature');
    expect(feature.geometry.type).toBe('MultiLineString');
    expect(feature.geometry.coordinates).toEqual([
      [
        [2, 1],
        [4, 3],
      ],
      [
        [6, 5],
        [8, 7],
      ],
    ]);
    expect(feature.properties.name).toBe('Voyage');
  });

  it('drops single-point segments to keep valid GeoJSON', () => {
    // a and b are each isolated by a following gap, so only the c-d pair forms a line.
    const feature = JSON.parse(
      toGeoJsonString('x', [p(1, 2), p(3, 4, true), p(5, 6, true), p(7, 8)]),
    );
    expect(feature.geometry.coordinates).toEqual([
      [
        [6, 5],
        [8, 7],
      ],
    ]);
  });
});
