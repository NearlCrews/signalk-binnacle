import { describe, expect, it } from 'vitest';
import { WeatherStore } from '$entities/weather';
import { mapThemePaint } from '$shared/map';
import { createFakeMap, fakeOverlayContext } from '$shared/testing';
import { createRadarOverlay, radarFrameTiming } from './radar-overlay';

function storeWithRadar(): WeatherStore {
  const store = new WeatherStore();
  store.setRadar({
    host: 'https://tilecache.rainviewer.com',
    frames: [
      { time: 1000, path: '/v2/radar/a' },
      { time: 2000, path: '/v2/radar/b' },
    ],
  });
  return store;
}

describe('radar overlay', () => {
  it('creates the source and layer in the weather band once a frame is available', async () => {
    const overlay = createRadarOverlay(storeWithRadar());
    const map = createFakeMap();
    await overlay.add(fakeOverlayContext(map));
    // Nothing is created until a frame lands: a raster source has no usable empty placeholder.
    expect(map.sources.size).toBe(0);
    expect(map.layers.size).toBe(0);

    overlay.setVisible(fakeOverlayContext(map), true);
    overlay.sync(fakeOverlayContext(map));
    expect(overlay.band).toBe('weather');
    expect(map.sources.size).toBe(1);
    expect(map.layers.size).toBe(1);
  });

  it('creates the source pointed at the latest frame, never empty', async () => {
    const overlay = createRadarOverlay(storeWithRadar());
    const map = createFakeMap();
    await overlay.add(fakeOverlayContext(map));
    overlay.setVisible(fakeOverlayContext(map), true);
    const source = [...map.sources.values()][0];
    expect(source.tiles).toEqual([
      'https://tilecache.rainviewer.com/v2/radar/b/256/{z}/{x}/{y}/2/1_1.png',
    ]);
  });

  it('creates nothing while there is no radar data, even when shown', async () => {
    const overlay = createRadarOverlay(new WeatherStore());
    const map = createFakeMap();
    await overlay.add(fakeOverlayContext(map));
    overlay.setVisible(fakeOverlayContext(map), true);
    overlay.sync(fakeOverlayContext(map));
    expect(map.sources.size).toBe(0);
    expect(map.layers.size).toBe(0);
  });

  it('creates the layer once radar data arrives after being toggled on', async () => {
    const store = new WeatherStore();
    const overlay = createRadarOverlay(store);
    const map = createFakeMap();
    await overlay.add(fakeOverlayContext(map));
    overlay.setVisible(fakeOverlayContext(map), true);
    expect(map.layers.size).toBe(0);

    store.setRadar({
      host: 'https://tilecache.rainviewer.com',
      frames: [{ time: 1000, path: '/v2/radar/a' }],
    });
    overlay.sync(fakeOverlayContext(map));
    expect(map.layers.size).toBe(1);
  });

  it('defers layer creation when toggled on while the slider is scrubbed away', async () => {
    const store = storeWithRadar();
    store.setSelectedTime(2 * 60 * 60 * 1000); // two hours from "now" (wallNow = 0): scrubbed away
    const overlay = createRadarOverlay(
      store,
      () => 0,
      () => 0,
    );
    const map = createFakeMap();
    const added: Array<{ id: string; layout?: { visibility?: string } }> = [];
    const addLayer = map.addLayer;
    map.addLayer = (layer) => {
      added.push(layer as (typeof added)[number]);
      return addLayer(layer);
    };
    await overlay.add(fakeOverlayContext(map));
    overlay.setVisible(fakeOverlayContext(map), true);
    expect(map.layers.size).toBe(0);
    expect(added).toHaveLength(0);
  });

  it('removes its layer and source', async () => {
    const overlay = createRadarOverlay(storeWithRadar());
    const map = createFakeMap();
    await overlay.add(fakeOverlayContext(map));
    overlay.setVisible(fakeOverlayContext(map), true);
    overlay.sync(fakeOverlayContext(map));
    overlay.remove(fakeOverlayContext(map));
    expect(map.layers.size).toBe(0);
    expect(map.sources.size).toBe(0);
  });

  it('recolors for the theme without throwing, before and after the layer exists', async () => {
    const overlay = createRadarOverlay(storeWithRadar());
    const map = createFakeMap();
    await overlay.add(fakeOverlayContext(map));
    expect(() =>
      overlay.applyTheme?.(fakeOverlayContext(map), mapThemePaint('night-red')),
    ).not.toThrow();
    overlay.sync(fakeOverlayContext(map));
    expect(() =>
      overlay.applyTheme?.(fakeOverlayContext(map), mapThemePaint('night-red')),
    ).not.toThrow();
  });
});

describe('radar frame timing', () => {
  it('classifies current and past frames as observed with an age', () => {
    expect(radarFrameTiming(9_000, 10_000)).toEqual({
      kind: 'observed',
      offsetMs: -1_000,
      ageMs: 1_000,
    });
    expect(radarFrameTiming(10_000, 10_000).kind).toBe('observed');
  });

  it('classifies only future frames as nowcasts', () => {
    expect(radarFrameTiming(11_000, 10_000)).toEqual({
      kind: 'nowcast',
      offsetMs: 1_000,
      ageMs: 0,
    });
  });
});
