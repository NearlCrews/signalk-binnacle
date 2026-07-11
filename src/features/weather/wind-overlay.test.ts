import { describe, expect, it, vi } from 'vitest';
import { WeatherStore } from '$entities/weather';
import { mapThemePaint, type OverlayContext } from '$shared/map';
import { createFakeMap } from '$shared/testing/fake-map';
import { createWindOverlay } from './wind-overlay';

function ctxFor(map: ReturnType<typeof createFakeMap>): OverlayContext {
  return { map: map as never, beforeIdFor: () => undefined };
}

function storeWithGrid(): WeatherStore {
  const store = new WeatherStore();
  store.setGrid({
    lats: [0, 1],
    lons: [0, 1],
    times: [1000, 4000],
    windU: [
      [-10, -10, -10, -10],
      [-10, -10, -10, -10],
    ],
    windV: [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ],
  });
  return store;
}

describe('wind overlay', () => {
  it('adds a source and a line layer in the weather band', () => {
    const overlay = createWindOverlay(storeWithGrid());
    const map = createFakeMap();
    Object.assign(map, { triggerRepaint: vi.fn() });
    overlay.add(ctxFor(map));
    expect(overlay.band).toBe('weather');
    expect(map.sources.size).toBe(1);
    expect(map.layers.size).toBe(1);
  });

  it('syncs the arrow features from the grid', () => {
    const overlay = createWindOverlay(storeWithGrid());
    const map = createFakeMap();
    Object.assign(map, { triggerRepaint: vi.fn() });
    overlay.add(ctxFor(map));
    overlay.sync(ctxFor(map));
    const hidden = [...map.sources.values()][0].data as GeoJSON.FeatureCollection;
    expect(hidden.features).toHaveLength(0);

    overlay.setVisible(ctxFor(map), true);
    const source = [...map.sources.values()][0];
    const fc = source.data as GeoJSON.FeatureCollection;
    expect(fc.features).toHaveLength(4);
    overlay.sync(ctxFor(map));
    expect(source.data).toBe(fc);
  });

  it('removes its layer and source', () => {
    const overlay = createWindOverlay(storeWithGrid());
    const map = createFakeMap();
    overlay.add(ctxFor(map));
    overlay.remove(ctxFor(map));
    expect(map.layers.size).toBe(0);
    expect(map.sources.size).toBe(0);
  });

  it('recolors for the theme without throwing', () => {
    const overlay = createWindOverlay(storeWithGrid());
    const map = createFakeMap();
    overlay.add(ctxFor(map));
    expect(() => overlay.applyTheme?.(ctxFor(map), mapThemePaint('night-red'))).not.toThrow();
  });
});
