import type {
  CurrentEvent,
  NearbyTideStation,
  TideEvent,
  TideReading,
  TideSelectionSnapshot,
  TideStation,
  TideStationSelection,
  TidesLoadResult,
  TidesStore,
} from '$entities/tides';
import { isTideStation, MAX_NEARBY_STATIONS } from '$entities/tides';
import { quantizeCellDeg } from '$shared/geo';
import { DAY_MS, isFiniteNumber, isRecord, MINUTE_MS } from '$shared/lib';
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

interface StationLists {
  tide: TideStation[];
  current: TideStation[];
}

type TideOutcome = TidesLoadResult['tide'];
type CurrentOutcome = TidesLoadResult['current'];

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
// Skip provider work when the view barely moved in automatic mode. Catalog and reading distances
// are still recalculated before this gate, and cached full lists rebuild the bounded catalogs.
const SKIP_RADIUS_M = 3000;
// The persisted station lists outlive the in-memory daily refresh so an offline reload still has
// them; they are nearly static, so a week-old list is still right.
const STATIONS_PERSIST_MS = 7 * DAY_MS;
// Two station lists, a day's events for up to MAX_EVENT_ENTRIES stations of each kind, and a
// few plugin readings.
const MAX_PLUGIN_PERSIST_ENTRIES = 6;
const MAX_PERSIST_ENTRIES = 2 + 2 * MAX_EVENT_ENTRIES + MAX_PLUGIN_PERSIST_ENTRIES;
const MAX_STATION_LIST_ENTRIES = 20_000;
const MAX_EVENTS_PER_READING = 200;
const TIDE_STATIONS_KEY = 'stations:tide';
const CURRENT_STATIONS_KEY = 'stations:current';

function validatedStations(value: unknown): TideStation[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_STATION_LIST_ENTRIES) return undefined;
  const stations = value.filter(isTideStation);
  return value.length === 0 || stations.length > 0 ? stations : undefined;
}

function isTideEvent(value: unknown): value is TideEvent {
  return (
    isRecord(value) &&
    isFiniteNumber(value.timeMs) &&
    isFiniteNumber(value.heightMeters) &&
    Math.abs(value.heightMeters) <= 100 &&
    (value.kind === 'high' || value.kind === 'low')
  );
}

function isCurrentEvent(value: unknown): value is CurrentEvent {
  return (
    isRecord(value) &&
    isFiniteNumber(value.timeMs) &&
    isFiniteNumber(value.velocityMps) &&
    value.velocityMps >= 0 &&
    value.velocityMps <= 100 &&
    (value.directionRad === undefined ||
      (isFiniteNumber(value.directionRad) &&
        value.directionRad >= 0 &&
        value.directionRad <= 2 * Math.PI)) &&
    (value.kind === 'flood' || value.kind === 'ebb' || value.kind === 'slack')
  );
}

function validatedEvents<E extends TideEvent | CurrentEvent>(
  value: unknown,
  validate: (event: unknown) => event is E,
): E[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_EVENTS_PER_READING) return undefined;
  const events: E[] = [];
  let changed = false;
  let sorted = true;
  let previousTime = Number.NEGATIVE_INFINITY;
  for (const event of value) {
    if (!validate(event)) {
      changed = true;
      continue;
    }
    if (event.timeMs < previousTime) sorted = false;
    previousTime = event.timeMs;
    events.push(event);
  }
  if (value.length > 0 && events.length === 0) return undefined;
  if (!changed && sorted) return value as E[];
  return events.sort((left, right) => left.timeMs - right.timeMs);
}

const validatedTideEvents = (value: unknown): TideEvent[] | undefined =>
  validatedEvents(value, isTideEvent);

const validatedCurrentEvents = (value: unknown): CurrentEvent[] | undefined =>
  validatedEvents(value, isCurrentEvent);

function validatedTideReading(value: unknown): TideReading | undefined {
  if (!isRecord(value) || !isTideStation(value.station)) return undefined;
  const events = validatedTideEvents(value.events);
  if (
    !events ||
    events.length === 0 ||
    !isFiniteNumber(value.distanceMeters) ||
    value.distanceMeters < 0
  ) {
    return undefined;
  }
  if (events === value.events) return value as unknown as TideReading;
  return { station: value.station, distanceMeters: value.distanceMeters, events };
}

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

function manualSelectionAt(
  selection: Extract<TideStationSelection, { mode: 'manual' }>,
  lat: number,
  lon: number,
): TideStationSelection {
  return {
    ...selection,
    distanceMeters: haversineMeters(
      lat,
      lon,
      selection.station.latitude,
      selection.station.longitude,
    ),
  };
}

function selectionAt(
  selection: TideStationSelection,
  lat: number,
  lon: number,
): TideStationSelection {
  return selection.mode === 'manual' ? manualSelectionAt(selection, lat, lon) : selection;
}

function snapshotAt(
  selection: TideSelectionSnapshot,
  lat: number,
  lon: number,
): TideSelectionSnapshot {
  return {
    tide: selectionAt(selection.tide, lat, lon),
    current: selectionAt(selection.current, lat, lon),
  };
}

function automaticSnapshot(selection: TideSelectionSnapshot): boolean {
  return selection.tide.mode === 'automatic' && selection.current.mode === 'automatic';
}

function catalogs(
  lists: StationLists,
  lat: number,
  lon: number,
): {
  nearbyTideStations: NearbyTideStation[];
  nearbyCurrentStations: NearbyTideStation[];
} {
  return {
    nearbyTideStations: nearestStations(lists.tide, lat, lon, MAX_NEARBY_STATIONS, TIDE_RADIUS_M),
    nearbyCurrentStations: nearestStations(
      lists.current,
      lat,
      lon,
      MAX_NEARBY_STATIONS,
      CURRENT_RADIUS_M,
    ),
  };
}

// A tides loader with session caches and one active plus one latest queued request. Every queued
// request snapshots independent tide and current intent. Only its generation can publish catalogs,
// readings, provider provenance, failure state, and successfully loaded selections.
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
        selection: TideSelectionSnapshot;
        waiters: Array<() => void>;
      }
    | undefined;
  let lastLat: number | undefined;
  let lastLon: number | undefined;
  let lastDay: string | undefined;
  let lastSelection: TideSelectionSnapshot | undefined;

  async function ensureLists(nowMs: number): Promise<StationLists> {
    if (tideList && currentList && nowMs - listsAt < STATIONS_TTL_MS) {
      return { tide: tideList, current: currentList };
    }
    // Only a reload (no in-memory lists yet) promotes the persisted copy. An in-session daily
    // refresh asks the network, but a failure retains the accepted lists instead of blanking the
    // bounded catalog.
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
        const tides = validatedStations(storedTides.value);
        const currents = validatedStations(storedCurrents.value);
        if (tides && currents) {
          tideList = tides;
          currentList = currents;
          listsAt = nowMs;
          void deps.persist.prune(nowMs);
          return { tide: tides, current: currents };
        }
      }
    }
    try {
      const [rawTides, rawCurrents] = await Promise.all([
        deps.tideStations(),
        deps.currentStations(),
      ]);
      const tides = validatedStations(rawTides);
      const currents = validatedStations(rawCurrents);
      if (!tides || !currents) throw new Error('Invalid tide station catalog');
      tideList = tides;
      currentList = currents;
      listsAt = nowMs;
      await Promise.all([
        deps.persist.put(TIDE_STATIONS_KEY, tides, nowMs + STATIONS_PERSIST_MS),
        deps.persist.put(CURRENT_STATIONS_KEY, currents, nowMs + STATIONS_PERSIST_MS),
      ]);
      void deps.persist.prune(nowMs);
      return { tide: tides, current: currents };
    } catch (error) {
      if (tideList && currentList) return { tide: tideList, current: currentList };
      throw error;
    }
  }

  // Resolve a station's day-keyed events through the in-memory cache, then the persisted store,
  // then the network, so a reload reuses the day's predictions without a fetch. Empty arrays are
  // valid cache entries and mean the selected station has no events in this window.
  async function eventsFor<E extends TideEvent[] | CurrentEvent[]>(
    cache: MemoryCache<{ events: E; day: string }>,
    prefix: 'tide' | 'current',
    fetchEvents: (stationId: string) => Promise<E>,
    stationId: string,
    nowMs: number,
    day: string,
    validate: (value: unknown) => E | undefined,
  ): Promise<E> {
    const entry = cache.get(stationId, nowMs);
    if (entry && entry.day === day) return entry.events;
    const key = `${prefix}:${stationId}:${day}`;
    const stored = await deps.persist.get(key);
    if (stored && stored.expires > nowMs) {
      const events = validate(stored.value);
      if (events) {
        cache.put(stationId, { events, day }, nowMs);
        void deps.persist.prune(nowMs);
        return events;
      }
    }
    const events = validate(await fetchEvents(stationId));
    if (!events) throw new Error(`Invalid ${prefix} event response`);
    cache.put(stationId, { events, day }, nowMs);
    await deps.persist.put(key, events, eventsExpiresAt(nowMs));
    void deps.persist.prune(nowMs);
    return events;
  }

  async function pluginTide(
    lat: number,
    lon: number,
    nowMs: number,
    day: string,
  ): Promise<TideReading | undefined> {
    if (!deps.pluginAvailable()) return undefined;
    const pluginKey = `plugin:${quantizeCellDeg(lat)},${quantizeCellDeg(lon)}:${day}`;
    let reading = validatedTideReading(await deps.pluginTides(lat, lon).catch(() => undefined));
    const fromNetwork = reading !== undefined;
    if (!reading) {
      const stored = await deps.persist.get(pluginKey);
      if (stored && stored.expires > nowMs) {
        const replayed = validatedTideReading(stored.value);
        if (replayed) {
          reading = {
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
    }
    if (!reading || reading.distanceMeters > TIDE_RADIUS_M) return undefined;
    if (fromNetwork) {
      await deps.persist.put(pluginKey, reading, eventsExpiresAt(nowMs));
      void deps.persist.prune(nowMs);
    }
    return reading;
  }

  async function loadTide(
    selection: TideStationSelection,
    lists: StationLists | undefined,
    automaticPlugin: Promise<TideReading | undefined> | undefined,
    lat: number,
    lon: number,
    nowMs: number,
    day: string,
  ): Promise<TideOutcome> {
    try {
      if (selection.mode === 'manual') {
        const events = await eventsFor(
          tideEventCache,
          'tide',
          deps.tideEvents,
          selection.station.id,
          nowMs,
          day,
          validatedTideEvents,
        );
        return {
          state: 'accepted',
          reading: {
            station: selection.station,
            distanceMeters: selection.distanceMeters,
            events,
          },
          source: 'noaa-coops',
          selection,
        };
      }

      const plugin = await automaticPlugin;
      if (plugin) {
        return {
          state: 'accepted',
          reading: plugin,
          source: 'signalk-tides',
          selection,
        };
      }
      if (!lists) return { state: 'failed', selection };
      const nearest = nearestStations(lists.tide, lat, lon, 1, TIDE_RADIUS_M)[0];
      if (!nearest) return { state: 'no-coverage', selection };
      const events = await eventsFor(
        tideEventCache,
        'tide',
        deps.tideEvents,
        nearest.station.id,
        nowMs,
        day,
        validatedTideEvents,
      );
      return {
        state: 'accepted',
        reading: { ...nearest, events },
        source: 'noaa-coops',
        selection,
      };
    } catch (error) {
      console.warn('[tides] tide load failed', error);
      return { state: 'failed', selection };
    }
  }

  async function loadCurrent(
    selection: TideStationSelection,
    lists: StationLists | undefined,
    lat: number,
    lon: number,
    nowMs: number,
    day: string,
  ): Promise<CurrentOutcome> {
    if (selection.mode === 'manual') {
      try {
        const events = await eventsFor(
          currentEventCache,
          'current',
          deps.currentEvents,
          selection.station.id,
          nowMs,
          day,
          validatedCurrentEvents,
        );
        return {
          state: 'accepted',
          reading: {
            station: selection.station,
            distanceMeters: selection.distanceMeters,
            events,
          },
          selection,
        };
      } catch (error) {
        console.warn('[tides] current load failed', error);
        return { state: 'failed', selection };
      }
    }
    if (!lists) return { state: 'failed', selection };

    const candidates = nearestStations(lists.current, lat, lon, CURRENT_TRIES, CURRENT_RADIUS_M);
    let failed = false;
    for (const candidate of candidates) {
      try {
        const events = await eventsFor(
          currentEventCache,
          'current',
          deps.currentEvents,
          candidate.station.id,
          nowMs,
          day,
          validatedCurrentEvents,
        );
        // Automatic mode keeps searching past valid empty reference stations. A manual exact
        // selection accepts the same empty response above.
        if (events.length > 0) {
          return {
            state: 'accepted',
            reading: { ...candidate, events },
            selection,
          };
        }
      } catch {
        failed = true;
      }
    }
    return failed ? { state: 'failed', selection } : { state: 'no-coverage', selection };
  }

  function sameSelection(a: TideSelectionSnapshot | undefined, b: TideSelectionSnapshot): boolean {
    if (!a || a.tide.mode !== b.tide.mode || a.current.mode !== b.current.mode) return false;
    if (a.tide.mode === 'manual' && b.tide.mode === 'manual') {
      if (a.tide.station.id !== b.tide.station.id) return false;
    }
    if (a.current.mode === 'manual' && b.current.mode === 'manual') {
      if (a.current.station.id !== b.current.station.id) return false;
    }
    return true;
  }

  async function performLoad(request: NonNullable<typeof queued>): Promise<void> {
    const { store, lat, lon, force, generation } = request;
    const nowMs = deps.now();
    const selection = snapshotAt(request.selection, lat, lon);
    const isCurrent = (): boolean => generation === requestGeneration;
    if (!force && nowMs < cooldownUntil) return;

    const day = dayKey(nowMs);
    const movedLittle =
      !force &&
      automaticSnapshot(selection) &&
      sameSelection(lastSelection, selection) &&
      lastLat !== undefined &&
      lastLon !== undefined &&
      day === lastDay &&
      haversineMeters(lastLat, lastLon, lat, lon) < SKIP_RADIUS_M;

    let lists: StationLists | undefined;
    // Start the preferred automatic provider before the independent NOAA catalog lookup. This
    // preserves plugin-first latency while the catalog warms for the panel and current selection.
    const automaticPlugin =
      selection.tide.mode === 'automatic' ? pluginTide(lat, lon, nowMs, day) : undefined;
    try {
      lists = await ensureLists(nowMs);
    } catch (error) {
      console.warn('[tides] station catalog load failed', error);
    }
    if (!isCurrent()) {
      // Keep the one-active-request contract even after newer intent supersedes this generation.
      // The result is discarded, but its provider round trip settles before the queued request starts.
      await automaticPlugin?.catch(() => undefined);
      return;
    }
    if (movedLittle) {
      if (lists) {
        const nearby = catalogs(lists, lat, lon);
        store.setCatalogs(nearby.nearbyTideStations, nearby.nearbyCurrentStations);
      }
      return;
    }

    store.setLoading();
    const [tide, current] = await Promise.all([
      loadTide(selection.tide, lists, automaticPlugin, lat, lon, nowMs, day),
      loadCurrent(selection.current, lists, lat, lon, nowMs, day),
    ]);
    if (!isCurrent()) return;

    const nearby = lists ? catalogs(lists, lat, lon) : {};
    store.applyLoad({ ...nearby, tide, current });
    if (tide.state === 'failed' || current.state === 'failed') {
      cooldownUntil = deps.now() + COOLDOWN_MS;
    }
    lastLat = lat;
    lastLon = lon;
    lastDay = day;
    lastSelection = selection;
  }

  async function drain(first: NonNullable<typeof queued>): Promise<void> {
    let request: NonNullable<typeof queued> | undefined = first;
    try {
      while (request) {
        try {
          await performLoad(request);
        } catch (error) {
          console.warn('[tides] unexpected loader failure', error);
        } finally {
          for (const resolve of request.waiters) resolve();
        }
        request = queued;
        queued = undefined;
      }
    } finally {
      running = false;
      const next = queued;
      queued = undefined;
      if (next) {
        running = true;
        void drain(next);
      }
    }
  }

  return {
    load(store, lat, lon, force = false) {
      store.recalculateDistances(lat, lon);
      const generation = ++requestGeneration;
      const selection = store.selectionSnapshot();
      return new Promise<void>((resolve) => {
        const request = {
          store,
          lat,
          lon,
          force,
          generation,
          selection,
          waiters: [resolve],
        };
        if (!running) {
          running = true;
          void drain(request);
          return;
        }
        // Keep only the latest queued position and its selection snapshot. Earlier callers settle
        // with that latest request, bounding provider traffic to one active and one pending request.
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
