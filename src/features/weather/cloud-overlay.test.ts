import { describe, expect, it } from 'vitest';
import { WeatherStore } from '$entities/weather';
import { mapThemePaint } from '$shared/map';
import { createFakeMap, fakeOverlayContext } from '$shared/testing';
import { createCloudOverlay } from './cloud-overlay';

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
    cloudCover: [new Array(cells).fill(0.8)],
  });
  return store;
}

describe('cloud overlay', () => {
  it('adds a field source and layer in the weather band', () => {
    const overlay = createCloudOverlay(storeWithGrid(), fakeCanvas);
    const map = createFakeMap();
    overlay.add(fakeOverlayContext(map));
    expect(overlay.band).toBe('weather');
    expect(map.sources.size).toBe(1);
    expect(map.layers.size).toBe(1);
  });

  it('syncs without throwing', () => {
    const overlay = createCloudOverlay(storeWithGrid(), fakeCanvas);
    const map = createFakeMap();
    overlay.add(fakeOverlayContext(map));
    expect(() => overlay.sync(fakeOverlayContext(map))).not.toThrow();
  });

  it('removes its layer and source', () => {
    const overlay = createCloudOverlay(storeWithGrid(), fakeCanvas);
    const map = createFakeMap();
    overlay.add(fakeOverlayContext(map));
    overlay.remove(fakeOverlayContext(map));
    expect(map.layers.size).toBe(0);
    expect(map.sources.size).toBe(0);
  });

  it('recolors for the theme without throwing', () => {
    const overlay = createCloudOverlay(storeWithGrid(), fakeCanvas);
    const map = createFakeMap();
    overlay.add(fakeOverlayContext(map));
    expect(() =>
      overlay.applyTheme?.(fakeOverlayContext(map), mapThemePaint('night-red')),
    ).not.toThrow();
  });
});
