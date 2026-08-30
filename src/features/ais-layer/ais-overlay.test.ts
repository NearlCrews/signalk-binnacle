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
  it('adds an image, a source, a symbol, a selection ring, a name label, and a 44 px hit layer', async () => {
    const store = new SignalKStore();
    const overlay = createAisOverlay(new AisTargets(store));
    const map = createFakeMap();
    const addLayer = vi.spyOn(map, 'addLayer');
    await overlay.add(fakeOverlayContext(map));
    expect(overlay.band).toBe('traffic');
    expect(map.images.size).toBe(1);
    expect(map.sources.size).toBe(1);
    expect(map.layers.size).toBe(4);
    expect(addLayer).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'binnacle-ais-selected' }),
      'binnacle-ais-symbol',
    );
    expect(map.layers.get('binnacle-ais-hit')?.paint).toMatchObject({
      'circle-radius': 22,
    });
    expect(overlay.layerIds).toContain('binnacle-ais-label');
    expect(map.layers.get('binnacle-ais-label')).toMatchObject({
      type: 'symbol',
      // Unnamed targets carry name '' and must produce no label.
      filter: ['!=', ['get', 'name'], ''],
      layout: expect.objectContaining({
        'text-field': ['get', 'name'],
        'text-size': 11,
      }),
    });
    // Collision placement stays on: no overlap or ignore-placement escape hatches.
    expect(map.layers.get('binnacle-ais-label')?.layout).not.toHaveProperty('text-allow-overlap');
    expect(map.layers.get('binnacle-ais-label')?.layout).not.toHaveProperty(
      'text-ignore-placement',
    );
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

  it('removes a target when its position expires without an AIS version update', async () => {
    let now = 1_000;
    const store = new SignalKStore();
    const targets = new AisTargets(store, () => now);
    const overlay = createAisOverlay(targets, { now: () => now });
    const map = createFakeMap();
    const ctx = fakeOverlayContext(map);
    store.applyFrame({
      self: new Map(),
      ais: new Map([
        [
          'vessels.expiring',
          new Map<string, unknown>([['navigation.position', { latitude: 1, longitude: 2 }]]),
        ],
      ]),
      connection: { phase: 'open', attempt: 0 },
      epoch: now,
    });
    await overlay.add(ctx);
    overlay.sync(ctx);
    const source = [...map.sources.values()][0];
    const version = targets.version;
    expect((source.data as GeoJSON.FeatureCollection).features).toHaveLength(1);
    const spy = vi.spyOn(source, 'setData');

    // Positions remain current for seven minutes. Crossing that boundary changes the entity's
    // clock-derived list without mutating the underlying Signal K store or its AIS version.
    now += 7 * 60_000 + 1;
    overlay.sync(ctx);

    expect(targets.version).toBe(version);
    expect(spy).toHaveBeenCalledOnce();
    expect((source.data as GeoJSON.FeatureCollection).features).toHaveLength(0);
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

  it('records a selection-driven paint before the next target count change', async () => {
    let now = 1_000_000;
    let selectedId: string | undefined;
    const store = new SignalKStore();
    const targets = new AisTargets(store, () => now);
    const overlay = createAisOverlay(targets, {
      now: () => now,
      selectedId: () => selectedId,
    });
    const map = createFakeMap();
    const ctx = fakeOverlayContext(map);
    store.applyFrame({
      self: new Map(),
      ais: new Map([
        [
          'vessels.current',
          new Map<string, unknown>([['navigation.position', { latitude: 1, longitude: 2 }]]),
        ],
      ]),
      connection: { phase: 'open', attempt: 0 },
      epoch: now,
    });
    await overlay.add(ctx);
    overlay.sync(ctx);
    const source = [...map.sources.values()][0];
    const spy = vi.spyOn(source, 'setData');

    // This second position has only 500 ms of freshness left. Selecting the first vessel makes the
    // same sync paint both targets, and the gate must remember that two-target source snapshot.
    store.applyFrame({
      self: new Map(),
      ais: new Map([
        [
          'vessels.expiring',
          new Map<string, unknown>([['navigation.position', { latitude: 3, longitude: 4 }]]),
        ],
      ]),
      aisEpochs: new Map([
        ['vessels.expiring', new Map([['navigation.position', now - 7 * 60_000 + 500]])],
      ]),
      connection: { phase: 'open', attempt: 0 },
      epoch: now,
    });
    selectedId = 'vessels.current';
    overlay.sync(ctx);
    expect((source.data as GeoJSON.FeatureCollection).features).toHaveLength(2);

    now += 501;
    overlay.sync(ctx);

    expect(spy).toHaveBeenCalledTimes(2);
    expect((source.data as GeoJSON.FeatureCollection).features).toHaveLength(1);
    expect((source.data as GeoJSON.FeatureCollection).features[0].properties?.id).toBe(
      'vessels.current',
    );
  });

  it('applyTheme recolors the icon image and the name labels', async () => {
    const store = new SignalKStore();
    const overlay = createAisOverlay(new AisTargets(store));
    const map = createFakeMap();
    const paint = mapThemePaint('night-red');
    await overlay.add(fakeOverlayContext(map));
    overlay.applyTheme?.(fakeOverlayContext(map), paint);
    expect(map.updatedImages).toContain('binnacle-ais-icon');
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      'binnacle-ais-label',
      'text-color',
      paint.label,
    );
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      'binnacle-ais-label',
      'text-halo-color',
      paint.background,
    );
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
          geometry: {
            type: 'LineString',
            coordinates: [
              [2, 1],
              [3, 2],
            ],
          },
          properties: { id: 'vessels.current' },
        },
        {
          geometry: { type: 'Point', coordinates: [2, 1] },
          properties: { id: 'vessels.missing' },
        },
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
    expect(map.layers.has('binnacle-ais-label')).toBe(false);
  });

  it('preserves the chart-tool cursor and blocks selection while interactions are owned', async () => {
    const store = new SignalKStore();
    const targets = new AisTargets(store);
    const onSelect = vi.fn();
    const overlay = createAisOverlay(targets, {
      onSelect,
      interactionsAllowed: () => false,
    });
    const map = createFakeMap();
    store.applyFrame(positionFrame({ 'vessels.current': { latitude: 1, longitude: 2 } }));
    await overlay.add(fakeOverlayContext(map));
    map.getCanvas().style.cursor = 'crosshair';

    map.emitLayer('mouseenter', 'binnacle-ais-hit', {});
    map.emitLayer('click', 'binnacle-ais-hit', {
      features: [
        {
          geometry: { type: 'Point', coordinates: [2, 1] },
          properties: { id: 'vessels.current' },
        },
      ],
    });
    map.emitLayer('mouseleave', 'binnacle-ais-hit', {});

    expect(onSelect).not.toHaveBeenCalled();
    expect(map.getCanvas().style.cursor).toBe('crosshair');
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

  it('hides and reshows the name labels with the overlay', async () => {
    const overlay = createAisOverlay(new AisTargets(new SignalKStore()));
    const map = createFakeMap();
    const ctx = fakeOverlayContext(map);
    await overlay.add(ctx);

    overlay.setVisible?.(ctx, false);
    expect(map.setLayoutProperty).toHaveBeenCalledWith('binnacle-ais-label', 'visibility', 'none');

    overlay.setVisible?.(ctx, true);
    expect(map.setLayoutProperty).toHaveBeenCalledWith(
      'binnacle-ais-label',
      'visibility',
      'visible',
    );
  });

  it('fades the name labels with overlay opacity', async () => {
    const overlay = createAisOverlay(new AisTargets(new SignalKStore()));
    const map = createFakeMap();
    const ctx = fakeOverlayContext(map);
    await overlay.add(ctx);

    overlay.setOpacity?.(ctx, 0.4);
    expect(map.setPaintProperty).toHaveBeenCalledWith('binnacle-ais-label', 'text-opacity', 0.4);
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

  it('cancels an armed target touch and pointer when visibility or opacity changes', async () => {
    const store = new SignalKStore();
    const targets = new AisTargets(store);
    const onSelect = vi.fn();
    const overlay = createAisOverlay(targets, { onSelect });
    const map = createFakeMap();
    const ctx = fakeOverlayContext(map);
    const originalEvent = {};
    const touchEvent = (type: string) =>
      ({
        features: [
          {
            geometry: { type: 'Point', coordinates: [2, 1] },
            properties: { id: 'vessels.current' },
          },
        ],
        originalEvent,
        point: { x: 10, y: 10 },
        points: [{ x: 10, y: 10 }],
        type,
      }) as never;
    store.applyFrame(positionFrame({ 'vessels.current': { latitude: 1, longitude: 2 } }));
    await overlay.add(ctx);

    map.emitLayer('mouseenter', 'binnacle-ais-hit', {});
    expect(map.getCanvas().style.cursor).toBe('pointer');
    map.emit('touchstart', touchEvent('touchstart'));
    map.emitLayer('touchstart', 'binnacle-ais-hit', touchEvent('touchstart'));
    overlay.setVisible?.(ctx, false);
    expect(map.getCanvas().style.cursor).toBe('');
    map.emit('touchend', touchEvent('touchend'));
    await Promise.resolve();
    expect(onSelect).not.toHaveBeenCalled();

    overlay.setVisible?.(ctx, true);
    map.emit('touchstart', touchEvent('touchstart'));
    map.emitLayer('touchstart', 'binnacle-ais-hit', touchEvent('touchstart'));
    overlay.setOpacity?.(ctx, 0);
    map.emit('touchend', touchEvent('touchend'));
    await Promise.resolve();
    expect(onSelect).not.toHaveBeenCalled();
  });
});
