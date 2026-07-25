import { describe, expect, it } from 'vitest';
import { headingLineFeature, rangeRingFeatures } from './radar-vectors';

describe('rangeRingFeatures', () => {
  it('produces one closed ring per requested ring', () => {
    const fc = rangeRingFeatures({ latitude: 0, longitude: 0 }, 3000, 3);
    expect(fc.features).toHaveLength(3);
    const ring = fc.features[0].geometry as GeoJSON.LineString;
    expect(ring.coordinates[0]).toEqual(ring.coordinates[ring.coordinates.length - 1]);
  });

  it('splits rings at the antimeridian instead of drawing across the world', () => {
    const fc = rangeRingFeatures({ latitude: 0, longitude: 179.99 }, 3000, 1);
    const ring = fc.features[0].geometry;

    expect(ring.type).toBe('MultiLineString');
    for (const line of (ring as GeoJSON.MultiLineString).coordinates) {
      for (let index = 1; index < line.length; index += 1) {
        expect(Math.abs(line[index][0] - line[index - 1][0])).toBeLessThanOrEqual(180);
      }
    }
  });
});

describe('headingLineFeature', () => {
  it('draws a line from the center outward', () => {
    const f = headingLineFeature({ latitude: 0, longitude: 0 }, 0, 3000);
    const line = f.geometry as GeoJSON.LineString;
    expect(line.coordinates[0]).toEqual([0, 0]);
    expect(line.coordinates[1][1]).toBeGreaterThan(0);
    expect(Math.abs(line.coordinates[1][0])).toBeLessThan(1e-6);
  });

  it('splits a heading line that crosses the antimeridian', () => {
    const feature = headingLineFeature({ latitude: 0, longitude: 179.99 }, Math.PI / 2, 3000);

    expect(feature.geometry.type).toBe('MultiLineString');
    const lines = (feature.geometry as GeoJSON.MultiLineString).coordinates;
    expect(lines[0].at(-1)?.[0]).toBe(180);
    expect(lines[1][0][0]).toBe(-180);
  });
});
