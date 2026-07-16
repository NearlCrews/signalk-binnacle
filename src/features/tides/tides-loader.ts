import type {
  CurrentEvent,
  CurrentReading,
  TideEvent,
  TideReading,
  TideStation,
  TidesStore,
} from '$entities/tides';
import { quantizeCellDeg } from '$shared/geo';
import { DAY_MS, MINUTE_MS } from '$shared/lib';
import { haversineMeters } from '$shared/nav';
import { createExpiringStore, type ExpiringStore, MemoryCache } from '$shared/storage';
import {
  fetchCurrentEvents,
  fetchCurrentStations,
  fetchTideEvents,
  fetchTideStations,
  utcYmd,
} from './coops-client';
import { fetchSignalkTidesReading } from './signalk-tides-client';
import { nearestStations } from './station-proximity';

// One persisted store holds every tier; the key prefix (stations:, tide:, current:, plugin:)
// names which member of this union a value is, so each read site can narrow safely.
export type TidesPersistValue = TideStation[] | TideEvent[] | CurrentEvent[] | TideReading;

interface LoaderDeps {
  tideStations: () => Promise<TideStation[]>;
  currentStations: () => Promise<TideStation[]>;
  tideEvents: (stationId: string) => Promise<TideEvent[]>;
  currentEvents: (stationId: string) => Promise<CurrentEvent[]>;
  now: () => number;
  // Persists the station lists and the day's predictions across reloads (IndexedDB works over
  // plain http, where the service worker is inert), so a reload shows tides without a fetch.
  persist: ExpiringStore<TidesPersistValue>;
  // Whether the signalk-tides plugin is installed and enabled on the server. The host wires this
  // from the server's feature discovery; the default never prefers the plugin, so a stock server
  // gets CO-OPS exactly as before.
  pluginAvailable: () => boolean;
  // The plugin's tide reading for the vessel's position, or undefined when it has nothing to give.
  pluginTides: (lat: number, lon: number) => Promise<TideReading | undefined>;
}

export interface TidesLoader {
  load(store: TidesStore, lat: number, lon: number, force?: boolean): Promise<void>;
}

// A tide station up to 100 km away is still a useful approximation; a tidal-current station is a
// local feature, so it uses a tighter radius.
const TIDE_RADIUS_M = 100_000;
const CURRENT_RADIUS_M = 60_000;
// How many of the nearest current stations to try before giving up on a current reading. Several
// of the very nearest are often reference-only points that serve no predictions, so this is generous.
const CURRENT_TRIES = 6;
// The station lists are nearly static, so they refresh once a day. After a failed fetch, back off
// before retrying so a flaky network is not hammered.
const STATIONS_TTL_MS = DAY_MS;
const COOLDOWN_MS = 5 * MINUTE_MS;
// A backstop on the per-station event caches so a long session of panning cannot grow them forever.
const MAX_EVENT_ENTRIES = 24;
// Skip a reload when the view barely moved and a reading is already on screen, so small pans do not
// flicker the panel or rerun the nearest-station search.
const SKIP_RADIUS_M = 3000;
// The persisted station lists outlive the in-memory daily refresh so an offline reload still has
// them; they are nearly static, so a week-old list is still right.
const STATIONS_PERSIST_MS = 7 * DAY_MS;
// Two station lists, a day's events for up to MAX_EVENT_ENTRIES stations of each kind, and a
// few plugin readings.
const MAX_PLUGIN_PERSIST_ENTRIES = 6;
const MAX_PERSIST_ENTRIES = 2 + 2 * MAX_EVENT_ENTRIES + MAX_PLUGIN_PERSIST_ENTRIES;
const TIDE_STATIONS_KEY = 'stations:tide';
const CURRENT_STATIONS_KEY = 'stations:current';

// Persisted predictions expire at the end of the 48-hour window the day's fetch covered. The day
// in the key already retires them at the UTC-midnight rollover; the expiry only bounds how long a
// stale-day entry lingers before a prune sweeps it.
function eventsExpiresAt(nowMs: number): number {
  const d = new Date(nowMs);
  const nextUtcMidnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) + DAY_MS;
  return nextUtcMidnight + 2 * DAY_MS;
}

const realDeps: LoaderDeps = {
  tideStations: fetchTideStations,
  currentStations: fetchCurrentStations,
  tideEvents: fetchTideEvents,
  currentEvents: fetchCurrentEvents,
  now: () => Date.now(),
  persist: createExpiringStore<TidesPersistValue>('binnacle-tides-data', {
    maxEntries: MAX_PERSIST_ENTRIES,
  }),
  pluginAvailable: () => false,
  pluginTides: (lat, lon) => fetchSignalkTidesReading(lat, lon),
};

// The per-station event cache rolls over on the UTC day, matching the CO-OPS fetch window (both
// derive from utcYmd), so the cache and the window roll over at the same UTC-midnight instant.
const dayKey = (ms: number): string => utcYmd(ms, '-');

// A tides loader with its own session caches: the station lists are fetched once a day, and each
// station's events are kept for the day so panning back to a covered area is instant. It feeds the
// nearest tide and current readings into the store, or flags no coverage outside US waters.
export function createTidesLoader(overrides: Partial<LoaderDeps> = {}): TidesLoader {
  const deps = { ...realDeps, ...overrides };
  let tideList: TideStation[] | undefined;
  let currentList: TideStation[] | undefined;
  let listsAt = 0;
  // Bounded per-station caches with the default infinite TTL: the day field invalidates an entry, so
  // a non-current entry is refetched rather than expired by time. MemoryCache only caps the size.
  const tideEventCache = new MemoryCache<{ events: TideEvent[]; day: string }>(MAX_EVENT_ENTRIES);
  const currentEventCache = new MemoryCache<{ events: CurrentEvent[]; day: string }>(
    MAX_EVENT_ENTRIES,
  );
  let cooldownUntil = 0;
  let requestGeneration = 0;
  let running = false;
  let queued:
    | {
        store: TidesStore;
        lat: number;
        lon: number;
        force: boolean;
        generation: number;
        waiters: Array<() => void>;
      }
    | undefined;
  let lastLat: number | undefined;
  let lastLon: number | undefined;
  // The day of the last load, so an anchored boat still refetches after midnight when the
  // 48-hour event window would otherwise age out behind the skip radius.
  let lastDay: string | undefined;

  async function ensureLists(nowMs: number): Promise<void> {
    if (tideList && currentList && nowMs - listsAt < STATIONS_TTL_MS) return;
    // Only a reload (no in-memory lists yet) promotes the persisted copy; an in-session daily
    // refresh goes to the network so a long-running session keeps converging on current data.
    if (!tideList || !currentList) {
      const [storedTides, storedCurrents] = await Promise.all([
        deps.persist.get(TIDE_STATIONS_KEY),
        deps.persist.get(CURRENT_STATIONS_KEY),
      ]);
      if (
        storedTides &&
        storedTides.expires > nowMs &&
        storedCurrents &&
        storedCurrents.expires > nowMs
      ) {
        tideList = storedTides.value as TideStation[];
        currentList = storedCurrents.value as TideStation[];
        listsAt = nowMs;
        void deps.persist.prune(nowMs);
        return;
      }
    }
    const [tides, currents] = await Promise.all([deps.tideStations(), deps.currentStations()]);
    tideList = tides;
    currentList = currents;
    listsAt = nowMs;
    await Promise.all([
      deps.persist.put(TIDE_STATIONS_KEY, tides, nowMs + STATIONS_PERSIST_MS),
      deps.persist.put(CURRENT_STATIONS_KEY, currents, nowMs + STATIONS_PERSIST_MS),
    ]);
    void deps.persist.prune(nowMs);
  }

  // Resolve a station's day-keyed events through the in-memory cache, then the persisted store,
  // then the network (the weather loader's promote pattern), so a reload reuses the day's
  // predictions without a fetch.
  async function eventsFor<E extends TideEvent[] | CurrentEvent[]>(
    cache: MemoryCache<{ events: E; day: string }>,
    prefix: 'tide' | 'current',
    fetchEvents: (stationId: string) => Promise<E>,
    stationId: string,
    nowMs: number,
    day: string,
  ): Promise<E> {
    const entry = cache.get(stationId, nowMs);
    if (entry && entry.day === day) return entry.events;
    const key = `${prefix}:${stationId}:${day}`;
    const stored = await deps.persist.get(key);
    if (stored && stored.expires > nowMs) {
      const events = stored.value as E;
      cache.put(stationId, { events, day }, nowMs);
      void deps.persist.prune(nowMs);
      return events;
    }
    const events = await fetchEvents(stationId);
    cache.put(stationId, { events, day }, nowMs);
    await deps.persist.put(key, events, eventsExpiresAt(nowMs));
    void deps.persist.prune(nowMs);
    return events;
  }

  // The nearest current station is often a reference-only point that serves no predictions, so
  // try the nearest few and take the first that actually returns events.
  async function nearestCurrent(
    lat: number,
    lon: number,
    nowMs: number,
    day: string,
  ): Promise<CurrentReading | undefined> {
    const nearCurrents = nearestStations(
      currentList ?? [],
      lat,
      lon,
      CURRENT_TRIES,
      CURRENT_RADIUS_M,
    );
    for (const candidate of nearCurrents) {
      const events = await eventsFor(
        currentEventCache,
        'current',
        deps.currentEvents,
        candidate.station.id,
        nowMs,
        day,
      );
      if (events.length > 0) {
        return {
          station: candidate.station,
          distanceMeters: candidate.distanceMeters,
          events,
        };
      }
    }
    return undefined;
  }

  // Tidal currents still come from CO-OPS even when the plugin serves the tide (the plugin carries
  // only tide heights), but a CO-OPS failure must not take down a plugin-served reading, so this
  // degrades to no current instead of throwing.
  async function nearestCurrentOrUndefined(
    lat: number,
    lon: number,
    nowMs: number,
    day: string,
  ): Promise<CurrentReading | undefined> {
    try {
      await ensureLists(nowMs);
      return await nearestCurrent(lat, lon, nowMs, day);
    } catch {
      return undefined;
    }
  }

  async function performLoad(
    store: TidesStore,
    lat: number,
    lon: number,
    force: boolean,
    generation: number,
  ): Promise<void> {
    const nowMs = deps.now();
    if (!force && nowMs < cooldownUntil) return;
    const settled = store.status === 'ready' || store.status === 'no-coverage';
    if (
      !force &&
      settled &&
      lastLat !== undefined &&
      lastLon !== undefined &&
      dayKey(nowMs) === lastDay
    ) {
      if (haversineMeters(lastLat, lastLon, lat, lon) < SKIP_RADIUS_M) return;
    }
    const isCurrent = (): boolean => generation === requestGeneration;
    store.setLoading();
    try {
      const day = dayKey(nowMs);
      // Prefer the signalk-tides plugin when the server has it; anything it cannot answer
      // (mid-start, no position fix, outside its sources' coverage) falls through to CO-OPS,
      // including a rejection from an injected pluginTides. The plugin answers for the vessel's
      // position, so when the viewed point is beyond the same usefulness radius CO-OPS stations
      // get, fall through too: a pan to a far coast should show that coast, not the boat's tides.
      if (deps.pluginAvailable()) {
        const pluginKey = `plugin:${quantizeCellDeg(lat)},${quantizeCellDeg(lon)}:${day}`;
        let pluginTide = await deps.pluginTides(lat, lon).catch(() => undefined);
        const fromNetwork = pluginTide !== undefined;
        if (!pluginTide) {
          // A plugin hiccup (mid-start, offline) replays the day's persisted reading for this
          // spot before conceding to CO-OPS, which is just as unreachable with the network down.
          const stored = await deps.persist.get(pluginKey);
          if (stored && stored.expires > nowMs) {
            // The key quantizes to a 0.1 degree cell, so the stored distance was measured from
            // a point up to several km away; remeasure from here before the radius gate.
            const replayed = stored.value as TideReading;
            pluginTide = {
              ...replayed,
              distanceMeters: haversineMeters(
                lat,
                lon,
                replayed.station.latitude,
                replayed.station.longitude,
              ),
            };
            void deps.persist.prune(nowMs);
          }
        }
        if (pluginTide && pluginTide.distanceMeters <= TIDE_RADIUS_M) {
          if (!isCurrent()) return;
          lastLat = lat;
          lastLon = lon;
          lastDay = day;
          if (fromNetwork) {
            await deps.persist.put(pluginKey, pluginTide, eventsExpiresAt(nowMs));
            void deps.persist.prune(nowMs);
          }
          const current = await nearestCurrentOrUndefined(lat, lon, nowMs, day);
          if (!isCurrent()) return;
          store.setReadings(pluginTide, current, 'signalk-tides');
          return;
        }
      }
      await ensureLists(nowMs);
      if (!isCurrent()) return;
      lastLat = lat;
      lastLon = lon;
      lastDay = day;
      const nearTide = nearestStations(tideList ?? [], lat, lon, 1, TIDE_RADIUS_M)[0];
      if (!nearTide) {
        store.setNoCoverage();
        return;
      }
      // The tide events and the current-station lookup are independent round trips; running
      // them concurrently halves the cold-start wait on a slow boat link.
      const [events, current] = await Promise.all([
        eventsFor(tideEventCache, 'tide', deps.tideEvents, nearTide.station.id, nowMs, day),
        // Per-station isolation: a current-station fetch (a reference-only station the loop skips,
        // a CO-OPS hiccup) must degrade to no current, not reject the whole load and discard the
        // tide events already fetched alongside it.
        nearestCurrentOrUndefined(lat, lon, nowMs, day),
      ]);
      const tide: TideReading = {
        station: nearTide.station,
        distanceMeters: nearTide.distanceMeters,
        events,
      };
      if (!isCurrent()) return;
      store.setReadings(tide, current, 'noaa-coops');
    } catch (error) {
      if (!isCurrent()) return;
      cooldownUntil = deps.now() + COOLDOWN_MS;
      // Leave a breadcrumb: a persistent tides failure (provider down, network, parse) is
      // otherwise undiagnosable behind the generic error state and the cooldown.
      console.warn('[tides] load failed', error);
      store.setError();
    }
  }

  async function drain(first: NonNullable<typeof queued>): Promise<void> {
    let request: NonNullable<typeof queued> | undefined = first;
    while (request) {
      try {
        await performLoad(
          request.store,
          request.lat,
          request.lon,
          request.force,
          request.generation,
        );
      } finally {
        for (const resolve of request.waiters) resolve();
      }
      request = queued;
      queued = undefined;
    }
    running = false;
  }

  return {
    load(store, lat, lon, force = false) {
      const generation = ++requestGeneration;
      return new Promise<void>((resolve) => {
        const request = { store, lat, lon, force, generation, waiters: [resolve] };
        if (!running) {
          running = true;
          void drain(request);
          return;
        }
        // Keep only the latest queued position. Earlier callers settle with that latest request,
        // bounding provider traffic to one active request and one pending request during rapid pans.
        queued = queued
          ? {
              ...request,
              force: queued.force || request.force,
              waiters: [...queued.waiters, resolve],
            }
          : request;
      });
    },
  };
}
