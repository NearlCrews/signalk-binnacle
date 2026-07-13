import { describe, expect, it } from 'vitest';
import {
  DEFAULT_THRESHOLDS,
  isMapView,
  isThresholds,
  isTrackSettings,
  PersistedValue,
} from './persisted.svelte';

function fakeStorage(map: Map<string, string>): Pick<Storage, 'getItem' | 'setItem'> {
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
  };
}

describe('PersistedValue', () => {
  it('uses the default when storage is empty', () => {
    const store = new Map<string, string>();
    const p = new PersistedValue('k', { a: 1 }, fakeStorage(store));
    expect(p.value).toEqual({ a: 1 });
  });

  it('restores a persisted value', () => {
    const store = new Map<string, string>([['k', JSON.stringify({ a: 9 })]]);
    const p = new PersistedValue('k', { a: 1 }, fakeStorage(store));
    expect(p.value).toEqual({ a: 9 });
  });

  it('set persists and updates', () => {
    const store = new Map<string, string>();
    const p = new PersistedValue('k', { a: 1 }, fakeStorage(store));
    p.set({ a: 2 });
    expect(p.value).toEqual({ a: 2 });
    expect(JSON.parse(store.get('k') as string)).toEqual({ a: 2 });
  });

  it('falls back to the default on malformed JSON', () => {
    const store = new Map<string, string>([['k', 'not json']]);
    const p = new PersistedValue('k', { a: 1 }, fakeStorage(store));
    expect(p.value).toEqual({ a: 1 });
  });

  it('reports fromStorage by key presence, even for a primitive equal to the default', () => {
    const store = new Map<string, string>([['k', JSON.stringify(5)]]);
    const p = new PersistedValue('k', 5, fakeStorage(store));
    expect(p.value).toBe(5);
    expect(p.fromStorage).toBe(true);
  });

  it('reports not fromStorage when the key is absent', () => {
    const p = new PersistedValue('k', 5, fakeStorage(new Map()));
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
