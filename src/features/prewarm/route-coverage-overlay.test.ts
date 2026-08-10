import type { Map as MapLibreMap } from 'maplibre-gl';
import { describe, expect, it } from 'vitest';
import { createFakeMap } from '$shared/testing';
import { createCoverageHighlight } from './route-coverage-overlay';

const asMap = (fake: object): MapLibreMap => fake as MapLibreMap;

const gap: GeoJSON.Feature = {
  type: 'Feature',
  geometry: {
    type: 'LineString',
    coordinates: [
      [0, 0],
      [1, 0],
    ],
  },
  properties: { kind: 'uncovered' },
};

describe('coverage highlight', () => {
  it('adds its layer once, sets and clears gap features, and tears down', () => {
    const map = createFakeMap();
    const highlight = createCoverageHighlight(asMap(map));
    expect(map.getLayer('binnacle-route-coverage-line')).toBeTruthy();
    const layerCount = map.layers.size;
    createCoverageHighlight(asMap(map));
    expect(map.layers.size).toBe(layerCount);

    highlight.set([gap]);
    const fc = map.sources.get('binnacle-route-coverage')?.data as GeoJSON.FeatureCollection;
    expect(fc.features).toHaveLength(1);
    highlight.clear();
    const cleared = map.sources.get('binnacle-route-coverage')?.data as GeoJSON.FeatureCollection;
    expect(cleared.features).toHaveLength(0);

    highlight.destroy();
    expect(map.getLayer('binnacle-route-coverage-line')).toBeUndefined();
    expect(map.sources.has('binnacle-route-coverage')).toBe(false);
  });
});
