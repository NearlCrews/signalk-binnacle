import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AisTargets } from '$entities/ais';
import { mapThemePaint, type OverlayContext } from '$shared/map';
import { SignalKStore, type SKFrame } from '$shared/signalk';
import { createFakeMap, createFrameFactory } from '$shared/testing';
import { createAisOverlay } from './ais-overlay';

// Seeded from the wall clock: AIS freshness is judged against real time, so a tiny epoch would
// read as an ancient fix and filter every target out.
const frameFactory = createFrameFactory(Date.now());

function positionFrame(vessels: Record<string, { latitude: number; longitude: number }>): SKFrame {
  return frameFactory(
    {},
    Object.fromEntries(
      Object.entries(vessels).map(([id, position]) => [id, { 'navigation.position': position }]),
    ),
  );
}

class FakeImageData {
  constructor(
    public data: Uint8ClampedArray,
    public width: number,
    public height: number,
  ) {}
}

beforeEach(() => vi.stubGlobal('ImageData', FakeImageData));
afterEach(() => vi.unstubAllGlobals());

function ctxFor(map: ReturnType<typeof createFakeMap>): OverlayContext {
  return { map: map as never, beforeIdFor: () => undefined };
}

describe('ais overlay', () => {
  it('adds an image, a source, and a symbol layer in the traffic band', () => {
    const store = new SignalKStore();
    const overlay = createAisOverlay(new AisTargets(store));
    const map = createFakeMap();
    overlay.add(ctxFor(map));
    expect(overlay.band).toBe('traffic');
    expect(map.images.size).toBe(1);
    expect(map.sources.size).toBe(1);
    expect(map.layers.size).toBe(1);
  });

  it('syncs one feature per positioned target', () => {
    const store = new SignalKStore();
    const overlay = createAisOverlay(new AisTargets(store));
    const map = createFakeMap();
    overlay.add(ctxFor(map));
    store.applyFrame({
      self: new Map(),
      ais: new Map([
        [
          'vessels.a',
          new Map<string, unknown>([['navigation.position', { latitude: 1, longitude: 2 }]]),
        ],
        ['vessels.b', new Map<string, unknown>([['name', 'no pos']])],
      ]),
      connection: { phase: 'open', attempt: 0 },
      epoch: Date.now(),
    });
    overlay.sync(ctxFor(map));
    const source = [...map.sources.values()][0];
    const fc = source.data as { features: unknown[] };
    expect(fc.features).toHaveLength(1);
  });

  it('retains stale targets for pruning but does not render a stale position', () => {
    const store = new SignalKStore();
    const overlay = createAisOverlay(new AisTargets(store));
    const map = createFakeMap();
    overlay.add(ctxFor(map));
    store.applyFrame({
      self: new Map(),
      ais: new Map([
        [
          'vessels.old',
          new Map<string, unknown>([['navigation.position', { latitude: 1, longitude: 2 }]]),
        ],
      ]),
      connection: { phase: 'open', attempt: 0 },
      // Hours past the position TTL. The entity retains it until the prune timer runs, but the
      // overlay must not present the old position as current traffic.
      epoch: Date.now() - 10_000_000,
    });
    overlay.sync(ctxFor(map));
    const source = [...map.sources.values()][0];
    const fc = source.data as { features: unknown[] };
    expect(fc.features).toHaveLength(0);
    expect(store.aisTargets.size).toBe(1);
  });

  it('skips setData when the ais version is unchanged', () => {
    const store = new SignalKStore();
    const overlay = createAisOverlay(new AisTargets(store));
    const map = createFakeMap();
    overlay.add(ctxFor(map));
    store.applyFrame({
      self: new Map(),
      ais: new Map([
        [
          'vessels.a',
          new Map<string, unknown>([['navigation.position', { latitude: 1, longitude: 2 }]]),
        ],
      ]),
      connection: { phase: 'open', attempt: 0 },
      epoch: Date.now(),
    });
    const source = [...map.sources.values()][0];
    const spy = vi.spyOn(source, 'setData');
    overlay.sync(ctxFor(map));
    overlay.sync(ctxFor(map));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('throttles steady-state position churn to about 1 Hz and paints the latest data', () => {
    const store = new SignalKStore();
    let t = 0;
    const overlay = createAisOverlay(new AisTargets(store), () => t);
    const map = createFakeMap();
    overlay.add(ctxFor(map));
    store.applyFrame(positionFrame({ 'vessels.a': { latitude: 1, longitude: 2 } }));
    overlay.sync(ctxFor(map));
    const source = [...map.sources.values()][0];
    const spy = vi.spyOn(source, 'setData');

    store.applyFrame(positionFrame({ 'vessels.a': { latitude: 1.001, longitude: 2 } }));
    t = 250;
    overlay.sync(ctxFor(map));
    store.applyFrame(positionFrame({ 'vessels.a': { latitude: 1.002, longitude: 2 } }));
    t = 500;
    overlay.sync(ctxFor(map));
    expect(spy).not.toHaveBeenCalled();

    t = 1_000;
    overlay.sync(ctxFor(map));
    expect(spy).toHaveBeenCalledTimes(1);
    const fc = source.data as GeoJSON.FeatureCollection;
    const point = fc.features[0].geometry as GeoJSON.Point;
    expect(point.coordinates[1]).toBe(1.002);
  });

  it('paints a new target immediately even inside the throttle window', () => {
    const store = new SignalKStore();
    let t = 0;
    const overlay = createAisOverlay(new AisTargets(store), () => t);
    const map = createFakeMap();
    overlay.add(ctxFor(map));
    store.applyFrame(positionFrame({ 'vessels.a': { latitude: 1, longitude: 2 } }));
    overlay.sync(ctxFor(map));
    const source = [...map.sources.values()][0];
    const spy = vi.spyOn(source, 'setData');

    store.applyFrame(positionFrame({ 'vessels.b': { latitude: 3, longitude: 4 } }));
    t = 100;
    overlay.sync(ctxFor(map));
    expect(spy).toHaveBeenCalledTimes(1);
    const fc = source.data as GeoJSON.FeatureCollection;
    expect(fc.features).toHaveLength(2);
  });

  it('applyTheme recolors the icon image', () => {
    const store = new SignalKStore();
    const overlay = createAisOverlay(new AisTargets(store));
    const map = createFakeMap();
    overlay.add(ctxFor(map));
    overlay.applyTheme?.(ctxFor(map), mapThemePaint('night-red'));
    expect(map.updatedImages).toContain('binnacle-ais-icon');
  });
});
