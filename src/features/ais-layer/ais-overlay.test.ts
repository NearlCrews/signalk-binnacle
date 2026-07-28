import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AisTargets } from '$entities/ais';
import { mapThemePaint } from '$shared/map';
import { SignalKStore, type SKFrame } from '$shared/signalk';
import {
  createFakeMap,
  createFrameFactory,
  fakeOverlayContext,
  sourceFeatures,
} from '$shared/testing';
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

describe('ais overlay', () => {
  it('adds an image, a source, a symbol, a selection ring, and a 44 px hit layer', async () => {
    const store = new SignalKStore();
    const overlay = createAisOverlay(new AisTargets(store));
    const map = createFakeMap();
    const addLayer = vi.spyOn(map, 'addLayer');
    await overlay.add(fakeOverlayContext(map));
    expect(overlay.band).toBe('traffic');
    expect(map.images.size).toBe(1);
    expect(map.sources.size).toBe(1);
    expect(map.layers.size).toBe(3);
    expect(addLayer).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'binnacle-ais-selected' }),
      'binnacle-ais-symbol',
    );
    expect(map.layers.get('binnacle-ais-hit')?.paint).toMatchObject({
      'circle-radius': 22,
    });
  });

  it('syncs one feature per positioned target', async () => {
    const store = new SignalKStore();
    const overlay = createAisOverlay(new AisTargets(store));
    const map = createFakeMap();
    await overlay.add(fakeOverlayContext(map));
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
    overlay.sync(fakeOverlayContext(map));
    const source = [...map.sources.values()][0];
    const fc = source.data as { features: unknown[] };
    expect(fc.features).toHaveLength(1);
  });

  it('retains stale targets for pruning but does not render a stale position', async () => {
    const store = new SignalKStore();
    const overlay = createAisOverlay(new AisTargets(store));
    const map = createFakeMap();
    await overlay.add(fakeOverlayContext(map));
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
    overlay.sync(fakeOverlayContext(map));
    const source = [...map.sources.values()][0];
    const fc = source.data as { features: unknown[] };
    expect(fc.features).toHaveLength(0);
    expect(store.aisTargets.size).toBe(1);
  });

  it('skips setData when the ais version is unchanged', async () => {
    const store = new SignalKStore();
    const overlay = createAisOverlay(new AisTargets(store));
    const map = createFakeMap();
    await overlay.add(fakeOverlayContext(map));
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
    overlay.sync(fakeOverlayContext(map));
    overlay.sync(fakeOverlayContext(map));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('throttles steady-state position churn to about 1 Hz and paints the latest data', async () => {
    const store = new SignalKStore();
    let t = 0;
    const overlay = createAisOverlay(new AisTargets(store), { now: () => t });
    const map = createFakeMap();
    await overlay.add(fakeOverlayContext(map));
    store.applyFrame(positionFrame({ 'vessels.a': { latitude: 1, longitude: 2 } }));
    overlay.sync(fakeOverlayContext(map));
    const source = [...map.sources.values()][0];
    const spy = vi.spyOn(source, 'setData');

    store.applyFrame(positionFrame({ 'vessels.a': { latitude: 1.001, longitude: 2 } }));
    t = 250;
    overlay.sync(fakeOverlayContext(map));
    store.applyFrame(positionFrame({ 'vessels.a': { latitude: 1.002, longitude: 2 } }));
    t = 500;
    overlay.sync(fakeOverlayContext(map));
    expect(spy).not.toHaveBeenCalled();

    t = 1_000;
    overlay.sync(fakeOverlayContext(map));
    expect(spy).toHaveBeenCalledTimes(1);
    const fc = source.data as GeoJSON.FeatureCollection;
    const point = fc.features[0].geometry as GeoJSON.Point;
    expect(point.coordinates[1]).toBe(1.002);
  });

  it('paints a new target immediately even inside the throttle window', async () => {
    const store = new SignalKStore();
    let t = 0;
    const overlay = createAisOverlay(new AisTargets(store), { now: () => t });
    const map = createFakeMap();
    await overlay.add(fakeOverlayContext(map));
    store.applyFrame(positionFrame({ 'vessels.a': { latitude: 1, longitude: 2 } }));
    overlay.sync(fakeOverlayContext(map));
    const source = [...map.sources.values()][0];
    const spy = vi.spyOn(source, 'setData');

    store.applyFrame(positionFrame({ 'vessels.b': { latitude: 3, longitude: 4 } }));
    t = 100;
    overlay.sync(fakeOverlayContext(map));
    expect(spy).toHaveBeenCalledTimes(1);
    const fc = source.data as GeoJSON.FeatureCollection;
    expect(fc.features).toHaveLength(2);
  });

  it('applyTheme recolors the icon image', async () => {
    const store = new SignalKStore();
    const overlay = createAisOverlay(new AisTargets(store));
    const map = createFakeMap();
    await overlay.add(fakeOverlayContext(map));
    overlay.applyTheme?.(fakeOverlayContext(map), mapThemePaint('night-red'));
    expect(map.updatedImages).toContain('binnacle-ais-icon');
  });

  it('dispatches only current target ids and tears down hit handlers idempotently', async () => {
    const store = new SignalKStore();
    const targets = new AisTargets(store);
    const onSelect = vi.fn();
    const overlay = createAisOverlay(targets, { onSelect });
    const map = createFakeMap();
    const ctx = fakeOverlayContext(map);
    store.applyFrame(positionFrame({ 'vessels.current': { latitude: 1, longitude: 2 } }));

    await overlay.add(ctx);
    await overlay.add(ctx);
    expect(map.handlerCount('click', 'binnacle-ais-hit')).toBe(1);
    map.emitLayer('mouseenter', 'binnacle-ais-hit', {});
    expect(map.getCanvas().style.cursor).toBe('pointer');

    map.emitLayer('click', 'binnacle-ais-hit', {
      features: [
        {
          geometry: { type: 'Point', coordinates: [2, 1] },
          properties: { id: 'vessels.missing' },
        },
      ],
    });
    map.emitLayer('click', 'binnacle-ais-hit', {
      features: [
        {
          geometry: { type: 'Point', coordinates: [2, 1] },
          properties: { id: 'vessels.current' },
        },
      ],
    });
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith('vessels.current');

    overlay.remove(ctx);
    expect(map.handlerCount('click', 'binnacle-ais-hit')).toBe(0);
    expect(map.getCanvas().style.cursor).toBe('');
  });

  it('refreshes the selected target ring without waiting for AIS churn', async () => {
    const store = new SignalKStore();
    const targets = new AisTargets(store);
    let selectedId: string | undefined;
    const overlay = createAisOverlay(targets, { selectedId: () => selectedId });
    const map = createFakeMap();
    const ctx = fakeOverlayContext(map);
    store.applyFrame(positionFrame({ 'vessels.a': { latitude: 1, longitude: 2 } }));
    await overlay.add(ctx);
    overlay.sync(ctx);
    expect(sourceFeatures(map, 'binnacle-ais')[0]?.properties?.selected).toBe(false);

    selectedId = 'vessels.a';
    overlay.sync(ctx);

    expect(sourceFeatures(map, 'binnacle-ais')[0]?.properties?.selected).toBe(true);
  });

  it('disables the hit surface when the overlay is hidden or fully transparent', async () => {
    const overlay = createAisOverlay(new AisTargets(new SignalKStore()));
    const map = createFakeMap();
    const ctx = fakeOverlayContext(map);
    await overlay.add(ctx);

    overlay.setVisible?.(ctx, false);
    expect(map.setLayoutProperty).toHaveBeenCalledWith('binnacle-ais-hit', 'visibility', 'none');

    map.setLayoutProperty.mockClear();
    overlay.setVisible?.(ctx, true);
    overlay.setOpacity?.(ctx, 0);
    expect(map.setLayoutProperty).toHaveBeenCalledWith('binnacle-ais-hit', 'visibility', 'none');
  });
});
