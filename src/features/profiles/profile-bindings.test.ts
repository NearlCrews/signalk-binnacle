import { describe, expect, it } from 'vitest';
import { createProfileBindings, type ProfileBindingDeps } from './profile-bindings';

// Minimal stand-ins: the bindings only read `.value`/`.theme` and call `.set`, so a plain object with
// those is enough. Cast through unknown since the real types carry more.
function makeDeps(): ProfileBindingDeps {
  let anchorRadiusMeters = 50;
  const pv = <T>(value: T) => ({
    value,
    snapshot() {
      return structuredClone(this.value);
    },
    set(next: T) {
      this.value = next;
    },
  });
  return {
    theme: {
      theme: 'day',
      set(next: string) {
        this.theme = next;
      },
    },
    layers: pv({}),
    layerOrder: pv<string[]>([]),
    weatherLayers: pv({}),
    thresholds: pv({
      dangerCpaMeters: 1,
      dangerTcpaSeconds: 1,
      warningCpaMeters: 1,
      warningTcpaSeconds: 1,
    }),
    trackSettings: pv({ intervalSeconds: 10, minMeters: 10, colorMode: 'speed' }),
    planningSpeedKn: pv(5),
    unitsLocal: pv('metric'),
    pinnedActions: pv<string[]>([]),
    instrumentTiles: pv<string[]>(['depth', 'speed']),
    trendInstruments: pv<string[]>(['depth', 'wind-apparent']),
    anchorRadius: {
      get: () => anchorRadiusMeters,
      set: (next: number) => {
        anchorRadiusMeters = next;
      },
    },
  } as unknown as ProfileBindingDeps;
}

describe('createProfileBindings', () => {
  it('captures every portable setting into one bundle', () => {
    const bindings = createProfileBindings(makeDeps());
    const bundle = bindings.capture();
    expect(bundle).toMatchObject({
      theme: 'day',
      planningSpeedKn: 5,
      units: 'metric',
      anchorRadiusMeters: 50,
    });
    expect(bundle.layerOrder).toEqual([]);
    expect(bundle.trackSettings.colorMode).toBe('speed');
    expect(() => structuredClone(bundle)).not.toThrow();
  });

  it('applies a bundle back to every store', () => {
    const deps = makeDeps();
    const bindings = createProfileBindings(deps);
    bindings.apply({
      ...bindings.capture(),
      theme: 'night-red',
      planningSpeedKn: 7,
      units: 'imperial',
      anchorRadiusMeters: 75,
    });
    expect(deps.theme.theme).toBe('night-red');
    expect(deps.planningSpeedKn.value).toBe(7);
    expect(deps.unitsLocal.value).toBe('imperial');
    expect(deps.anchorRadius.get()).toBe(75);
  });

  it('a bundle without a units field leaves the local units alone', () => {
    const deps = makeDeps();
    const bindings = createProfileBindings(deps);
    const bundle = bindings.capture();
    bundle.units = undefined;
    bindings.apply(bundle);
    expect(deps.unitsLocal.value).toBe('metric');
  });

  it('captures pinnedActionIds as a copy', () => {
    const deps = makeDeps();
    (deps.pinnedActions as unknown as { value: string[] }).value = ['center'];
    const bindings = createProfileBindings(deps);
    const captured = bindings.capture();
    expect(captured.pinnedActionIds).toEqual(['center']);
    (deps.pinnedActions as unknown as { value: string[] }).value = ['center', 'anchor'];
    expect(captured.pinnedActionIds).toEqual(['center']);
  });

  it('applies an empty pinnedActionIds (a deliberately cleared bar)', () => {
    const deps = makeDeps();
    const bindings = createProfileBindings(deps);
    bindings.apply({ ...bindings.capture(), pinnedActionIds: [] });
    expect(deps.pinnedActions.value).toEqual([]);
  });

  it('ignores a non-array pinnedActionIds and leaves the prior value', () => {
    const deps = makeDeps();
    (deps.pinnedActions as unknown as { value: string[] }).value = ['center'];
    const bindings = createProfileBindings(deps);
    bindings.apply({ ...bindings.capture(), pinnedActionIds: 'oops' as unknown as string[] });
    expect(deps.pinnedActions.value).toEqual(['center']);
  });

  it('captures instrumentTiles as a copy', () => {
    const deps = makeDeps();
    const bindings = createProfileBindings(deps);
    const captured = bindings.capture();
    expect(captured.instrumentTiles).toEqual(['depth', 'speed']);
    (deps.instrumentTiles as unknown as { value: string[] }).value = ['depth'];
    expect(captured.instrumentTiles).toEqual(['depth', 'speed']);
  });

  it('applies a valid instrumentTiles array to the store', () => {
    const deps = makeDeps();
    const bindings = createProfileBindings(deps);
    bindings.apply({ ...bindings.capture(), instrumentTiles: ['sog', 'cog', 'depth'] });
    expect(deps.instrumentTiles.value).toEqual(['sog', 'cog', 'depth']);
  });

  it('ignores a non-array instrumentTiles and leaves the prior value', () => {
    const deps = makeDeps();
    const bindings = createProfileBindings(deps);
    bindings.apply({
      ...bindings.capture(),
      instrumentTiles: 'bogus' as unknown as string[],
    });
    expect(deps.instrumentTiles.value).toEqual(['depth', 'speed']);
  });

  it('track does not throw and reads instrumentTiles', () => {
    const deps = makeDeps();
    const bindings = createProfileBindings(deps);
    expect(() => bindings.track()).not.toThrow();
  });

  it('captures trend ids and applies the legacy default when the field is absent', () => {
    const deps = makeDeps();
    const bindings = createProfileBindings(deps);
    expect(bindings.capture().trendInstrumentIds).toEqual(['depth', 'wind-apparent']);
    const legacy = bindings.capture();
    legacy.trendInstrumentIds = undefined;
    deps.trendInstruments.set(['sog']);
    bindings.apply(legacy);
    expect(deps.trendInstruments.value).toEqual(['depth', 'wind-apparent', 'pressure', 'sog']);
  });
});
