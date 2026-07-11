import { describe, expect, it, vi } from 'vitest';
import { WeatherStore } from '$entities/weather';
import { mapThemePaint, type OverlayContext } from '$shared/map';
import { createFakeMap } from '$shared/testing/fake-map';
import { createWavesOverlay } from './waves-overlay';

function ctxFor(map: ReturnType<typeof createFakeMap>): OverlayContext {
  return { map: map as never, beforeIdFor: () => undefined };
}

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
  it('adds a field source and layer and an arrow source and layer in the weather band', () => {
    const overlay = createWavesOverlay(storeWithGrid(), fakeCanvas);
    const map = createFakeMap();
    overlay.add(ctxFor(map));
    expect(overlay.band).toBe('weather');
    expect(map.sources.size).toBe(2);
    expect(map.layers.size).toBe(2);
  });

  it('syncs the arrow features from the grid', () => {
    const overlay = createWavesOverlay(storeWithGrid(), fakeCanvas);
    const map = createFakeMap();
    overlay.add(ctxFor(map));
    overlay.sync(ctxFor(map));
    const arrowSource = map.sources.get('binnacle-weather-waves-arrows');
    const hidden = arrowSource?.data as GeoJSON.FeatureCollection;
    expect(hidden.features).toHaveLength(0);

    overlay.setVisible(ctxFor(map), true);
    const fc = arrowSource?.data as GeoJSON.FeatureCollection;
    expect(fc.features.length).toBeGreaterThan(0);
  });

  it('clears the field canvas when a new grid lacks the wave field', () => {
    const store = storeWithGrid();
    const ctx2d = {
      createImageData: (w: number, h: number) => ({ data: { set: () => {} }, width: w, height: h }),
      putImageData: () => {},
      clearRect: vi.fn(),
    };
    const canvas = { width: 0, height: 0, getContext: () => ctx2d } as unknown as HTMLCanvasElement;
    const overlay = createWavesOverlay(store, () => canvas);
    const map = createFakeMap();
    overlay.add(ctxFor(map));
    overlay.setVisible(ctxFor(map), true);
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
    overlay.sync(ctxFor(map));
    expect(canvas.width).toBe(1);
    expect(ctx2d.clearRect).toHaveBeenCalled();
  });

  it('removes its layers and sources', () => {
    const overlay = createWavesOverlay(storeWithGrid(), fakeCanvas);
    const map = createFakeMap();
    overlay.add(ctxFor(map));
    overlay.remove(ctxFor(map));
    expect(map.layers.size).toBe(0);
    expect(map.sources.size).toBe(0);
  });

  it('recolors for the theme without throwing', () => {
    const overlay = createWavesOverlay(storeWithGrid(), fakeCanvas);
    const map = createFakeMap();
    overlay.add(ctxFor(map));
    expect(() => overlay.applyTheme?.(ctxFor(map), mapThemePaint('night-red'))).not.toThrow();
  });
});
