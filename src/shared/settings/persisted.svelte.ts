import { isLatitude, isLongitude, type MapView } from '$shared/geo';
import { isFiniteNumber, isRecord, nauticalMilesToMeters } from '$shared/lib';

export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function resolveStorage(injected?: StorageLike): StorageLike | undefined {
  if (injected) return injected;
  return typeof localStorage !== 'undefined' ? localStorage : undefined;
}

// A reactive value persisted to localStorage as JSON, with a default and a storage
// injection seam for tests. The field initializer is a placeholder the constructor
// immediately replaces with the read value.
export class PersistedValue<T> {
  value = $state<T>(undefined as unknown as T);

  // True when `value` was loaded from storage, false when it fell back to the default.
  // Lets a caller persist a freshly generated default only on first run.
  readonly fromStorage: boolean;

  #key: string;
  #storage: StorageLike | undefined;
  #validate: ((value: unknown) => value is T) | undefined;

  constructor(
    key: string,
    fallback: T,
    storage?: StorageLike,
    validate?: (value: unknown) => value is T,
  ) {
    this.#key = key;
    this.#storage = resolveStorage(storage);
    this.#validate = validate;
    const read = this.#read(fallback);
    this.fromStorage = read.fromStorage;
    this.value = read.value;
  }

  set(next: T): void {
    this.value = next;
    try {
      this.#storage?.setItem(this.#key, JSON.stringify(next));
    } catch (error) {
      // A failed persist (quota exceeded, private mode) must not break the in-memory update; a
      // breadcrumb makes "my settings stopped persisting" diagnosable without breaking anything.
      console.warn(`Could not persist "${this.#key}".`, error);
    }
  }

  // Reports whether the value came from storage by key presence and a successful
  // parse, not by comparing to the default: a stored primitive equal to the default
  // is still "from storage", which a value compare would miss.
  #read(fallback: T): { value: T; fromStorage: boolean } {
    const raw = this.#storage?.getItem(this.#key);
    if (raw == null) return { value: fallback, fromStorage: false };
    try {
      const parsed: unknown = JSON.parse(raw);
      // A value that drifted across a beta release (a renamed or dropped field) or was corrupted
      // would otherwise flow in untyped and surface deep in use (a NaN threshold silently disabling
      // an alarm). When a validator is supplied and rejects it, fall back to the default.
      if (this.#validate && !this.#validate(parsed)) return { value: fallback, fromStorage: false };
      return { value: parsed as T, fromStorage: true };
    } catch {
      return { value: fallback, fromStorage: false };
    }
  }
}

// Guards a stored view against corruption: a NaN or out-of-range center would break the map.
export function isMapView(value: unknown): value is MapView {
  if (!isRecord(value)) return false;
  return (
    isLatitude(value.lat) &&
    isLongitude(value.lon) &&
    isFiniteNumber(value.zoom) &&
    value.zoom >= 0 &&
    value.zoom <= 24
  );
}

export function createMapView(
  key = 'binnacle:map-view',
  storage?: StorageLike,
): PersistedValue<MapView | null> {
  return new PersistedValue(key, null, storage);
}

// Track recording policy and rendering preference, persisted across visits.
export interface TrackSettings {
  intervalSeconds: number;
  minMeters: number;
  colorMode: 'speed' | 'solid';
}

const DEFAULT_TRACK_SETTINGS: TrackSettings = {
  intervalSeconds: 10,
  minMeters: 10,
  colorMode: 'speed',
};

// Guards a stored track-recording policy against schema drift or corruption, so a malformed value
// falls back to the defaults rather than feeding NaN into the recorder.
export function isTrackSettings(value: unknown): value is TrackSettings {
  return (
    isRecord(value) &&
    isFiniteNumber(value.intervalSeconds) &&
    isFiniteNumber(value.minMeters) &&
    (value.colorMode === 'speed' || value.colorMode === 'solid')
  );
}

export function createTrackSettings(storage?: StorageLike): PersistedValue<TrackSettings> {
  return new PersistedValue(
    'binnacle:track-settings',
    DEFAULT_TRACK_SETTINGS,
    storage,
    isTrackSettings,
  );
}

export interface Thresholds {
  dangerCpaMeters: number;
  dangerTcpaSeconds: number;
  warningCpaMeters: number;
  warningTcpaSeconds: number;
  // Optional, not required, so a threshold record persisted before this field existed still
  // validates: isThresholds must accept it absent, or every such record (including a user's
  // customized collision thresholds) would fail validation and silently reset to defaults.
  // Callers read it as `t.shallowDepthMeters ?? DEFAULT_THRESHOLDS.shallowDepthMeters`.
  shallowDepthMeters?: number;
}

const MINUTE_S = 60;

export const DEFAULT_THRESHOLDS: Thresholds = {
  dangerCpaMeters: Math.round(nauticalMilesToMeters(0.5)),
  dangerTcpaSeconds: 10 * MINUTE_S,
  warningCpaMeters: Math.round(nauticalMilesToMeters(1)),
  warningTcpaSeconds: 20 * MINUTE_S,
  shallowDepthMeters: 3,
};

// Guards stored collision thresholds against schema drift or corruption: a missing field would
// otherwise read as NaN and silently disable the CPA/TCPA comparison that raises a collision alarm.
// shallowDepthMeters is checked only when present, since it did not exist in earlier persisted
// records and its absence there is expected, not corruption.
export function isThresholds(value: unknown): value is Thresholds {
  return (
    isRecord(value) &&
    isFiniteNumber(value.dangerCpaMeters) &&
    isFiniteNumber(value.dangerTcpaSeconds) &&
    isFiniteNumber(value.warningCpaMeters) &&
    isFiniteNumber(value.warningTcpaSeconds) &&
    (value.shallowDepthMeters === undefined || isFiniteNumber(value.shallowDepthMeters))
  );
}

export function createThresholds(storage?: StorageLike): PersistedValue<Thresholds> {
  return new PersistedValue(
    'binnacle:lookout-thresholds',
    DEFAULT_THRESHOLDS,
    storage,
    isThresholds,
  );
}
