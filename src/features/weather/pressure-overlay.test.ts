import { describe, expect, it } from 'vitest';
import { WeatherStore } from '$entities/weather';
import { mapThemePaint } from '$shared/map';
import { createFakeMap, fakeOverlayContext } from '$shared/testing';
import { createPressureOverlay } from './pressure-overlay';

function storeWithGrid(): WeatherStore {
  const store = new WeatherStore();
  const cells = 9; // 3x3
  const pressure = new Array(cells).fill(0).map((_, i) => (1008 + (i % 3) * 4) * 100);
  store.setGrid({
    lats: [0, 1, 2],
    lons: [0, 1, 2],
    times: [1000],
    windU: [new Array(cells).fill(0)],
    windV: [new Array(cells).fill(0)],
    pressureMsl: [pressure],
  });
  return store;
}

describe('pressure overlay', () => {
  it('adds a line and a label layer in the weather band', async () => {
    const overlay = createPressureOverlay(storeWithGrid());
    const map = createFakeMap();
    await overlay.add(fakeOverlayContext(map));
    expect(overlay.band).toBe('weather');
    expect(map.sources.size).toBe(2);
    expect(map.layers.size).toBe(2);
  });

  it('syncs isobar features from the grid', async () => {
    const overlay = createPressureOverlay(storeWithGrid());
    const map = createFakeMap();
    await overlay.add(fakeOverlayContext(map));
    overlay.sync(fakeOverlayContext(map));
    const hidden = [...map.sources.values()][0].data as GeoJSON.FeatureCollection;
    expect(hidden.features).toHaveLength(0);

    overlay.setVisible(fakeOverlayContext(map), true);
    overlay.sync(fakeOverlayContext(map));
    const fc = [...map.sources.values()][0].data as GeoJSON.FeatureCollection;
    expect(fc.features.length).toBeGreaterThan(0);
  });

  it('removes its layers and sources', async () => {
    const overlay = createPressureOverlay(storeWithGrid());
    const map = createFakeMap();
    await overlay.add(fakeOverlayContext(map));
    overlay.remove(fakeOverlayContext(map));
    expect(map.layers.size).toBe(0);
    expect(map.sources.size).toBe(0);
  });

  it('recolors for the theme without throwing', async () => {
    const overlay = createPressureOverlay(storeWithGrid());
    const map = createFakeMap();
    await overlay.add(fakeOverlayContext(map));
    expect(() =>
      overlay.applyTheme?.(fakeOverlayContext(map), mapThemePaint('night-red')),
    ).not.toThrow();
  });
});
