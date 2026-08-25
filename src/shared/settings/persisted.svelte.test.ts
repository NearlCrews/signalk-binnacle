import { describe, expect, it } from 'vitest';
import { knotsToMetersPerSecond } from '$shared/lib';
import { binnacleStorageKey } from '$shared/persistence';
import { createFakeStorage } from '$shared/testing';
import {
  booleanRecordPersistedCodec,
  createMapView,
  createPersistedCodec,
  createPlanningSpeed,
  DEFAULT_THRESHOLDS,
  exactShapeCodec,
  isMapView,
  isThresholds,
  isTrackSettings,
  MAX_PLANNING_SPEED_MPS,
  PersistedValue,
  stringArrayPersistedCodec,
} from './persisted.svelte';

describe('PersistedValue', () => {
  it('uses the default when storage is empty', () => {
    const storage = createFakeStorage();
    const p = new PersistedValue('k', { a: 1 }, storage);
    expect(p.value).toEqual({ a: 1 });
  });

  it('restores a persisted value', () => {
    const storage = createFakeStorage({ k: JSON.stringify({ a: 9 }) });
    const p = new PersistedValue('k', { a: 1 }, storage);
    expect(p.value).toEqual({ a: 9 });
  });

  it('set persists and updates', () => {
    const storage = createFakeStorage();
    const p = new PersistedValue('k', { a: 1 }, storage);
    p.set({ a: 2 });
    expect(p.value).toEqual({ a: 2 });
    expect(JSON.parse(storage.data.get('k') as string)).toEqual({ a: 2 });
  });

  it('returns a detached, structured-cloneable snapshot of reactive values', () => {
    const p = new PersistedValue('k', { nested: { value: 1 } }, createFakeStorage());
    const snapshot = p.snapshot();

    expect(() => structuredClone(snapshot)).not.toThrow();
    p.value.nested.value = 2;
    expect(snapshot).toEqual({ nested: { value: 1 } });
  });

  it('rejects a runtime value that its codec does not accept', () => {
    const storage = createFakeStorage();
    const p = new PersistedValue(
      'k',
      1,
      storage,
      createPersistedCodec(
        (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value),
      ),
    );

    expect(() => p.set(Number.NaN)).toThrow('invalid value');
    expect(p.value).toBe(1);
    expect(storage.data.has('k')).toBe(false);
  });

  it('canonicalizes a migrated runtime value before storing it', () => {
    const storage = createFakeStorage();
    const p = new PersistedValue('k', [], storage, stringArrayPersistedCodec());

    p.set(['routes', 'routes', 'tracks']);

    expect(p.value).toEqual(['routes', 'tracks']);
    expect(JSON.parse(storage.data.get('k') as string)).toEqual(['routes', 'tracks']);
  });

  it('does not replace a deliberate null encoder result with the raw value', () => {
    const storage = createFakeStorage();
    const p = new PersistedValue('k', 'value', storage, {
      decode: (value) =>
        typeof value === 'string' ? { state: 'valid', value } : { state: 'invalid' },
      encode: () => null,
    });

    p.set('next');

    expect(storage.data.get('k')).toBe('null');
  });

  it('falls back to the default on malformed JSON', () => {
    const storage = createFakeStorage({ k: 'not json' });
    const p = new PersistedValue('k', { a: 1 }, storage);
    expect(p.value).toEqual({ a: 1 });
    expect(p.repairStatus).toBe('replaced');
    expect(JSON.parse(storage.data.get('k') as string)).toEqual({ a: 1 });
  });

  it('repairs a value rejected by its schema', () => {
    const storage = createFakeStorage({ k: JSON.stringify('wrong') });
    const p = new PersistedValue(
      'k',
      5,
      storage,
      (value): value is number => typeof value === 'number',
    );
    expect(p.value).toBe(5);
    expect(p.fromStorage).toBe(false);
    expect(p.repairStatus).toBe('replaced');
    expect(JSON.parse(storage.data.get('k') as string)).toBe(5);
  });

  it('migrates and normalizes a known legacy shape', () => {
    const storage = createFakeStorage({ k: JSON.stringify({ oldCount: 7 }) });
    const codec = createPersistedCodec(
      (value: unknown): value is { count: number } =>
        typeof value === 'object' && value !== null && 'count' in value && value.count === 7,
      (value) =>
        typeof value === 'object' && value !== null && 'oldCount' in value && value.oldCount === 7
          ? { count: 7 }
          : undefined,
    );
    const p = new PersistedValue('k', { count: 0 }, storage, codec);
    expect(p.value).toEqual({ count: 7 });
    expect(p.fromStorage).toBe(true);
    expect(p.repairStatus).toBe('migrated');
    expect(JSON.parse(storage.data.get('k') as string)).toEqual({ count: 7 });
  });

  it('reports a failed repair without breaking the fallback', () => {
    const p = new PersistedValue(
      'k',
      5,
      {
        getItem: () => 'not json',
        setItem: () => {
          throw new DOMException('quota exceeded', 'QuotaExceededError');
        },
      },
      (value): value is number => typeof value === 'number',
    );
    expect(p.value).toBe(5);
    expect(p.repairStatus).toBe('failed');
  });

  it('handles a storage read failure as an unavailable store', () => {
    const p = new PersistedValue('k', 5, {
      getItem: () => {
        throw new DOMException('denied', 'SecurityError');
      },
      setItem: () => undefined,
    });
    expect(p.value).toBe(5);
    expect(p.fromStorage).toBe(false);
    expect(p.repairStatus).toBe('failed');
  });

  it('reports fromStorage by key presence, even for a primitive equal to the default', () => {
    const storage = createFakeStorage({ k: JSON.stringify(5) });
    const p = new PersistedValue('k', 5, storage);
    expect(p.value).toBe(5);
    expect(p.fromStorage).toBe(true);
  });

  it('reports not fromStorage when the key is absent', () => {
    const p = new PersistedValue('k', 5, createFakeStorage());
    expect(p.fromStorage).toBe(false);
  });

  it('set() does not throw when storage.setItem throws QuotaExceededError, and the in-memory value still updates', () => {
    const throwingStorage = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException('quota exceeded', 'QuotaExceededError');
      },
    };
    const p = new PersistedValue('k', 0, throwingStorage);
    expect(() => p.set(42)).not.toThrow();
    expect(p.value).toBe(42);
  });
});

describe('exactShapeCodec', () => {
  interface Mark {
    lat: number;
    lon: number;
  }
  const clean = (value: unknown): Mark | null => {
    if (typeof value !== 'object' || value === null) return null;
    const { lat, lon } = value as Partial<Mark>;
    return typeof lat === 'number' && typeof lon === 'number' ? { lat, lon } : null;
  };
  const isExactShape = (value: unknown): boolean =>
    typeof value === 'object' &&
    value !== null &&
    Object.keys(value).sort().join(',') === 'lat,lon';
  const codec = exactShapeCodec(clean, isExactShape);

  it('round-trips null as valid', () => {
    expect(codec.decode(null)).toEqual({ state: 'valid', value: null });
  });

  it('reports invalid when the value cannot be cleaned', () => {
    expect(codec.decode({ foo: 1 })).toEqual({ state: 'invalid' });
  });

  it('migrates a cleanable value whose stored shape carries extra keys', () => {
    expect(codec.decode({ lat: 1, lon: 2, extra: 'stale' })).toEqual({
      state: 'migrated',
      value: { lat: 1, lon: 2 },
    });
  });

  it('accepts a value already in the exact shape as valid', () => {
    expect(codec.decode({ lat: 1, lon: 2 })).toEqual({ state: 'valid', value: { lat: 1, lon: 2 } });
  });
});

describe('collection codecs', () => {
  it('rejects empty and control-character string ids', () => {
    const codec = stringArrayPersistedCodec();
    expect(codec.decode([''])).toEqual({ state: 'invalid' });
    expect(codec.decode(['route\nname'])).toEqual({ state: 'invalid' });
  });

  it('rejects empty and control-character record keys', () => {
    const codec = booleanRecordPersistedCodec();
    expect(codec.decode({ '': true })).toEqual({ state: 'invalid' });
    expect(codec.decode({ 'layers\u0000hidden': false })).toEqual({ state: 'invalid' });
    expect(codec.decode(JSON.parse('{"__proto__":true}'))).toEqual({ state: 'invalid' });
  });

  it('accepts an ordinary JSON record without reporting a perpetual migration', () => {
    const decoded = booleanRecordPersistedCodec().decode(JSON.parse('{"radar":true}'));
    expect(decoded.state).toBe('valid');
    if (decoded.state === 'invalid') throw new Error('expected a valid record');
    expect(decoded.value).toEqual({ radar: true });
    expect(Object.getPrototypeOf(decoded.value)).toBeNull();
  });
});

describe('isMapView', () => {
  it('accepts a valid view', () => {
    expect(isMapView({ lat: 42.6, lon: -83.5, zoom: 12.5 })).toBe(true);
  });

  it('rejects null, wrong shapes, and out-of-range or NaN values', () => {
    expect(isMapView(null)).toBe(false);
    expect(isMapView({ lat: 42, lon: -83 })).toBe(false);
    expect(isMapView({ lat: 100, lon: 0, zoom: 5 })).toBe(false);
    expect(isMapView({ lat: 0, lon: 200, zoom: 5 })).toBe(false);
    expect(isMapView({ lat: 0, lon: 0, zoom: Number.NaN })).toBe(false);
    expect(isMapView({ lat: '42', lon: 0, zoom: 5 })).toBe(false);
  });

  it('uses the map-view codec at the persistence boundary', () => {
    const storage = createFakeStorage({ view: JSON.stringify({ lat: 100, lon: 0, zoom: 5 }) });
    const view = createMapView('view', storage);
    expect(view.value).toBeNull();
    expect(view.repairStatus).toBe('replaced');
    expect(storage.data.get('view')).toBe('null');
  });
});

describe('isThresholds', () => {
  it('accepts a full record including shallowDepthMeters', () => {
    expect(isThresholds(DEFAULT_THRESHOLDS)).toBe(true);
  });

  it('accepts a record persisted before shallowDepthMeters existed', () => {
    const { shallowDepthMeters: _omit, ...legacy } = DEFAULT_THRESHOLDS;
    expect(isThresholds(legacy)).toBe(true);
  });

  it('rejects a non-finite shallowDepthMeters when present', () => {
    expect(isThresholds({ ...DEFAULT_THRESHOLDS, shallowDepthMeters: Number.NaN })).toBe(false);
  });

  it('rejects a record missing an original required field', () => {
    const { dangerCpaMeters: _omit, ...broken } = DEFAULT_THRESHOLDS;
    expect(isThresholds(broken)).toBe(false);
  });
});

describe('isTrackSettings', () => {
  it('accepts bounded recording settings', () => {
    expect(isTrackSettings({ intervalSeconds: 10, minMeters: 10, colorMode: 'speed' })).toBe(true);
  });

  it('rejects nonpositive and excessive recording settings', () => {
    expect(isTrackSettings({ intervalSeconds: 0, minMeters: 10, colorMode: 'speed' })).toBe(false);
    expect(isTrackSettings({ intervalSeconds: 10, minMeters: -1, colorMode: 'solid' })).toBe(false);
    expect(isTrackSettings({ intervalSeconds: 3601, minMeters: 10, colorMode: 'speed' })).toBe(
      false,
    );
    expect(isTrackSettings({ intervalSeconds: 10, minMeters: 10_001, colorMode: 'speed' })).toBe(
      false,
    );
  });
});

describe('createPlanningSpeed', () => {
  const SI_KEY = binnacleStorageKey('planningSpeedMps');
  const LEGACY_KEY = binnacleStorageKey('planningSpeedKn');

  it('defaults to five knots in SI when nothing is stored', () => {
    const speed = createPlanningSpeed(createFakeStorage());
    expect(speed.value).toBeCloseTo(knotsToMetersPerSecond(5), 9);
  });

  it('converts a legacy knots value once and writes it back in SI', () => {
    const storage = createFakeStorage({ [LEGACY_KEY]: '7' });
    const speed = createPlanningSpeed(storage);
    expect(speed.value).toBeCloseTo(knotsToMetersPerSecond(7), 9);
    expect(JSON.parse(storage.data.get(SI_KEY) ?? 'null')).toBeCloseTo(
      knotsToMetersPerSecond(7),
      9,
    );
  });

  it('prefers a stored SI value over a stale legacy one', () => {
    const storage = createFakeStorage({
      [LEGACY_KEY]: '7',
      [SI_KEY]: String(knotsToMetersPerSecond(9)),
    });
    expect(createPlanningSpeed(storage).value).toBeCloseTo(knotsToMetersPerSecond(9), 9);
  });

  it('ignores an out-of-range or malformed legacy value and keeps the default', () => {
    for (const legacy of ['500', '-1', '"fast"', 'not json']) {
      const speed = createPlanningSpeed(createFakeStorage({ [LEGACY_KEY]: legacy }));
      expect(speed.value).toBeCloseTo(knotsToMetersPerSecond(5), 9);
    }
  });

  it('replaces a stored SI value above the ceiling with the default', () => {
    const storage = createFakeStorage({ [SI_KEY]: String(MAX_PLANNING_SPEED_MPS + 1) });
    expect(createPlanningSpeed(storage).value).toBeCloseTo(knotsToMetersPerSecond(5), 9);
  });
});
