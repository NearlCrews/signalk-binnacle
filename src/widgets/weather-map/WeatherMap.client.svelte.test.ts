import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UnitsStore } from '$entities/units';
import { type Bbox, WeatherStore } from '$entities/weather';
import { WEATHER_LAYER_IDS, type WeatherLoader } from '$features/weather';
import { METRIC_UNITS } from '$shared/lib';
import type { createThemedMap, LayerListItem } from '$shared/map';
import type { MapView } from '$shared/settings';
import WeatherMap from './WeatherMap.svelte';

const mapFactory = vi.hoisted(() => vi.fn());
vi.mock('$shared/map', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$shared/map')>()),
  createThemedMap: mapFactory,
}));

type MapOptions = Parameters<typeof createThemedMap>[0];
type MapApi = Parameters<MapOptions['onLoad']>[0];
const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose();
  vi.useRealTimers();
  mapFactory.mockReset();
});

describe('WeatherMap viewport ownership', () => {
  it('loads the changed chart viewport on reopen even when a prior forecast grid is retained', async () => {
    vi.useFakeTimers();
    const maps: Array<{ options: MapOptions; destroy: ReturnType<typeof vi.fn> }> = [];
    mapFactory.mockImplementation((options: MapOptions) => {
      const destroy = vi.fn();
      maps.push({ options, destroy });
      return { destroy };
    });
    const store = new WeatherStore();
    const load = vi.fn<WeatherLoader['load']>(async (target, bounds) => {
      target.setGrid({
        lats: [bounds.south, bounds.north],
        lons: [bounds.west, bounds.east],
        times: [Date.now(), Date.now() + 3_600_000],
        windU: [
          [1, 1, 1, 1],
          [1, 1, 1, 1],
        ],
        windV: [
          [0, 0, 0, 0],
          [0, 0, 0, 0],
        ],
        fetchedAt: Date.now(),
      });
    });

    async function open(view: MapView, bounds: Bbox) {
      const target = document.createElement('div');
      document.body.append(target);
      const component = mount(WeatherMap, {
        target,
        props: {
          store,
          loader: { load },
          origin: 'https://boat.test',
          theme: 'day',
          units: { mode: 'metric', profile: METRIC_UNITS } as UnitsStore,
          initialView: view,
          onClose: vi.fn(),
        },
      });
      flushSync();
      let closed = false;
      const close = async () => {
        if (closed) return;
        closed = true;
        await unmount(component);
        target.remove();
      };
      cleanup.push(close);
      const instance = maps.at(-1);
      if (!instance) throw new Error('Weather map did not initialize');
      const layer: LayerListItem = {
        id: WEATHER_LAYER_IDS.wind,
        title: 'Wind',
        description: 'Forecast wind',
        visible: true,
        opacity: 1,
        supportsOpacity: true,
        pinned: false,
        band: 'weather',
        available: true,
      };
      const canvas = document.createElement('canvas');
      await instance.options.onLoad({
        map: {
          getBounds: () => ({
            getWest: () => bounds.west,
            getSouth: () => bounds.south,
            getEast: () => bounds.east,
            getNorth: () => bounds.north,
          }),
          on: vi.fn(),
          getCanvas: () => canvas,
        } as unknown as MapApi['map'],
        manager: {
          registerAll: vi.fn(async () => undefined),
          layers: () => [layer],
        } as unknown as MapApi['manager'],
        ctx: {} as MapApi['ctx'],
        recolor: vi.fn(),
        isDestroyed: () => closed,
        runTick: vi.fn(),
      });
      flushSync();
      return { close, instance };
    }

    const firstBounds = { west: -83, south: 27, east: -82, north: 28 };
    const first = await open({ lon: -82.5, lat: 27.5, zoom: 6 }, firstBounds);
    expect(load).toHaveBeenCalledTimes(1);
    expect(load.mock.calls[0]?.[1]).toEqual(firstBounds);
    const retained = store.grid;
    await first.close();
    expect(first.instance.destroy).toHaveBeenCalledOnce();
    expect(store.grid).toBe(retained);

    const nextView = { lon: -70.5, lat: 42.5, zoom: 6 };
    const nextBounds = { west: -71, south: 42, east: -70, north: 43 };
    const reopened = await open(nextView, nextBounds);
    expect(reopened.instance.options.view).toEqual(nextView);
    // This must happen from map readiness alone, with no pan, focus, or elapsed refresh timer.
    expect(load).toHaveBeenCalledTimes(2);
    expect(load.mock.calls[1]).toEqual([
      store,
      nextBounds,
      { maxCells: 200, forecastDays: 5 },
      { waves: false, radar: false },
      false,
    ]);
    expect(store.grid?.lons).toEqual([-71, -70]);
    expect(store.grid).not.toBe(retained);
  });
});
