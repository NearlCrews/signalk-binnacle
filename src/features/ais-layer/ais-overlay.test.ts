import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AisTargets } from '$entities/ais';
import type { Assessment } from '$entities/collision';
import { mapThemePaint } from '$shared/map';
import { SignalKStore, type SKFrame } from '$shared/signalk';
import {
  createFakeMap,
  createFrameFactory,
  declaredSource,
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

function assessmentWith(
  contacts: { id: string; severity: 'danger' | 'warning' }[] = [],
  unassessedIds: string[] = [],
): Assessment {
  return {
    contacts: contacts.map(({ id, severity }) => ({
      id,
      position: { latitude: 0, longitude: 0 },
      cpaMeters: 100,
      tcpaSeconds: 60,
      severity,
      source: 'computed' as const,
    })),
    worst: contacts.length > 0 ? contacts[0].severity : 'clear',
    unassessed: unassessedIds.map((id) => ({
      id,
      position: { latitude: 0, longitude: 0 },
      reason: 'motion-unknown' as const,
    })),
  };
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
    // The vessel triangle plus the aton diamond, its virtual variant, and the SAR cross.
    expect(map.images.size).toBe(4);
    expect(map.sources.size).toBe(1);
    expect(map.layers.size).toBe(4);
    // Each feature names its kind's icon rather than the base layer's single image.
    expect(map.setLayoutProperty).toHaveBeenCalledWith('binnacle-ais-symbol', 'icon-image', [
      'get',
      'icon',
    ]);
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
      // Unnamed targets carry name '' and must produce no label; below the declutter zoom only a
      // graded (rank at or below warning) or selected target keeps one.
      filter: [
        'all',
        ['!=', ['get', 'name'], ''],
        [
          'any',
          ['>=', ['zoom'], 9],
          ['<=', ['get', 'severityRank'], 1],
          ['==', ['get', 'id'], ['coalesce', ['global-state', 'aisSelectedId'], '']],
        ],
      ],
      layout: expect.objectContaining({
        'text-field': ['get', 'name'],
        'text-size': 11,
        // Deterministic thinning: selected first, then danger, warning, unassessed, clear.
        'symbol-sort-key': [
          'case',
          ['==', ['get', 'id'], ['coalesce', ['global-state', 'aisSelectedId'], '']],
          -1,
          ['get', 'severityRank'],
        ],
      }),
    });
    // Collision placement stays on: no overlap or ignore-placement escape hatches.
    expect(map.layers.get('binnacle-ais-label')?.layout).not.toHaveProperty('text-allow-overlap');
    expect(map.layers.get('binnacle-ais-label')?.layout).not.toHaveProperty(
      'text-ignore-placement',
    );
    // The icon order is the inverse rank, so a danger triangle draws on top of clear traffic.
    expect(map.setLayoutProperty).toHaveBeenCalledWith('binnacle-ais-symbol', 'symbol-sort-key', [
      '-',
      3,
      ['get', 'severityRank'],
    ]);
    // Stable ids for updateData diffs and feature-state, promoted from the context id property.
    expect(declaredSource(map, 'binnacle-ais').promoteId).toBe('id');
    // The ring is feature-state-driven: no selected filter, a transparent stroke on everyone else.
    expect(map.layers.get('binnacle-ais-selected')).not.toHaveProperty('filter');
    expect(map.layers.get('binnacle-ais-selected')?.paint).toMatchObject({
      'circle-stroke-opacity': ['case', ['boolean', ['feature-state', 'selected'], false], 1, 0],
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

  it('paints a new target immediately even inside the throttle window, shipping only the diff', async () => {
    const store = new SignalKStore();
    let t = 0;
    const overlay = createAisOverlay(new AisTargets(store), { now: () => t });
    const map = createFakeMap();
    await overlay.add(fakeOverlayContext(map));
    store.applyFrame(positionFrame({ 'vessels.a': { latitude: 1, longitude: 2 } }));
    overlay.sync(fakeOverlayContext(map));
    const source = [...map.sources.values()][0];
    const spy = vi.spyOn(source, 'setData');
    const updateSpy = vi.spyOn(source, 'updateData');

    store.applyFrame(positionFrame({ 'vessels.b': { latitude: 3, longitude: 4 } }));
    t = 100;
    overlay.sync(fakeOverlayContext(map));
    // One of two targets changed: the update rides a sparse diff, not a full repaint.
    expect(spy).not.toHaveBeenCalled();
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy).toHaveBeenCalledWith({
      add: [expect.objectContaining({ properties: expect.objectContaining({ id: 'vessels.b' }) })],
    });
    const fc = source.data as GeoJSON.FeatureCollection;
    expect(fc.features).toHaveLength(2);
  });

  it('falls back to a full setData when more than half the fleet changed', async () => {
    const store = new SignalKStore();
    let t = 0;
    const overlay = createAisOverlay(new AisTargets(store), { now: () => t });
    const map = createFakeMap();
    await overlay.add(fakeOverlayContext(map));
    store.applyFrame(
      positionFrame({
        'vessels.a': { latitude: 1, longitude: 2 },
        'vessels.b': { latitude: 2, longitude: 2 },
        'vessels.c': { latitude: 3, longitude: 2 },
        'vessels.d': { latitude: 4, longitude: 2 },
      }),
    );
    overlay.sync(fakeOverlayContext(map));
    const source = [...map.sources.values()][0];
    const spy = vi.spyOn(source, 'setData');
    const updateSpy = vi.spyOn(source, 'updateData');

    // One of four moved: a sparse geometry update.
    store.applyFrame(positionFrame({ 'vessels.a': { latitude: 1.01, longitude: 2 } }));
    t = 1_000;
    overlay.sync(fakeOverlayContext(map));
    expect(spy).not.toHaveBeenCalled();
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy).toHaveBeenCalledWith({
      update: [
        {
          id: 'vessels.a',
          newGeometry: { type: 'Point', coordinates: [2, 1.01] },
        },
      ],
    });

    // Three of four moved: past half the fleet the full repaint is the cheaper ship.
    store.applyFrame(
      positionFrame({
        'vessels.b': { latitude: 2.01, longitude: 2 },
        'vessels.c': { latitude: 3.01, longitude: 2 },
        'vessels.d': { latitude: 4.01, longitude: 2 },
      }),
    );
    t = 2_000;
    overlay.sync(fakeOverlayContext(map));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(sourceFeatures(map, 'binnacle-ais')).toHaveLength(4);
  });

  it('paints a grading flip inside the throttle window and keeps tracking the painted list', async () => {
    let now = 1_000_000;
    let assessment = assessmentWith();
    const store = new SignalKStore();
    const targets = new AisTargets(store, () => now);
    const overlay = createAisOverlay(targets, {
      now: () => now,
      assessment: () => assessment,
    });
    const map = createFakeMap();
    const ctx = fakeOverlayContext(map);
    // The second position has only 500 ms of freshness left when the grading flips below.
    store.applyFrame({
      self: new Map(),
      ais: new Map([
        [
          'vessels.current',
          new Map<string, unknown>([['navigation.position', { latitude: 1, longitude: 2 }]]),
        ],
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
    await overlay.add(ctx);
    overlay.sync(ctx);
    const source = [...map.sources.values()][0];
    expect(sourceFeatures(map, 'binnacle-ais')).toHaveLength(2);
    const updateSpy = vi.spyOn(source, 'updateData');

    // No AIS churn, only the assessment: the rank must ship on this very pass, not after the
    // throttle window, or a quiet bus would leave a fresh danger unsorted and unlabeled.
    assessment = assessmentWith([{ id: 'vessels.current', severity: 'danger' }]);
    now += 100;
    overlay.sync(ctx);
    expect(updateSpy).toHaveBeenCalledWith({
      update: [
        {
          id: 'vessels.current',
          addOrUpdateProperties: [{ key: 'severityRank', value: 0 }],
        },
      ],
    });

    now += 401;
    overlay.sync(ctx);

    const remaining = sourceFeatures(map, 'binnacle-ais');
    expect(remaining).toHaveLength(1);
    expect(remaining[0].properties?.id).toBe('vessels.current');
  });

  it('marks each kind with its own icon: triangle, diamond, hollow diamond, and cross', async () => {
    const store = new SignalKStore();
    const overlay = createAisOverlay(new AisTargets(store));
    const map = createFakeMap();
    const ctx = fakeOverlayContext(map);
    await overlay.add(ctx);
    store.applyFrame({
      self: new Map(),
      ais: new Map<string, Map<string, unknown>>([
        ['vessels.a', new Map([['navigation.position', { latitude: 1, longitude: 2 }]])],
        ['atons.solid', new Map([['navigation.position', { latitude: 2, longitude: 2 }]])],
        [
          'atons.ghost',
          new Map<string, unknown>([
            ['navigation.position', { latitude: 3, longitude: 2 }],
            ['virtual', true],
          ]),
        ],
        ['sar.plane', new Map([['navigation.position', { latitude: 4, longitude: 2 }]])],
      ]),
      connection: { phase: 'open', attempt: 0 },
      epoch: Date.now(),
    });
    overlay.sync(ctx);
    const iconById = new Map(
      sourceFeatures(map, 'binnacle-ais').map((f) => [f.properties?.id, f.properties?.icon]),
    );
    expect(iconById.get('vessels.a')).toBe('binnacle-ais-icon');
    expect(iconById.get('atons.solid')).toBe('binnacle-ais-aton-icon');
    expect(iconById.get('atons.ghost')).toBe('binnacle-ais-aton-virtual-icon');
    expect(iconById.get('sar.plane')).toBe('binnacle-ais-sar-icon');
  });

  it('applyTheme recolors the icon image and the name labels', async () => {
    const store = new SignalKStore();
    const overlay = createAisOverlay(new AisTargets(store));
    const map = createFakeMap();
    const paint = mapThemePaint('night-red');
    await overlay.add(fakeOverlayContext(map));
    overlay.applyTheme?.(fakeOverlayContext(map), paint);
    expect(map.updatedImages).toContain('binnacle-ais-icon');
    expect(map.updatedImages).toContain('binnacle-ais-aton-icon');
    expect(map.updatedImages).toContain('binnacle-ais-aton-virtual-icon');
    expect(map.updatedImages).toContain('binnacle-ais-sar-icon');
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
    // The kind icons leave with the overlay, not only the base vessel triangle.
    expect(map.images.size).toBe(0);
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

  it('rings a selected target through feature-state with no source data churn', async () => {
    const store = new SignalKStore();
    const targets = new AisTargets(store);
    let selectedId: string | undefined;
    const overlay = createAisOverlay(targets, { selectedId: () => selectedId });
    const map = createFakeMap();
    const ctx = fakeOverlayContext(map);
    store.applyFrame(positionFrame({ 'vessels.a': { latitude: 1, longitude: 2 } }));
    await overlay.add(ctx);
    overlay.sync(ctx);
    const source = [...map.sources.values()][0];
    const setDataSpy = vi.spyOn(source, 'setData');
    const updateSpy = vi.spyOn(source, 'updateData');

    selectedId = 'vessels.a';
    overlay.sync(ctx);
    expect(map.getFeatureState({ source: 'binnacle-ais', id: 'vessels.a' })).toEqual({
      selected: true,
    });
    // The label filter and sort key read the id from global state instead of a data property.
    expect(map.setGlobalStateProperty).toHaveBeenCalledWith('aisSelectedId', 'vessels.a');
    expect(setDataSpy).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();

    selectedId = undefined;
    overlay.sync(ctx);
    expect(map.getFeatureState({ source: 'binnacle-ais', id: 'vessels.a' })).toEqual({});
    expect(map.setGlobalStateProperty).toHaveBeenLastCalledWith('aisSelectedId', null);
    expect(setDataSpy).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('clears selected feature-state when the target is pruned and restores it when it returns', async () => {
    let now = 1_000_000;
    const store = new SignalKStore();
    const targets = new AisTargets(store, () => now);
    let selectedId: string | undefined;
    const overlay = createAisOverlay(targets, { now: () => now, selectedId: () => selectedId });
    const map = createFakeMap();
    const ctx = fakeOverlayContext(map);
    const fleet = {
      'vessels.a': { latitude: 1, longitude: 2 },
      'vessels.b': { latitude: 2, longitude: 2 },
      'vessels.c': { latitude: 3, longitude: 2 },
      'vessels.d': { latitude: 4, longitude: 2 },
    };
    // The selected vessel's position has 500 ms of freshness left; the other four keep the fleet
    // large enough that its later removal ships as a sparse diff.
    store.applyFrame({
      self: new Map(),
      ais: new Map<string, Map<string, unknown>>([
        ...Object.entries(fleet).map(
          ([id, position]) =>
            [id, new Map<string, unknown>([['navigation.position', position]])] as const,
        ),
        [
          'vessels.expiring',
          new Map<string, unknown>([['navigation.position', { latitude: 5, longitude: 2 }]]),
        ],
      ]),
      aisEpochs: new Map([
        ['vessels.expiring', new Map([['navigation.position', now - 7 * 60_000 + 500]])],
      ]),
      connection: { phase: 'open', attempt: 0 },
      epoch: now,
    });
    await overlay.add(ctx);
    overlay.sync(ctx);
    selectedId = 'vessels.expiring';
    overlay.sync(ctx);
    expect(map.getFeatureState({ source: 'binnacle-ais', id: 'vessels.expiring' })).toEqual({
      selected: true,
    });

    now += 501;
    overlay.sync(ctx);
    expect(sourceFeatures(map, 'binnacle-ais')).toHaveLength(4);
    // The pruned target must not leave a stale state entry behind.
    expect(map.featureStates.get('binnacle-ais')?.size ?? 0).toBe(0);

    // The target returns while still selected (at a fresh position, as a live report would be):
    // the diff's add restores its ring state.
    store.applyFrame(positionFrame({ 'vessels.expiring': { latitude: 5.01, longitude: 2 } }));
    now += 1_000;
    overlay.sync(ctx);
    expect(sourceFeatures(map, 'binnacle-ais')).toHaveLength(5);
    expect(map.getFeatureState({ source: 'binnacle-ais', id: 'vessels.expiring' })).toEqual({
      selected: true,
    });
  });

  it('grades severity ranks from the assessment into the painted features', async () => {
    const store = new SignalKStore();
    const targets = new AisTargets(store);
    const assessment = assessmentWith(
      [{ id: 'vessels.danger', severity: 'danger' }],
      ['vessels.unknown'],
    );
    const overlay = createAisOverlay(targets, { assessment: () => assessment });
    const map = createFakeMap();
    const ctx = fakeOverlayContext(map);
    store.applyFrame(
      positionFrame({
        'vessels.danger': { latitude: 1, longitude: 2 },
        'vessels.unknown': { latitude: 2, longitude: 2 },
        'vessels.clear': { latitude: 3, longitude: 2 },
      }),
    );
    await overlay.add(ctx);
    overlay.sync(ctx);
    const rankById = new Map(
      sourceFeatures(map, 'binnacle-ais').map((feature) => [
        feature.properties?.id,
        feature.properties?.severityRank,
      ]),
    );
    expect(rankById.get('vessels.danger')).toBe(0);
    expect(rankById.get('vessels.unknown')).toBe(2);
    expect(rankById.get('vessels.clear')).toBe(3);
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
