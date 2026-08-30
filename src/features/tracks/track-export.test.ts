import { describe, expect, it } from 'vitest';
import type { TrackPoint } from '$entities/track';
import {
  toGeoJsonFeature,
  toGeoJsonFeatureFromSegments,
  toGeoJsonString,
  trackGeoJsonFilename,
} from './track-export';

const p = (lat: number, lon: number, gap?: boolean): TrackPoint => ({
  lat,
  lon,
  t: 0,
  sog: 1,
  gap,
});

const tp = (lat: number, lon: number, t: number, gap?: boolean): TrackPoint => ({
  lat,
  lon,
  t,
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

describe('coordTimes persistence', () => {
  const t0 = Date.parse('2026-08-29T10:00:00.000Z');

  it('mirrors the MultiLineString coordinates with RFC 3339 stamps, one array per segment', () => {
    const feature = toGeoJsonFeature('Voyage', [
      tp(1, 2, t0),
      tp(3, 4, t0 + 10_000),
      tp(5, 6, t0 + 400_000, true),
      tp(7, 8, t0 + 410_000),
    ]);
    expect(feature.properties?.coordTimes).toEqual([
      ['2026-08-29T10:00:00.000Z', '2026-08-29T10:00:10.000Z'],
      ['2026-08-29T10:06:40.000Z', '2026-08-29T10:06:50.000Z'],
    ]);
  });

  it('drops a degenerate segment from the times exactly as from the coordinates', () => {
    const feature = toGeoJsonFeature('x', [
      tp(1, 2, t0),
      tp(3, 4, t0 + 1_000, true),
      tp(5, 6, t0 + 2_000, true),
      tp(7, 8, t0 + 3_000),
    ]);
    const geometry = feature.geometry as GeoJSON.MultiLineString;
    expect(geometry.coordinates).toHaveLength(1);
    expect(feature.properties?.coordTimes).toEqual([
      ['2026-08-29T10:00:02.000Z', '2026-08-29T10:00:03.000Z'],
    ]);
  });

  it('omits coordTimes entirely when any kept point is untimed', () => {
    const feature = toGeoJsonFeature('x', [tp(1, 2, t0), p(3, 4)]);
    expect(feature.properties).toEqual({ name: 'x', source: 'binnacle' });
  });
});

describe('toGeoJsonFeatureFromSegments', () => {
  it('matches toGeoJsonFeature over the equivalent flat, gap-marked point list', () => {
    const flat = toGeoJsonFeature('Voyage', [p(1, 2), p(3, 4), p(5, 6, true), p(7, 8)]);
    const segments = toGeoJsonFeatureFromSegments('Voyage', [
      [p(1, 2), p(3, 4)],
      [p(5, 6), p(7, 8)],
    ]);
    expect(segments).toEqual(flat);
  });

  it('drops single-point segments to keep valid GeoJSON', () => {
    const feature = toGeoJsonFeatureFromSegments('x', [[p(1, 2)], [p(3, 4)], [p(5, 6), p(7, 8)]]);
    expect(feature.geometry).toEqual({
      type: 'MultiLineString',
      coordinates: [
        [
          [6, 5],
          [8, 7],
        ],
      ],
    });
  });
});
