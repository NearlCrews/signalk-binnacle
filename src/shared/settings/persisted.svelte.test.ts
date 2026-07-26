import { describe, expect, it } from 'vitest';
import {
  booleanRecordPersistedCodec,
  createMapView,
  createPersistedCodec,
  DEFAULT_THRESHOLDS,
  isMapView,
  isThresholds,
  isTrackSettings,
  PersistedValue,
  stringArrayPersistedCodec,
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

  it('returns a detached, structured-cloneable snapshot of reactive values', () => {
    const p = new PersistedValue('k', { nested: { value: 1 } }, fakeStorage(new Map()));
    const snapshot = p.snapshot();

    expect(() => structuredClone(snapshot)).not.toThrow();
    p.value.nested.value = 2;
    expect(snapshot).toEqual({ nested: { value: 1 } });
  });

  it('rejects a runtime value that its codec does not accept', () => {
    const store = new Map<string, string>();
    const p = new PersistedValue(
      'k',
      1,
      fakeStorage(store),
      createPersistedCodec(
        (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value),
      ),
    );

    expect(() => p.set(Number.NaN)).toThrow('invalid value');
    expect(p.value).toBe(1);
    expect(store.has('k')).toBe(false);
  });

  it('canonicalizes a migrated runtime value before storing it', () => {
    const store = new Map<string, string>();
    const p = new PersistedValue('k', [], fakeStorage(store), stringArrayPersistedCodec());

    p.set(['routes', 'routes', 'tracks']);

    expect(p.value).toEqual(['routes', 'tracks']);
    expect(JSON.parse(store.get('k') as string)).toEqual(['routes', 'tracks']);
  });

  it('does not replace a deliberate null encoder result with the raw value', () => {
    const store = new Map<string, string>();
    const p = new PersistedValue('k', 'value', fakeStorage(store), {
      decode: (value) =>
        typeof value === 'string' ? { state: 'valid', value } : { state: 'invalid' },
      encode: () => null,
    });

    p.set('next');

    expect(store.get('k')).toBe('null');
  });

  it('falls back to the default on malformed JSON', () => {
    const store = new Map<string, string>([['k', 'not json']]);
    const p = new PersistedValue('k', { a: 1 }, fakeStorage(store));
    expect(p.value).toEqual({ a: 1 });
    expect(p.repairStatus).toBe('replaced');
    expect(JSON.parse(store.get('k') as string)).toEqual({ a: 1 });
  });

  it('repairs a value rejected by its schema', () => {
    const store = new Map<string, string>([['k', JSON.stringify('wrong')]]);
    const p = new PersistedValue(
      'k',
      5,
      fakeStorage(store),
      (value): value is number => typeof value === 'number',
    );
    expect(p.value).toBe(5);
    expect(p.fromStorage).toBe(false);
    expect(p.repairStatus).toBe('replaced');
    expect(JSON.parse(store.get('k') as string)).toBe(5);
  });

  it('migrates and normalizes a known legacy shape', () => {
    const store = new Map<string, string>([['k', JSON.stringify({ oldCount: 7 })]]);
    const codec = createPersistedCodec(
      (value: unknown): value is { count: number } =>
        typeof value === 'object' && value !== null && 'count' in value && value.count === 7,
      (value) =>
        typeof value === 'object' && value !== null && 'oldCount' in value && value.oldCount === 7
          ? { count: 7 }
          : undefined,
    );
    const p = new PersistedValue('k', { count: 0 }, fakeStorage(store), codec);
    expect(p.value).toEqual({ count: 7 });
    expect(p.fromStorage).toBe(true);
    expect(p.repairStatus).toBe('migrated');
    expect(JSON.parse(store.get('k') as string)).toEqual({ count: 7 });
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
    const store = new Map<string, string>([
      ['view', JSON.stringify({ lat: 100, lon: 0, zoom: 5 })],
    ]);
    const view = createMapView('view', fakeStorage(store));
    expect(view.value).toBeNull();
    expect(view.repairStatus).toBe('replaced');
    expect(store.get('view')).toBe('null');
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
