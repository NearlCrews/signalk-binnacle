import type { Map as MapLibreMap, SourceSpecification } from 'maplibre-gl';
import { describe, expect, it, vi } from 'vitest';
import { createFakeMap } from '$shared/testing';
import {
  ensureGeoJsonSource,
  ensureGeoJsonSources,
  ensureSource,
  getPaintProp,
  removeLayersAndSources,
  removeSharedSourceIfOrphaned,
  setLayersVisibility,
  setPaintProp,
  setSourceData,
} from './overlay-helpers';

const fakeMap = () => createFakeMap() as unknown as MapLibreMap & ReturnType<typeof createFakeMap>;

const point: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [1, 2] }, properties: {} }],
};

describe('ensureGeoJsonSource', () => {
  it('adds an empty collection when the source is absent', () => {
    const map = fakeMap();
    ensureGeoJsonSource(map, 'src');
    expect(map.sources.get('src')?.data).toEqual({ type: 'FeatureCollection', features: [] });
  });

  it('leaves an existing source and its features in place, so a re-add does not blank it', () => {
    const map = fakeMap();
    ensureGeoJsonSource(map, 'src');
    setSourceData(map, 'src', point);
    ensureGeoJsonSource(map, 'src');
    expect(map.sources.get('src')?.data).toEqual(point);
  });
});

describe('ensureGeoJsonSources', () => {
  it('guard-adds every id', () => {
    const map = fakeMap();
    ensureGeoJsonSources(map, ['a', 'b']);
    expect([...map.sources.keys()]).toEqual(['a', 'b']);
  });

  it('accepts an empty list', () => {
    const map = fakeMap();
    ensureGeoJsonSources(map, []);
    expect(map.sources.size).toBe(0);
  });
});

describe('setSourceData', () => {
  it('pushes data into the named source', () => {
    const map = fakeMap();
    ensureGeoJsonSource(map, 'src');
    setSourceData(map, 'src', point);
    expect(map.sources.get('src')?.data).toEqual(point);
  });

  it('is a no-op on a missing source, so a sync after remove does not throw', () => {
    const map = fakeMap();
    expect(() => setSourceData(map, 'gone', point)).not.toThrow();
  });
});

describe('setLayersVisibility', () => {
  it('sets visibility on every present layer', () => {
    const map = fakeMap();
    map.addLayer({ id: 'a' });
    map.addLayer({ id: 'b' });
    setLayersVisibility(map, ['a', 'b'], false);
    expect(map.setLayoutProperty).toHaveBeenCalledWith('a', 'visibility', 'none');
    expect(map.setLayoutProperty).toHaveBeenCalledWith('b', 'visibility', 'none');
    setLayersVisibility(map, ['a'], true);
    expect(map.setLayoutProperty).toHaveBeenCalledWith('a', 'visibility', 'visible');
  });

  it('skips a layer that is not attached, so a caller can pass its full layer set', () => {
    const map = fakeMap();
    map.addLayer({ id: 'a' });
    setLayersVisibility(map, ['a', 'not-added'], true);
    expect(map.setLayoutProperty).toHaveBeenCalledTimes(1);
    expect(map.setLayoutProperty).toHaveBeenCalledWith('a', 'visibility', 'visible');
  });
});

describe('removeLayersAndSources', () => {
  it('removes layers before sources', () => {
    const map = fakeMap();
    const order: string[] = [];
    const removeLayer = vi.fn((id: string) => {
      order.push(`layer:${id}`);
      return map;
    });
    const removeSource = vi.fn((id: string) => {
      order.push(`source:${id}`);
      return map;
    });
    map.addSource('src', { type: 'geojson' });
    map.addLayer({ id: 'a' });
    const spied = { ...map, removeLayer, removeSource } as unknown as MapLibreMap;
    removeLayersAndSources(spied, ['a'], ['src']);
    expect(order).toEqual(['layer:a', 'source:src']);
  });

  it('tolerates layers and sources that are already gone', () => {
    const map = fakeMap();
    expect(() => removeLayersAndSources(map, ['a'], ['src'])).not.toThrow();
  });
});

describe('setPaintProp and getPaintProp', () => {
  it('passes a dynamically named property straight through to the map', () => {
    const map = fakeMap();
    setPaintProp(map, 'a', 'line-color', '#ff0000');
    expect(map.setPaintProperty).toHaveBeenCalledWith('a', 'line-color', '#ff0000');
  });

  it('reads a dynamically named property back', () => {
    const getPaintProperty = vi.fn(() => '#00ff00');
    const map = { ...fakeMap(), getPaintProperty } as unknown as MapLibreMap;
    expect(getPaintProp(map, 'a', 'line-color')).toBe('#00ff00');
    expect(getPaintProperty).toHaveBeenCalledWith('a', 'line-color');
  });
});

describe('ensureSource', () => {
  const TILES = ['https://example.com/{z}/{x}/{y}.pbf'];
  const spec = (): SourceSpecification => ({ type: 'vector', tiles: [...TILES] });

  it('adds the source when absent', () => {
    const map = fakeMap();
    ensureSource(map, 'shared', spec());
    expect(map.sources.get('shared')?.tiles).toEqual(TILES);
  });

  it('is idempotent, so two overlays sharing one source can both call it', () => {
    const map = fakeMap();
    ensureSource(map, 'shared', spec());
    ensureSource(map, 'shared', {
      type: 'vector',
      tiles: ['https://other.example.com/{z}/{x}/{y}.pbf'],
    });
    expect(map.sources.get('shared')?.tiles).toEqual(TILES);
    expect(map.sources.size).toBe(1);
  });
});

describe('removeSharedSourceIfOrphaned', () => {
  it('keeps the source while a sibling layer still references it', () => {
    const map = fakeMap();
    map.addSource('shared', { type: 'vector' });
    map.addLayer({ id: 'sibling' });
    removeSharedSourceIfOrphaned(map, 'shared', ['sibling']);
    expect(map.getSource('shared')).toBeTruthy();
  });

  it('removes the source once every sibling layer is gone', () => {
    const map = fakeMap();
    map.addSource('shared', { type: 'vector' });
    removeSharedSourceIfOrphaned(map, 'shared', ['sibling']);
    expect(map.getSource('shared')).toBeUndefined();
  });

  it('is a no-op when the source is already removed', () => {
    const map = fakeMap();
    expect(() => removeSharedSourceIfOrphaned(map, 'shared', [])).not.toThrow();
  });
});
