import { describe, expect, it, vi } from 'vitest';
import { TidesStore } from '$entities/tides';
import { createExpiringStore } from '$shared/storage';
import { createTidesLoader, type TidesPersistValue } from './tides-loader';

const tideStation = { id: 'T1', name: 'Tide', latitude: 27.7, longitude: -82.7 };
const currentStation = { id: 'C1', name: 'Current', latitude: 27.7, longitude: -82.7 };
const tideEvents = [{ timeMs: 1000, heightMeters: 0.5, kind: 'high' as const }];
const currentEvents = [
  { timeMs: 1000, velocityMps: 0.5, directionRad: (100 * Math.PI) / 180, kind: 'flood' as const },
];

const freshPersist = () => createExpiringStore<TidesPersistValue>('test', { factory: undefined });

function deps(overrides: Record<string, unknown> = {}) {
  return {
    tideStations: vi.fn(async () => [tideStation]),
    currentStations: vi.fn(async () => [currentStation]),
    tideEvents: vi.fn(async () => tideEvents),
    currentEvents: vi.fn(async () => currentEvents),
    now: () => 1_000_000,
    // A fresh in-memory persistent store per test, so persistence never leaks between tests.
    persist: freshPersist(),
    ...overrides,
  };
}

const pluginReading = {
  station: { id: 'tides', name: 'Local tides (signalk-tides)', latitude: 27.7, longitude: -82.7 },
  distanceMeters: 0,
  events: tideEvents,
};

describe('createTidesLoader', () => {
  it('loads the nearest tide and current readings and sets ready', async () => {
    const loader = createTidesLoader(deps());
    const store = new TidesStore();
    await loader.load(store, 27.7, -82.7);
    expect(store.status).toBe('ready');
    expect(store.tide?.station.id).toBe('T1');
    expect(store.current?.station.id).toBe('C1');
    expect(store.source).toBe('noaa-coops');
  });

  it('never consults the plugin when it is not available', async () => {
    const pluginTides = vi.fn(async () => pluginReading);
    const loader = createTidesLoader(deps({ pluginTides }));
    const store = new TidesStore();
    await loader.load(store, 27.7, -82.7);
    expect(pluginTides).not.toHaveBeenCalled();
    expect(store.source).toBe('noaa-coops');
  });

  it('prefers the plugin reading when available and keeps the CO-OPS current', async () => {
    const d = deps({ pluginAvailable: () => true, pluginTides: vi.fn(async () => pluginReading) });
    const loader = createTidesLoader(d);
    const store = new TidesStore();
    await loader.load(store, 27.7, -82.7);
    expect(store.status).toBe('ready');
    expect(store.tide).toBe(pluginReading);
    expect(store.source).toBe('signalk-tides');
    expect(store.current?.station.id).toBe('C1');
    expect(d.tideEvents).not.toHaveBeenCalled();
  });

  it('keeps at most one active and only the newest queued position', async () => {
    let resolveFirst: ((value: typeof pluginReading) => void) | undefined;
    let resolveLatest: ((value: typeof pluginReading) => void) | undefined;
    const pluginTides = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise<typeof pluginReading>((resolve) => (resolveFirst = resolve)),
      )
      .mockImplementationOnce(
        () => new Promise<typeof pluginReading>((resolve) => (resolveLatest = resolve)),
      );
    const loader = createTidesLoader(deps({ pluginAvailable: () => true, pluginTides }));
    const store = new TidesStore();
    const first = loader.load(store, 27.7, -82.7);
    const second = loader.load(store, 27.8, -82.8);
    const third = loader.load(store, 27.9, -82.9);
    const newest = {
      ...pluginReading,
      station: { ...pluginReading.station, id: 'newest', latitude: 27.9, longitude: -82.9 },
    };

    expect(pluginTides).toHaveBeenCalledTimes(1);
    resolveFirst?.(pluginReading);
    await first;
    await vi.waitFor(() => expect(pluginTides).toHaveBeenCalledTimes(2));
    expect(pluginTides).toHaveBeenLastCalledWith(27.9, -82.9);
    resolveLatest?.(newest);
    await Promise.all([second, third]);

    expect(store.tide?.station.id).toBe('newest');
  });

  it('preserves a forced retry when a later normal request replaces its coordinates', async () => {
    let resolveFirst: ((value: typeof pluginReading) => void) | undefined;
    const pluginTides = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise<typeof pluginReading>((resolve) => (resolveFirst = resolve)),
      )
      .mockResolvedValue(pluginReading);
    const loader = createTidesLoader(deps({ pluginAvailable: () => true, pluginTides }));
    const store = new TidesStore();
    const first = loader.load(store, 27.7, -82.7);
    const forced = loader.load(store, 27.8, -82.8, true);
    const latest = loader.load(store, 27.9, -82.9, false);
    resolveFirst?.(pluginReading);
    await Promise.all([first, forced, latest]);

    expect(pluginTides).toHaveBeenCalledTimes(2);
    expect(pluginTides.mock.calls[1].slice(0, 2)).toEqual([27.9, -82.9]);
  });

  it('falls back to CO-OPS when the plugin answers with nothing', async () => {
    const pluginTides = vi.fn(async () => undefined);
    const loader = createTidesLoader(deps({ pluginAvailable: () => true, pluginTides }));
    const store = new TidesStore();
    await loader.load(store, 27.7, -82.7);
    expect(pluginTides).toHaveBeenCalledTimes(1);
    expect(store.status).toBe('ready');
    expect(store.tide?.station.id).toBe('T1');
    expect(store.source).toBe('noaa-coops');
  });

  it('falls back to CO-OPS when the plugin station is far from the viewed point', async () => {
    // The plugin answers for the vessel; a view panned to another coast should show that coast.
    const farReading = { ...pluginReading, distanceMeters: 250_000 };
    const loader = createTidesLoader(
      deps({ pluginAvailable: () => true, pluginTides: vi.fn(async () => farReading) }),
    );
    const store = new TidesStore();
    await loader.load(store, 27.7, -82.7);
    expect(store.tide?.station.id).toBe('T1');
    expect(store.source).toBe('noaa-coops');
  });

  it('falls back to CO-OPS when the plugin fetch rejects', async () => {
    const pluginTides = vi.fn(async () => {
      throw new Error('plugin down');
    });
    const loader = createTidesLoader(deps({ pluginAvailable: () => true, pluginTides }));
    const store = new TidesStore();
    await loader.load(store, 27.7, -82.7);
    expect(store.status).toBe('ready');
    expect(store.tide?.station.id).toBe('T1');
    expect(store.source).toBe('noaa-coops');
  });

  it('keeps the plugin tide and reports when the CO-OPS current lookup fails', async () => {
    const loader = createTidesLoader(
      deps({
        pluginAvailable: () => true,
        pluginTides: vi.fn(async () => pluginReading),
        currentStations: vi.fn(async () => {
          throw new Error('network');
        }),
      }),
    );
    const store = new TidesStore();
    await loader.load(store, 27.7, -82.7);
    expect(store.status).toBe('error');
    expect(store.tide).toBe(pluginReading);
    expect(store.current).toBeUndefined();
    expect(store.source).toBe('signalk-tides');
    expect(store.failure('current')).toBeDefined();
  });

  it('reuses cached station lists and events on a second nearby load', async () => {
    const d = deps();
    const loader = createTidesLoader(d);
    const store = new TidesStore();
    await loader.load(store, 27.7, -82.7);
    await loader.load(store, 27.71, -82.71);
    expect(d.tideStations).toHaveBeenCalledTimes(1);
    expect(d.tideEvents).toHaveBeenCalledTimes(1);
  });

  it('refetches after a day rollover even when the boat has not moved', async () => {
    // Anchored: same position both loads, but the second lands on the next UTC day, so the
    // 3 km skip radius must not pin the aging 48-hour event window.
    let nowMs = Date.UTC(2026, 5, 8, 23, 0);
    const d = deps({ now: () => nowMs });
    const loader = createTidesLoader(d);
    const store = new TidesStore();
    await loader.load(store, 27.7, -82.7);
    nowMs = Date.UTC(2026, 5, 9, 1, 0);
    await loader.load(store, 27.7, -82.7);
    expect(store.status).toBe('ready');
    expect(d.tideEvents).toHaveBeenCalledTimes(2);
  });

  it('flags no coverage when no station is within range', async () => {
    const loader = createTidesLoader(
      deps({
        tideStations: vi.fn(async () => [{ id: 'X', name: 'Far', latitude: 0, longitude: 0 }]),
      }),
    );
    const store = new TidesStore();
    await loader.load(store, 27.7, -82.7);
    expect(store.status).toBe('no-coverage');
    expect(store.source).toBeUndefined();
  });

  it('keeps prior data and flags an error on a fetch failure', async () => {
    const loader = createTidesLoader(
      deps({
        tideStations: vi.fn(async () => {
          throw new Error('network');
        }),
      }),
    );
    const store = new TidesStore();
    await loader.load(store, 27.7, -82.7);
    expect(store.status).toBe('error');
  });

  it('serves persisted stations and events to a fresh loader (a reload) without the network', async () => {
    const persist = freshPersist();
    const first = createTidesLoader(deps({ persist }));
    await first.load(new TidesStore(), 27.7, -82.7);

    const d = deps({ persist });
    const second = createTidesLoader(d);
    const store = new TidesStore();
    await second.load(store, 27.7, -82.7);
    expect(store.status).toBe('ready');
    expect(store.tide?.station.id).toBe('T1');
    expect(store.current?.station.id).toBe('C1');
    expect(d.tideStations).not.toHaveBeenCalled();
    expect(d.currentStations).not.toHaveBeenCalled();
    expect(d.tideEvents).not.toHaveBeenCalled();
    expect(d.currentEvents).not.toHaveBeenCalled();
  });

  it('ignores persisted events from a previous UTC day', async () => {
    const persist = freshPersist();
    let nowMs = Date.UTC(2026, 5, 8, 23, 0);
    const first = createTidesLoader(deps({ persist, now: () => nowMs }));
    await first.load(new TidesStore(), 27.7, -82.7);

    nowMs = Date.UTC(2026, 5, 9, 1, 0);
    const d = deps({ persist, now: () => nowMs });
    const second = createTidesLoader(d);
    await second.load(new TidesStore(), 27.7, -82.7);
    // The station lists are still good, but the day-keyed predictions must be refetched.
    expect(d.tideStations).not.toHaveBeenCalled();
    expect(d.tideEvents).toHaveBeenCalledTimes(1);
  });

  it('ignores expired persisted station lists and refetches them', async () => {
    const persist = freshPersist();
    let nowMs = 1_000_000;
    const first = createTidesLoader(deps({ persist, now: () => nowMs }));
    await first.load(new TidesStore(), 27.7, -82.7);

    nowMs += 8 * 24 * 60 * 60 * 1000; // past the seven-day station expiry
    const d = deps({ persist, now: () => nowMs });
    const second = createTidesLoader(d);
    const store = new TidesStore();
    await second.load(store, 27.7, -82.7);
    expect(store.status).toBe('ready');
    expect(d.tideStations).toHaveBeenCalledTimes(1);
  });

  it("replays the day's persisted plugin reading when the plugin fetch fails", async () => {
    const persist = freshPersist();
    const first = createTidesLoader(
      deps({ persist, pluginAvailable: () => true, pluginTides: vi.fn(async () => pluginReading) }),
    );
    await first.load(new TidesStore(), 27.7, -82.7);

    const d = deps({
      persist,
      pluginAvailable: () => true,
      pluginTides: vi.fn(async () => undefined),
    });
    const second = createTidesLoader(d);
    const store = new TidesStore();
    await second.load(store, 27.7, -82.7);
    expect(store.status).toBe('ready');
    expect(store.tide?.station.id).toBe('tides');
    expect(store.source).toBe('signalk-tides');
    expect(d.tideEvents).not.toHaveBeenCalled();
  });

  it('publishes at most eight sorted stations of each kind inside its radius', async () => {
    const tides = Array.from({ length: 12 }, (_, index) => ({
      id: `T${index}`,
      name: `Tide ${index}`,
      latitude: 27.7 + index * 0.01,
      longitude: -82.7,
    }));
    const currents = Array.from({ length: 12 }, (_, index) => ({
      id: `C${index}`,
      name: `Current ${index}`,
      latitude: 27.7 + index * 0.01,
      longitude: -82.7,
    }));
    tides.push({ id: 'far-tide', name: 'Far tide', latitude: 30, longitude: -82.7 });
    currents.push({ id: 'far-current', name: 'Far current', latitude: 30, longitude: -82.7 });
    const loader = createTidesLoader(
      deps({
        tideStations: vi.fn(async () => tides),
        currentStations: vi.fn(async () => currents),
      }),
    );
    const store = new TidesStore();

    await loader.load(store, 27.7, -82.7);

    expect(store.nearbyTideStations).toHaveLength(8);
    expect(store.nearbyCurrentStations).toHaveLength(8);
    expect(store.nearbyTideStations.map(({ station }) => station.id)).toEqual(
      Array.from({ length: 8 }, (_, index) => `T${index}`),
    );
    expect(store.nearbyCurrentStations.map(({ station }) => station.id)).toEqual(
      Array.from({ length: 8 }, (_, index) => `C${index}`),
    );
    expect(store.nearbyTideStations.map(({ distanceMeters }) => distanceMeters)).toEqual(
      [...store.nearbyTideStations]
        .map(({ distanceMeters }) => distanceMeters)
        .sort((a, b) => a - b),
    );
  });

  it('combines an automatic plugin tide with an exact manual NOAA current', async () => {
    const manualCurrent = {
      id: 'C2',
      name: 'Manual current',
      latitude: 27.71,
      longitude: -82.71,
    };
    const d = deps({
      pluginAvailable: () => true,
      pluginTides: vi.fn(async () => pluginReading),
      currentStations: vi.fn(async () => [currentStation, manualCurrent]),
    });
    const loader = createTidesLoader(d);
    const store = new TidesStore();
    store.requestManual('current', manualCurrent, 0);

    await loader.load(store, 27.7, -82.7);

    expect(store.source).toBe('signalk-tides');
    expect(store.current?.station.id).toBe('C2');
    expect(d.currentEvents).toHaveBeenCalledWith('C2');
    expect(store.loadedCurrent.mode).toBe('manual');
  });

  it('bypasses signalk-tides and fetches the exact manually selected tide station', async () => {
    const manualTide = {
      id: 'T2',
      name: 'Manual tide',
      latitude: 27.71,
      longitude: -82.71,
    };
    const pluginTides = vi.fn(async () => pluginReading);
    const d = deps({
      pluginAvailable: () => true,
      pluginTides,
      tideStations: vi.fn(async () => [tideStation, manualTide]),
    });
    const loader = createTidesLoader(d);
    const store = new TidesStore();
    store.requestManual('tide', manualTide, 0);

    await loader.load(store, 27.7, -82.7);

    expect(pluginTides).not.toHaveBeenCalled();
    expect(d.tideEvents).toHaveBeenCalledWith('T2');
    expect(store.tide?.station.id).toBe('T2');
    expect(store.source).toBe('noaa-coops');
  });

  it('accepts valid empty windows for exact manual tide and current stations', async () => {
    const d = deps({
      tideEvents: vi.fn(async () => []),
      currentEvents: vi.fn(async () => []),
    });
    const loader = createTidesLoader(d);
    const store = new TidesStore();
    store.requestManual('tide', tideStation, 0);
    store.requestManual('current', currentStation, 0);

    await loader.load(store, 27.7, -82.7);

    expect(store.status).toBe('ready');
    expect(store.tide?.events).toEqual([]);
    expect(store.current?.events).toEqual([]);
    expect(store.loadedTide.mode).toBe('manual');
    expect(store.loadedCurrent.mode).toBe('manual');
  });

  it('keeps accepted readings, provider, catalogs, and loaded selection after a replacement fails', async () => {
    const replacement = {
      id: 'T2',
      name: 'Replacement tide',
      latitude: 27.72,
      longitude: -82.72,
    };
    const tideEventsFetch = vi
      .fn()
      .mockResolvedValueOnce(tideEvents)
      .mockRejectedValueOnce(new Error('transport'));
    const d = deps({
      tideStations: vi.fn(async () => [tideStation, replacement]),
      tideEvents: tideEventsFetch,
    });
    const loader = createTidesLoader(d);
    const store = new TidesStore();
    store.requestManual('tide', tideStation, 0);
    await loader.load(store, 27.7, -82.7);
    const acceptedCatalog = store.nearbyTideStations;
    store.requestManual('tide', replacement, 0);

    await loader.load(store, 27.7, -82.7, true);

    expect(store.status).toBe('error');
    expect(store.tide?.station.id).toBe('T1');
    expect(store.source).toBe('noaa-coops');
    expect(store.loadedTide).toMatchObject({ mode: 'manual', station: { id: 'T1' } });
    expect(store.failure('tide')?.requested).toMatchObject({
      mode: 'manual',
      station: { id: 'T2' },
    });
    expect(store.nearbyTideStations.map(({ station }) => station.id)).toEqual(
      acceptedCatalog.map(({ station }) => station.id),
    );
  });

  it('prevents a late automatic request from overwriting newer manual intent', async () => {
    let resolvePlugin: ((value: typeof pluginReading) => void) | undefined;
    const manualTide = {
      id: 'T2',
      name: 'Manual tide',
      latitude: 27.71,
      longitude: -82.71,
    };
    const pluginTides = vi.fn(
      () => new Promise<typeof pluginReading>((resolve) => (resolvePlugin = resolve)),
    );
    const d = deps({
      pluginAvailable: () => true,
      pluginTides,
      tideStations: vi.fn(async () => [tideStation, manualTide]),
    });
    const loader = createTidesLoader(d);
    const store = new TidesStore();
    const automatic = loader.load(store, 27.7, -82.7);
    store.requestManual('tide', manualTide, 0);
    const manual = loader.load(store, 27.7, -82.7, true);
    resolvePlugin?.(pluginReading);

    await Promise.all([automatic, manual]);

    expect(store.requestedTide).toMatchObject({ mode: 'manual', station: { id: 'T2' } });
    expect(store.loadedTide).toMatchObject({ mode: 'manual', station: { id: 'T2' } });
    expect(store.tide?.station.id).toBe('T2');
  });

  it('lets a forced retry bypass the failure cooldown', async () => {
    const tideEventsFetch = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(tideEvents);
    const d = deps({ tideEvents: tideEventsFetch });
    const loader = createTidesLoader(d);
    const store = new TidesStore();

    await loader.load(store, 27.7, -82.7);
    await loader.load(store, 27.8, -82.8);
    expect(tideEventsFetch).toHaveBeenCalledTimes(1);

    await loader.load(store, 27.8, -82.8, true);
    expect(tideEventsFetch).toHaveBeenCalledTimes(2);
    expect(store.status).toBe('ready');
  });

  it('keeps a manual selection and exact reading after panning beyond the nearby catalog', async () => {
    const loader = createTidesLoader(deps());
    const store = new TidesStore();
    store.requestManual('tide', tideStation, 0);
    await loader.load(store, 27.7, -82.7);

    await loader.load(store, 35, -90, true);

    expect(store.requestedTide).toMatchObject({ mode: 'manual', station: { id: 'T1' } });
    expect(store.loadedTide).toMatchObject({ mode: 'manual', station: { id: 'T1' } });
    expect(store.tide?.station.id).toBe('T1');
    expect(store.tide?.distanceMeters).toBeGreaterThan(100_000);
    expect(store.nearbyTideStations).toEqual([]);
  });
});
