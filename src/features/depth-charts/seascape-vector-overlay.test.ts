import { describe, expect, it, vi } from 'vitest';
import { fakeOverlayContext } from '$shared/testing';
import type { SeascapeVectorSource } from './seascape-sources';
import { createSeascapeVectorOverlay } from './seascape-vector-overlay';

const SOURCE: SeascapeVectorSource = {
  id: 'seascape-vector',
  tiles: ['https://tiles.openwaters.io/seascape/{z}/{x}/{y}.pbf'],
  maxzoom: 14,
  attribution: 'test attribution',
};

function fakeMap() {
  const sources = new Set<string>();
  const layers = new Map<
    string,
    { id: string; type: string; 'source-layer'?: string; layout?: Record<string, unknown> }
  >();
  return {
    sources,
    layers,
    getSource: (id: string) => (sources.has(id) ? {} : undefined),
    addSource: (id: string) => sources.add(id),
    removeSource: (id: string) => sources.delete(id),
    getLayer: (id: string) => layers.get(id),
    addLayer: (layer: {
      id: string;
      type: string;
      'source-layer'?: string;
      layout?: Record<string, unknown>;
    }) => layers.set(layer.id, layer),
    removeLayer: (id: string) => layers.delete(id),
    setPaintProperty: vi.fn(),
  };
}

const ctx = (map: ReturnType<typeof fakeMap>) => fakeOverlayContext(map);

describe('createSeascapeVectorOverlay', () => {
  it('drying is a standalone fill row; contours bundles the line and both symbol layers', () => {
    const { contours, drying } = createSeascapeVectorOverlay(SOURCE);
    expect(drying.id).toBe('seascape-drying');
    expect(drying.parent).toBeUndefined();
    expect(drying.layerIds).toEqual(['seascape-drying-layer']);
    expect(contours.id).toBe('seascape-contours');
    expect(contours.layerIds).toEqual([
      'seascape-contours-line',
      'seascape-contours-label',
      'seascape-soundings-layer',
    ]);
    expect(contours.group).toBeUndefined();
    expect(drying.group).toBeUndefined();
  });

  it('both rows share one vector source, created once', () => {
    const map = fakeMap();
    const { contours, drying } = createSeascapeVectorOverlay(SOURCE);
    drying.add(ctx(map));
    expect(map.sources.has('seascape-vector')).toBe(true);
    contours.add(ctx(map));
    expect(map.sources.size).toBe(1);
    expect(map.layers.get('seascape-drying-layer')?.['source-layer']).toBe('drying');
    expect(map.layers.get('seascape-contours-line')?.['source-layer']).toBe('contours');
    expect(map.layers.get('seascape-soundings-layer')?.['source-layer']).toBe('soundings');
  });

  it('both symbol layers set a text-font the base style actually serves', () => {
    // OpenFreeMap's Liberty style (this app's base map glyph source) only serves Noto Sans;
    // MapLibre's own default text-font 404s against it. A regression here silently falls back
    // to that unset default instead of failing loudly, so this test pins the explicit value.
    const map = fakeMap();
    const { contours } = createSeascapeVectorOverlay(SOURCE);
    contours.add(ctx(map));
    expect(map.layers.get('seascape-contours-label')?.layout?.['text-font']).toEqual([
      'Noto Sans Regular',
    ]);
    expect(map.layers.get('seascape-soundings-layer')?.layout?.['text-font']).toEqual([
      'Noto Sans Regular',
    ]);
  });

  it('removing one row does not remove the shared source out from under the other', () => {
    const map = fakeMap();
    const { contours, drying } = createSeascapeVectorOverlay(SOURCE);
    drying.add(ctx(map));
    contours.add(ctx(map));
    contours.remove(ctx(map));
    expect(map.sources.has('seascape-vector')).toBe(true);
    expect(map.layers.has('seascape-drying-layer')).toBe(true);
    drying.remove(ctx(map));
    expect(map.sources.has('seascape-vector')).toBe(false);
  });

  it('removing rows in reverse order also preserves the shared source until both are gone', () => {
    const map = fakeMap();
    const { contours, drying } = createSeascapeVectorOverlay(SOURCE);
    drying.add(ctx(map));
    contours.add(ctx(map));
    drying.remove(ctx(map));
    expect(map.sources.has('seascape-vector')).toBe(true);
    expect(map.layers.has('seascape-contours-line')).toBe(true);
    contours.remove(ctx(map));
    expect(map.sources.has('seascape-vector')).toBe(false);
  });
});
