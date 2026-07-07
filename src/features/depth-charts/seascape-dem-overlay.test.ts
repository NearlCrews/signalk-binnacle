import { describe, expect, it, vi } from 'vitest';
import { createSeascapeDemOverlay } from './seascape-dem-overlay';
import type { SeascapeDemSource } from './seascape-sources';

const SOURCE: SeascapeDemSource = {
  id: 'seascape-dem',
  tiles: ['https://tiles.openwaters.io/seascape/{z}/{x}/{y}.webp'],
  tileSize: 512,
  maxzoom: 17,
  attribution: 'test attribution',
};

// A minimal fake of the MapLibre map surface the two overlays touch, enough to prove the
// shared-source ownership contract without a real MapLibre instance.
function fakeMap() {
  const sources = new Set<string>();
  const layers = new Map<string, { type: string }>();
  return {
    sources,
    layers,
    getSource: (id: string) => (sources.has(id) ? {} : undefined),
    addSource: (id: string) => sources.add(id),
    removeSource: (id: string) => sources.delete(id),
    getLayer: (id: string) => layers.get(id),
    addLayer: (layer: { id: string; type: string }) => layers.set(layer.id, layer),
    removeLayer: (id: string) => layers.delete(id),
    setPaintProperty: vi.fn(),
  };
}

const ctx = (map: ReturnType<typeof fakeMap>) => ({
  map: map as never,
  beforeIdFor: () => undefined,
});

describe('createSeascapeDemOverlay', () => {
  it('declares both rows in the bathymetry band, hidden by default, grouped together', () => {
    const { depthShading, hillshade } = createSeascapeDemOverlay(SOURCE);
    expect(depthShading.id).toBe('seascape-depth-shading');
    expect(depthShading.band).toBe('bathymetry');
    expect(depthShading.defaultVisible).toBe(false);
    expect(depthShading.group).toEqual({ id: 'seascape', title: 'Seascape bathymetry' });
    expect(hillshade.id).toBe('seascape-hillshade');
    expect(hillshade.parent).toBe('seascape-depth-shading');
    expect(hillshade.group).toEqual({ id: 'seascape', title: 'Seascape bathymetry' });
  });

  it('depth shading creates the shared source; hillshade only attaches its own layer', () => {
    const map = fakeMap();
    const { depthShading, hillshade } = createSeascapeDemOverlay(SOURCE);
    depthShading.add(ctx(map));
    expect(map.sources.has('seascape-dem')).toBe(true);
    expect(map.layers.has('seascape-depth-shading-layer')).toBe(true);
    hillshade.add(ctx(map));
    expect(map.layers.has('seascape-hillshade-layer')).toBe(true);
    // Hillshade never re-creates the source; it was already present from depthShading.add.
    expect(map.sources.size).toBe(1);
  });

  it('only depth shading removes the shared source; hillshade only removes its own layer', () => {
    const map = fakeMap();
    const { depthShading, hillshade } = createSeascapeDemOverlay(SOURCE);
    depthShading.add(ctx(map));
    hillshade.add(ctx(map));
    hillshade.remove(ctx(map));
    expect(map.sources.has('seascape-dem')).toBe(true);
    expect(map.layers.has('seascape-hillshade-layer')).toBe(false);
    depthShading.remove(ctx(map));
    expect(map.sources.has('seascape-dem')).toBe(false);
    expect(map.layers.has('seascape-depth-shading-layer')).toBe(false);
  });

  it('depth shading supports opacity; hillshade does not (no MapLibre hillshade opacity paint property)', () => {
    const { depthShading, hillshade } = createSeascapeDemOverlay(SOURCE);
    expect(depthShading.supportsOpacity).toBe(true);
    expect(hillshade.supportsOpacity).toBe(false);
  });
});
