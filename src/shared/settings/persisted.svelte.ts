import { isLatitude, isLongitude, type MapView } from '$shared/geo';
import { isFiniteNumber, isRecord, nauticalMilesToMeters } from '$shared/lib';

export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export type PersistedValidator<T> = (value: unknown) => value is T;

export type PersistedDecodeResult<T> =
  | { state: 'valid' | 'migrated'; value: T }
  | { state: 'invalid' };

// A codec owns the trust boundary between untyped storage JSON and production state. `migrated`
// means the decoded value is safe but should be written back in the current shape.
export interface PersistedCodec<T> {
  decode(value: unknown): PersistedDecodeResult<T>;
  encode?(value: T): unknown;
}

export type PersistedRepairStatus = 'none' | 'migrated' | 'replaced' | 'failed';

export function createPersistedCodec<T>(
  validate: PersistedValidator<T>,
  migrate?: (value: unknown) => T | undefined,
): PersistedCodec<T> {
  return {
    decode(value) {
      if (validate(value)) return { state: 'valid', value };
      const migrated = migrate?.(value);
      return migrated !== undefined && validate(migrated)
        ? { state: 'migrated', value: migrated }
        : { state: 'invalid' };
    },
  };
}

export function nullablePersistedCodec<T>(codec: PersistedCodec<T>): PersistedCodec<T | null> {
  return {
    decode: (value) => (value === null ? { state: 'valid', value: null } : codec.decode(value)),
    encode: (value) => (value === null ? null : codec.encode ? codec.encode(value) : value),
  };
}

export function arrayPersistedCodec<T>(
  codec: PersistedCodec<T>,
  options: { maxItems?: number } = {},
): PersistedCodec<T[]> {
  const maxItems = options.maxItems ?? 1_000;
  return {
    decode(value) {
      if (!Array.isArray(value) || value.length > maxItems) return { state: 'invalid' };
      const out: T[] = [];
      let migrated = false;
      for (const item of value) {
        const decoded = codec.decode(item);
        if (decoded.state === 'invalid') return { state: 'invalid' };
        migrated ||= decoded.state === 'migrated';
        out.push(decoded.value);
      }
      return { state: migrated ? 'migrated' : 'valid', value: out };
    },
    encode: (value) => value.map((item) => (codec.encode ? codec.encode(item) : item)),
  };
}

export const booleanPersistedCodec = createPersistedCodec(
  (value: unknown): value is boolean => typeof value === 'boolean',
);

export function boundedNumberPersistedCodec(min: number, max: number): PersistedCodec<number> {
  return createPersistedCodec(
    (value: unknown): value is number => isFiniteNumber(value) && value >= min && value <= max,
  );
}

export function enumPersistedCodec<const T extends string>(
  values: readonly T[],
): PersistedCodec<T> {
  const allowed = new Set<string>(values);
  return createPersistedCodec(
    (value: unknown): value is T => typeof value === 'string' && allowed.has(value),
  );
}

function containsAsciiControl(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

export function stringArrayPersistedCodec(
  options: { maxItems?: number; maxLength?: number } = {},
): PersistedCodec<string[]> {
  const maxItems = options.maxItems ?? 1_000;
  const maxLength = options.maxLength ?? 256;
  return {
    decode(value) {
      if (!Array.isArray(value) || value.length > maxItems) return { state: 'invalid' };
      const out: string[] = [];
      const seen = new Set<string>();
      let migrated = false;
      for (const item of value) {
        if (
          typeof item !== 'string' ||
          item.length === 0 ||
          item.length > maxLength ||
          containsAsciiControl(item)
        ) {
          return { state: 'invalid' };
        }
        if (seen.has(item)) {
          migrated = true;
          continue;
        }
        seen.add(item);
        out.push(item);
      }
      return { state: migrated ? 'migrated' : 'valid', value: out };
    },
  };
}

export function booleanRecordPersistedCodec(
  options: { maxEntries?: number; maxKeyLength?: number } = {},
): PersistedCodec<Record<string, boolean>> {
  const maxEntries = options.maxEntries ?? 1_000;
  const maxKeyLength = options.maxKeyLength ?? 256;
  return {
    decode(value) {
      if (!isRecord(value)) return { state: 'invalid' };
      const entries = Object.entries(value);
      if (entries.length > maxEntries) return { state: 'invalid' };
      const clean = Object.create(null) as Record<string, boolean>;
      for (const [key, item] of entries) {
        if (
          key.length === 0 ||
          key.length > maxKeyLength ||
          containsAsciiControl(key) ||
          key === '__proto__' ||
          key === 'prototype' ||
          key === 'constructor' ||
          typeof item !== 'boolean'
        ) {
          return { state: 'invalid' };
        }
        clean[key] = item;
      }
      return {
        state: 'valid',
        value: clean,
      };
    },
  };
}

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

  // Describes startup self-repair. Invalid or malformed JSON is replaced with the fallback, while
  // a codec migration is normalized in place. `failed` means storage itself rejected the read or
  // repair, but the in-memory fallback is still usable.
  readonly repairStatus: PersistedRepairStatus;

  #key: string;
  #storage: StorageLike | undefined;
  #codec: PersistedCodec<T> | undefined;

  constructor(
    key: string,
    fallback: T,
    storage?: StorageLike,
    validation?: PersistedValidator<T> | PersistedCodec<T>,
  ) {
    this.#key = key;
    this.#storage = resolveStorage(storage);
    this.#codec = typeof validation === 'function' ? createPersistedCodec(validation) : validation;
    const read = this.#read(fallback);
    this.fromStorage = read.fromStorage;
    this.repairStatus = read.repairStatus;
    this.value = read.value;
  }

  set(next: T): void {
    const decoded = this.#codec?.decode(next);
    if (decoded?.state === 'invalid') {
      throw new TypeError(`Could not persist invalid value for "${this.#key}".`);
    }
    const value = decoded?.value ?? next;
    this.value = value;
    try {
      this.#write(value);
    } catch (error) {
      // A failed persist (quota exceeded, private mode) must not break the in-memory update; a
      // breadcrumb makes "my settings stopped persisting" diagnosable without breaking anything.
      console.warn(`Could not persist "${this.#key}".`, error);
    }
  }

  // Reports whether the value came from storage by key presence and a successful
  // parse, not by comparing to the default: a stored primitive equal to the default
  // is still "from storage", which a value compare would miss.
  #read(fallback: T): {
    value: T;
    fromStorage: boolean;
    repairStatus: PersistedRepairStatus;
  } {
    let raw: string | null | undefined;
    try {
      raw = this.#storage?.getItem(this.#key);
    } catch {
      return { value: fallback, fromStorage: false, repairStatus: 'failed' };
    }
    if (raw == null) return { value: fallback, fromStorage: false, repairStatus: 'none' };
    try {
      const parsed: unknown = JSON.parse(raw);
      // A value that drifted across a beta release or was corrupted would otherwise flow in untyped
      // and surface deep in use. Codecs either accept it, normalize a known legacy shape, or replace
      // it with the safe fallback.
      const decoded = this.#codec?.decode(parsed);
      if (decoded?.state === 'invalid') return this.#replaceWithFallback(fallback);
      if (decoded?.state === 'migrated') {
        return {
          value: decoded.value,
          fromStorage: true,
          repairStatus: this.#tryRepair(decoded.value, 'migrated'),
        };
      }
      return {
        value: decoded?.value ?? (parsed as T),
        fromStorage: true,
        repairStatus: 'none',
      };
    } catch {
      return this.#replaceWithFallback(fallback);
    }
  }

  #replaceWithFallback(fallback: T): {
    value: T;
    fromStorage: false;
    repairStatus: PersistedRepairStatus;
  } {
    return {
      value: fallback,
      fromStorage: false,
      repairStatus: this.#tryRepair(fallback, 'replaced'),
    };
  }

  #tryRepair(value: T, success: 'migrated' | 'replaced'): PersistedRepairStatus {
    try {
      this.#write(value);
      return success;
    } catch {
      return 'failed';
    }
  }

  #write(value: T): void {
    if (!this.#storage) return;
    const encoded = this.#codec?.encode ? this.#codec.encode(value) : value;
    const serialized = JSON.stringify(encoded);
    if (serialized === undefined) throw new TypeError(`Could not serialize "${this.#key}".`);
    this.#storage.setItem(this.#key, serialized);
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
  return new PersistedValue(
    key,
    null,
    storage,
    nullablePersistedCodec(createPersistedCodec(isMapView)),
  );
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
    value.intervalSeconds >= 1 &&
    value.intervalSeconds <= 3600 &&
    isFiniteNumber(value.minMeters) &&
    value.minMeters >= 1 &&
    value.minMeters <= 10_000 &&
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

export const MAX_COLLISION_CPA_METERS = 1_852_000;
export const MAX_COLLISION_TCPA_SECONDS = 7 * 24 * 60 * MINUTE_S;
export const MAX_SHALLOW_DEPTH_METERS = 11_000;

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
    value.dangerCpaMeters >= 0 &&
    value.dangerCpaMeters <= MAX_COLLISION_CPA_METERS &&
    isFiniteNumber(value.dangerTcpaSeconds) &&
    value.dangerTcpaSeconds >= 0 &&
    value.dangerTcpaSeconds <= MAX_COLLISION_TCPA_SECONDS &&
    isFiniteNumber(value.warningCpaMeters) &&
    value.warningCpaMeters >= 0 &&
    value.warningCpaMeters <= MAX_COLLISION_CPA_METERS &&
    isFiniteNumber(value.warningTcpaSeconds) &&
    value.warningTcpaSeconds >= 0 &&
    value.warningTcpaSeconds <= MAX_COLLISION_TCPA_SECONDS &&
    (value.shallowDepthMeters === undefined ||
      (isFiniteNumber(value.shallowDepthMeters) &&
        value.shallowDepthMeters >= 0 &&
        value.shallowDepthMeters <= MAX_SHALLOW_DEPTH_METERS))
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
