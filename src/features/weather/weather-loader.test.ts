import { describe, expect, it, vi } from 'vitest';
import type { Bbox, RadarData, WeatherGrid, WeatherStore } from '$entities/weather';
import { createExpiringStore } from '$shared/storage';
import type { fetchRadar } from './rainviewer-client';
import type { fetchForecast, fetchMarine } from './weather-client';
import { createWeatherLoader, weatherCacheKey, weatherCoverageBucket } from './weather-loader';

const BBOX: Bbox = { west: 1, south: 2, east: 3, north: 4 };
const OPTS = { maxCells: 600, forecastDays: 5 };
function gridFor(bbox: Bbox, id = 'grid'): WeatherGrid {
  return {
    lats: [bbox.south, bbox.north],
    lons: [bbox.west, bbox.east],
    times: [0],
    windU: [[0, 0, 0, 0]],
    windV: [[0, 0, 0, 0]],
    id,
  } as WeatherGrid & { id: string };
}

const FAKE_GRID = gridFor(BBOX);
const FAKE_RADAR = { host: 'h', frames: [] } as unknown as RadarData;

function makeStore() {
  const status: string[] = [];
  const grids: WeatherGrid[] = [];
  const radars: unknown[] = [];
  const store = {
    grid: undefined as unknown,
    setStatus(s: string) {
      status.push(s);
    },
    setGrid(g: WeatherGrid) {
      grids.push(g);
      store.grid = g;
    },
    setRadar(r: unknown) {
      radars.push(r);
    },
  };
  return { store: store as unknown as WeatherStore, status, grids, radars };
}

function makeDeps(nowRef: { ms: number }) {
  return {
    forecast: vi.fn<typeof fetchForecast>(async (bbox) => gridFor(bbox)),
    marine: vi.fn<typeof fetchMarine>(async () => undefined),
    radar: vi.fn<typeof fetchRadar>(async () => FAKE_RADAR),
    now: () => nowRef.ms,
    // A fresh in-memory persistent store per test (factory: undefined forces the memory fallback).
    persist: createExpiringStore<WeatherGrid>('test', { factory: undefined }),
  };
}

describe('weatherCacheKey', () => {
  it('keys equivalent viewports by their canonical coverage bucket', () => {
    const a = weatherCacheKey({ west: 1.01, south: 2.01, east: 2.99, north: 3.99 }, OPTS, false);
    const b = weatherCacheKey({ west: 1.02, south: 2.02, east: 2.98, north: 3.98 }, OPTS, false);
    expect(a).toBe(b);
    expect(weatherCacheKey({ west: 170, south: 2, east: 190, north: 4 }, OPTS, false)).toBe(
      weatherCacheKey({ west: -190, south: 2, east: -170, north: 4 }, OPTS, false),
    );
    expect(weatherCacheKey({ west: 170, south: 2, east: -170, north: 4 }, OPTS, false)).toBe(
      weatherCacheKey({ west: 170, south: 2, east: 190, north: 4 }, OPTS, false),
    );
  });

  it('rounds coverage outward', () => {
    expect(weatherCoverageBucket({ west: 1.01, south: 2.02, east: 2.99, north: 3.98 })).toEqual({
      west: 1,
      south: 2,
      east: 3,
      north: 4,
    });
  });

  it('separates marine from atmospheric-only', () => {
    expect(weatherCacheKey(BBOX, OPTS, true)).not.toBe(weatherCacheKey(BBOX, OPTS, false));
  });
});

describe('createWeatherLoader', () => {
  it('reuses a recent grid for the same view, and refetches after the TTL', async () => {
    const nowRef = { ms: 1000 };
    const deps = makeDeps(nowRef);
    const loader = createWeatherLoader(deps);
    const { store } = makeStore();

    await loader.load(store, BBOX, OPTS, { waves: false, radar: false });
    await loader.load(store, BBOX, OPTS, { waves: false, radar: false });
    expect(deps.forecast).toHaveBeenCalledTimes(1);

    nowRef.ms += 61 * 60 * 1000;
    await loader.load(store, BBOX, OPTS, { waves: false, radar: false });
    expect(deps.forecast).toHaveBeenCalledTimes(2);
  });

  it('backs off only the marine endpoint when the waves fetch fails, then retries it', async () => {
    const nowRef = { ms: 0 };
    const deps = makeDeps(nowRef);
    // forecast succeeds; marine returns undefined (a 429 on the separate marine host).
    const loader = createWeatherLoader(deps);
    const { store, grids } = makeStore();

    await loader.load(store, BBOX, OPTS, { waves: true, radar: false });
    expect(deps.forecast).toHaveBeenCalledTimes(1);
    expect(deps.marine).toHaveBeenCalledTimes(1);
    expect(grids).toHaveLength(1); // the partial grid (wind and pressure) is still shown
    expect(grids[0].partialWaves).toBe(true); // and says so, for the panel's qualifier

    // Within the cooldown a pan skips the rate-limited marine host, but the healthy atmospheric
    // endpoint keeps answering (the partial grid was deliberately not cached).
    await loader.load(store, BBOX, OPTS, { waves: true, radar: false });
    expect(deps.forecast).toHaveBeenCalledTimes(2);
    expect(deps.marine).toHaveBeenCalledTimes(1);

    // Past the cooldown it retries marine.
    nowRef.ms += 61_000;
    await loader.load(store, BBOX, OPTS, { waves: true, radar: false });
    expect(deps.marine).toHaveBeenCalledTimes(2);
  });

  it('stamps the network fetch time onto the grid for provenance', async () => {
    const deps = makeDeps({ ms: 12_345 });
    const loader = createWeatherLoader(deps);
    const { store, grids } = makeStore();

    await loader.load(store, BBOX, OPTS, { waves: false, radar: false });
    expect(grids[0].fetchedAt).toBe(12_345);
  });

  it('fetches marine only when waves is wanted', async () => {
    const deps = makeDeps({ ms: 0 });
    const loader = createWeatherLoader(deps);
    const { store } = makeStore();

    await loader.load(store, BBOX, OPTS, { waves: false, radar: false });
    expect(deps.marine).not.toHaveBeenCalled();

    await loader.load(store, BBOX, OPTS, { waves: true, radar: false });
    expect(deps.marine).toHaveBeenCalledTimes(1);
  });

  it('caches radar frames for the radar TTL', async () => {
    const nowRef = { ms: 0 };
    const deps = makeDeps(nowRef);
    const loader = createWeatherLoader(deps);
    const { store, radars } = makeStore();

    await loader.load(store, BBOX, OPTS, { waves: false, radar: true });
    await loader.load(store, BBOX, OPTS, { waves: false, radar: true });
    expect(deps.radar).toHaveBeenCalledTimes(1);
    expect(radars).toHaveLength(2);

    nowRef.ms += 6 * 60 * 1000;
    await loader.load(store, BBOX, OPTS, { waves: false, radar: true });
    expect(deps.radar).toHaveBeenCalledTimes(2);
  });

  it('does not slide the radar TTL on cache hits', async () => {
    const nowRef = { ms: 0 };
    const deps = makeDeps(nowRef);
    const loader = createWeatherLoader(deps);
    const { store } = makeStore();

    await loader.load(store, BBOX, OPTS, { waves: false, radar: true });
    expect(deps.radar).toHaveBeenCalledTimes(1);

    // A hit just under the TTL must not push the expiry out.
    nowRef.ms = 4 * 60 * 1000;
    await loader.load(store, BBOX, OPTS, { waves: false, radar: true });
    expect(deps.radar).toHaveBeenCalledTimes(1);

    // Past the ORIGINAL expiry (t = 5 min) the nowcast is refetched, even though the latest hit was
    // only a minute ago; a sliding expiry would keep serving the stale frames forever.
    nowRef.ms = 6 * 60 * 1000;
    await loader.load(store, BBOX, OPTS, { waves: false, radar: true });
    expect(deps.radar).toHaveBeenCalledTimes(2);
  });

  it('drops a superseded load so an older viewport cannot overwrite a newer grid', async () => {
    const nowRef = { ms: 0 };
    const deps = makeDeps(nowRef);
    const fastGrid = gridFor({ west: 10, south: 20, east: 30, north: 40 }, 'fast');
    let firstStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });
    deps.forecast
      .mockImplementationOnce(
        (_bbox, _opts, _fetchFn, signal) =>
          new Promise<WeatherGrid>((_resolve, reject) => {
            firstStarted();
            signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
          }),
      )
      .mockImplementationOnce(async () => fastGrid);
    const loader = createWeatherLoader(deps);
    const { store, grids } = makeStore();

    const otherBbox: Bbox = { west: 10, south: 20, east: 30, north: 40 };
    const first = loader.load(store, BBOX, OPTS, { waves: false, radar: false });
    await started;
    const second = loader.load(store, otherBbox, OPTS, { waves: false, radar: false });
    await second;
    await first;

    expect(grids).toHaveLength(1);
    expect((grids[0] as unknown as { id: string }).id).toBe('fast');
  });

  it('aborts superseded forecast, marine, and radar work without reporting failure', async () => {
    const deps = makeDeps({ ms: 0 });
    const signals: AbortSignal[] = [];
    let startedCount = 0;
    let allStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      allStarted = resolve;
    });
    const pending = (signal: AbortSignal | undefined) =>
      new Promise<never>((_resolve, reject) => {
        if (!signal) throw new Error('missing abort signal');
        signals.push(signal);
        startedCount += 1;
        if (startedCount === 3) allStarted();
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    deps.forecast
      .mockImplementationOnce((_bbox, _opts, _fetchFn, signal) => pending(signal))
      .mockImplementationOnce(async (bbox) => gridFor(bbox, 'next'));
    deps.marine.mockImplementationOnce((_bbox, _opts, _fetchFn, signal) => pending(signal));

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn((_input, init) => pending(init?.signal ?? undefined)) as typeof fetch;
    deps.radar.mockImplementationOnce(async (fetchFn) => {
      if (!fetchFn) throw new Error('missing fetch function');
      await fetchFn('https://example.test/radar');
      return undefined;
    });
    const loader = createWeatherLoader(deps);
    const result = makeStore();

    try {
      const first = loader.load(result.store, BBOX, OPTS, { waves: true, radar: true });
      await started;
      const second = loader.load(result.store, BBOX, OPTS, { waves: false, radar: false });
      await Promise.all([first, second]);
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(signals).toHaveLength(3);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(result.status).not.toContain('error');
    expect(result.status).not.toContain('stale');
  });

  it('marks the store error when the first fetch fails, stale when a grid already exists', async () => {
    const deps = makeDeps({ ms: 0 });
    deps.forecast.mockResolvedValue(undefined as unknown as WeatherGrid);
    const loader = createWeatherLoader(deps);
    const { store, status } = makeStore();

    await loader.load(store, BBOX, OPTS, { waves: false, radar: false });
    expect(status).toContain('error');

    store.grid = FAKE_GRID;
    await loader.load(store, BBOX, OPTS, { waves: false, radar: false });
    expect(status).toContain('stale');
  });

  it('backs off after a failed grid fetch, then retries once the cooldown passes', async () => {
    const nowRef = { ms: 0 };
    const deps = makeDeps(nowRef);
    deps.forecast.mockResolvedValue(undefined as unknown as WeatherGrid);
    const loader = createWeatherLoader(deps);
    const { store } = makeStore();

    await loader.load(store, BBOX, OPTS, { waves: false, radar: false });
    expect(deps.forecast).toHaveBeenCalledTimes(1);

    // Within the cooldown a pan or resize does not retry the network.
    await loader.load(store, BBOX, OPTS, { waves: false, radar: false });
    expect(deps.forecast).toHaveBeenCalledTimes(1);

    // Past the cooldown it retries.
    nowRef.ms += 61_000;
    await loader.load(store, BBOX, OPTS, { waves: false, radar: false });
    expect(deps.forecast).toHaveBeenCalledTimes(2);
  });

  it('persists a fetched grid so a fresh loader (a reload) reuses it without fetching', async () => {
    const nowRef = { ms: 1000 };
    const deps = makeDeps(nowRef);
    // A persistent store shared between the two loaders stands in for IndexedDB surviving a reload.
    const persist = createExpiringStore<WeatherGrid>('shared', { factory: undefined });

    const first = createWeatherLoader({ ...deps, persist });
    await first.load(makeStore().store, BBOX, OPTS, { waves: false, radar: false });
    expect(deps.forecast).toHaveBeenCalledTimes(1);
    expect(await persist.get(weatherCacheKey(BBOX, OPTS, false))).toBeDefined();

    // A new loader (empty in-memory cache, like a page reload) reuses the persisted grid.
    const reloadDeps = makeDeps(nowRef);
    const second = createWeatherLoader({ ...reloadDeps, persist });
    const reloaded = makeStore();
    await second.load(reloaded.store, BBOX, OPTS, { waves: false, radar: false });
    expect(reloadDeps.forecast).not.toHaveBeenCalled();
    expect(reloaded.grids).toHaveLength(1);
  });

  it('ignores an expired persisted grid and fetches a fresh one', async () => {
    const nowRef = { ms: 1000 };
    const persist = createExpiringStore<WeatherGrid>('shared', { factory: undefined });
    await persist.put(weatherCacheKey(BBOX, OPTS, false), FAKE_GRID, 500); // already expired at t=1000

    const deps = makeDeps(nowRef);
    const loader = createWeatherLoader({ ...deps, persist });
    await loader.load(makeStore().store, BBOX, OPTS, { waves: false, radar: false });
    expect(deps.forecast).toHaveBeenCalledTimes(1);
  });

  it('uses retained IndexedDB data as stale fallback after a refresh failure', async () => {
    const nowRef = { ms: 2 * 60 * 60 * 1000 };
    const persist = createExpiringStore<WeatherGrid>('shared', { factory: undefined });
    const retained = { ...FAKE_GRID, fetchedAt: 0 };
    await persist.put(weatherCacheKey(BBOX, OPTS, false), retained, nowRef.ms + 1000);
    const deps = makeDeps(nowRef);
    deps.forecast.mockResolvedValue(undefined as unknown as WeatherGrid);
    const loader = createWeatherLoader({ ...deps, persist });
    const result = makeStore();

    await loader.load(result.store, BBOX, OPTS, { waves: false, radar: false });

    expect(deps.forecast).toHaveBeenCalledTimes(1);
    expect(result.grids).toEqual([retained]);
    expect(result.status.at(-1)).toBe('stale');
  });

  it('does not reuse a cached grid that fails to cover the viewport', async () => {
    const nowRef = { ms: 1000 };
    const persist = createExpiringStore<WeatherGrid>('shared', { factory: undefined });
    const tooSmall = {
      ...gridFor({ west: 1.2, south: 2.2, east: 2.8, north: 3.8 }),
      fetchedAt: 900,
    };
    await persist.put(weatherCacheKey(BBOX, OPTS, false), tooSmall, nowRef.ms + 1000);
    const deps = makeDeps(nowRef);
    const loader = createWeatherLoader({ ...deps, persist });

    await loader.load(makeStore().store, BBOX, OPTS, { waves: false, radar: false });

    expect(deps.forecast).toHaveBeenCalledTimes(1);
    expect(deps.forecast.mock.calls[0][0]).toEqual(BBOX);
  });
});
