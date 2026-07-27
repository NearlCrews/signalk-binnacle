import { describe, expect, it, vi } from 'vitest';
import { WeatherStore } from '$entities/weather';
import { mapThemePaint } from '$shared/map';
import { createFakeMap, fakeOverlayContext } from '$shared/testing';
import { createWavesOverlay } from './waves-overlay';

function fakeCanvas() {
  return { width: 0, height: 0, getContext: () => null } as unknown as HTMLCanvasElement;
}

function storeWithGrid(): WeatherStore {
  const store = new WeatherStore();
  const cells = 4;
  store.setGrid({
    lats: [0, 1],
    lons: [0, 1],
    times: [1000],
    windU: [new Array(cells).fill(0)],
    windV: [new Array(cells).fill(0)],
    waveHeight: [new Array(cells).fill(2)],
    waveDirection: [new Array(cells).fill(0)],
    wavePeriod: [new Array(cells).fill(6)],
  });
  return store;
}

describe('waves overlay', () => {
  it('adds a field source and layer and an arrow source and layer in the weather band', async () => {
    const overlay = createWavesOverlay(storeWithGrid(), fakeCanvas);
    const map = createFakeMap();
    await overlay.add(fakeOverlayContext(map));
    expect(overlay.band).toBe('weather');
    expect(map.sources.size).toBe(2);
    expect(map.layers.size).toBe(2);
  });

  it('syncs the arrow features from the grid', async () => {
    const overlay = createWavesOverlay(storeWithGrid(), fakeCanvas);
    const map = createFakeMap();
    await overlay.add(fakeOverlayContext(map));
    overlay.sync(fakeOverlayContext(map));
    const arrowSource = map.sources.get('binnacle-weather-waves-arrows');
    const hidden = arrowSource?.data as GeoJSON.FeatureCollection;
    expect(hidden.features).toHaveLength(0);

    overlay.setVisible(fakeOverlayContext(map), true);
    const fc = arrowSource?.data as GeoJSON.FeatureCollection;
    expect(fc.features.length).toBeGreaterThan(0);
  });

  it('clears the field canvas when a new grid lacks the wave field', async () => {
    const store = storeWithGrid();
    const ctx2d = {
      createImageData: (w: number, h: number) => ({ data: { set: () => {} }, width: w, height: h }),
      putImageData: () => {},
      clearRect: vi.fn(),
    };
    const canvas = { width: 0, height: 0, getContext: () => ctx2d } as unknown as HTMLCanvasElement;
    const overlay = createWavesOverlay(store, () => canvas);
    const map = createFakeMap();
    await overlay.add(fakeOverlayContext(map));
    overlay.setVisible(fakeOverlayContext(map), true);
    expect(canvas.width).toBeGreaterThan(1); // the wave field was drawn

    // A refetch without marine data must render empty, not stretch the old pixels over the new bbox.
    const cells = 4;
    store.setGrid({
      lats: [0, 1],
      lons: [0, 1],
      times: [1000],
      windU: [new Array(cells).fill(0)],
      windV: [new Array(cells).fill(0)],
    });
    overlay.sync(fakeOverlayContext(map));
    expect(canvas.width).toBe(1);
    expect(ctx2d.clearRect).toHaveBeenCalled();
  });

  it('removes its layers and sources', async () => {
    const overlay = createWavesOverlay(storeWithGrid(), fakeCanvas);
    const map = createFakeMap();
    await overlay.add(fakeOverlayContext(map));
    overlay.remove(fakeOverlayContext(map));
    expect(map.layers.size).toBe(0);
    expect(map.sources.size).toBe(0);
  });

  it('recolors for the theme without throwing', async () => {
    const overlay = createWavesOverlay(storeWithGrid(), fakeCanvas);
    const map = createFakeMap();
    await overlay.add(fakeOverlayContext(map));
    expect(() =>
      overlay.applyTheme?.(fakeOverlayContext(map), mapThemePaint('night-red')),
    ).not.toThrow();
  });
});
