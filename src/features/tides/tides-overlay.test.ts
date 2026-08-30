import { afterEach, describe, expect, it, vi } from 'vitest';
import { TidesStore } from '$entities/tides';
import type { UnitsStore } from '$entities/units';
import { IMPERIAL_UNITS, METRIC_UNITS, type UnitsProfile } from '$shared/lib';
import { mapThemePaint } from '$shared/map';
import { createFakeMap, fakeOverlayContext, sourceFeatures } from '$shared/testing';
import { createTidesOverlay, tideStationFeatures } from './tides-overlay';

function unitsStub(profile: UnitsProfile = METRIC_UNITS): { profile: UnitsProfile } {
  return { profile };
}

const station = { id: 'T1', name: 'Tide', latitude: 27.7, longitude: -82.7 };

afterEach(() => {
  vi.useRealTimers();
});

describe('tides overlay', () => {
  it('refreshes the marker label when the minute turns over', async () => {
    vi.useFakeTimers();
    const t0 = Date.UTC(2026, 5, 8, 12, 0, 30);
    vi.setSystemTime(t0);
    const store = new TidesStore();
    store.setReadings(
      {
        station,
        distanceMeters: 1000,
        events: [
          { timeMs: t0 + 45_000, heightMeters: 0.5, kind: 'high' },
          { timeMs: t0 + 6 * 60 * 60 * 1000, heightMeters: 0.1, kind: 'low' },
        ],
      },
      undefined,
    );
    const units = unitsStub();
    const overlay = createTidesOverlay(store, units as unknown as UnitsStore);
    const map = createFakeMap();
    const ctx = fakeOverlayContext(map);
    await overlay.add(ctx);
    overlay.sync(ctx);
    const label = () =>
      sourceFeatures<{ properties: { label: string } }>(map, 'binnacle-tides')[0].properties.label;
    expect(label()).toContain('High');
    const before = map.sources.get('binnacle-tides')?.data;
    overlay.sync(ctx); // same minute, same readings, same units: no rebuild
    expect(map.sources.get('binnacle-tides')?.data).toBe(before);
    units.profile = IMPERIAL_UNITS; // a preference flip refreshes the labels within the minute
    overlay.sync(ctx);
    expect(label()).toContain('ft');
    vi.setSystemTime(t0 + 60_000); // the next minute, with the high now in the past
    overlay.sync(ctx);
    expect(label()).toContain('Low');
  });

  it('dims the circle stroke along with the rest of the layer opacity', async () => {
    const overlay = createTidesOverlay(new TidesStore(), unitsStub() as unknown as UnitsStore);
    const map = createFakeMap();
    const ctx = fakeOverlayContext(map);
    await overlay.add(ctx);
    overlay.setOpacity?.(ctx, 0.4);
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      'binnacle-tides-tide',
      'circle-stroke-opacity',
      0.4,
    );
  });

  it('renders the bounded catalog plus off-catalog selected and loaded stations with stable ids', () => {
    const store = new TidesStore();
    const nearbyTide = { id: 'T1', name: 'Nearby tide', latitude: 27.7, longitude: -82.7 };
    const nearbyCurrent = {
      id: 'C1',
      name: 'Nearby current',
      latitude: 27.71,
      longitude: -82.71,
    };
    const selected = { id: 'T2', name: 'Selected tide', latitude: 28, longitude: -83 };
    const loadedCurrent = { id: 'C2', name: 'Loaded current', latitude: 28.1, longitude: -83.1 };
    store.setCatalogs(
      [{ station: nearbyTide, distanceMeters: 1 }],
      [{ station: nearbyCurrent, distanceMeters: 2 }],
    );
    store.requestManual('tide', selected, 30_000);
    store.setReadings(undefined, { station: loadedCurrent, distanceMeters: 40_000, events: [] });

    const features = tideStationFeatures(store, Date.now(), 'metric').features;

    expect(features.map((feature) => feature.id)).toEqual([
      'tide:T1',
      'current:C1',
      'tide:T2',
      'current:C2',
    ]);
    expect(features.find((feature) => feature.id === 'tide:T2')?.properties).toMatchObject({
      stationId: 'T2',
      stationName: 'Selected tide',
      stationLatitude: 28,
      stationLongitude: -83,
      kind: 'tide',
      selectionMode: 'manual',
      selected: true,
      loaded: false,
      glyph: 'T',
      label: '',
    });
    expect(features.find((feature) => feature.id === 'current:C2')?.properties).toMatchObject({
      stationId: 'C2',
      kind: 'current',
      selected: false,
      loaded: true,
      glyph: 'C',
      label: 'Loaded current',
    });
  });

  it('uses filled tide markers, hollow current markers, a selected ring, and a 44 px hit target', async () => {
    const overlay = createTidesOverlay(new TidesStore(), unitsStub() as unknown as UnitsStore);
    const map = createFakeMap();
    await overlay.add(fakeOverlayContext(map));

    expect(map.layers.get('binnacle-tides-tide')?.paint).toMatchObject({
      'circle-radius': 7,
      'circle-color': mapThemePaint('day').tide,
    });
    expect(map.layers.get('binnacle-tides-current')?.paint).toMatchObject({
      'circle-radius': 7,
      'circle-color': 'rgba(0,0,0,0)',
      'circle-stroke-width': 2,
    });
    expect(map.layers.get('binnacle-tides-selected')?.filter).toEqual([
      '==',
      ['get', 'selected'],
      true,
    ]);
    expect(map.layers.get('binnacle-tides-hit')?.paint).toMatchObject({
      'circle-radius': 22,
      'circle-color': 'rgba(0,0,0,0.01)',
    });
    expect(map.layers.get('binnacle-tides-label')?.filter).toEqual(['!=', ['get', 'label'], '']);
  });

  it('disables hit interception while hidden or fully transparent and themes every marker shape', async () => {
    const overlay = createTidesOverlay(new TidesStore(), unitsStub() as unknown as UnitsStore);
    const map = createFakeMap();
    const ctx = fakeOverlayContext(map);
    await overlay.add(ctx);

    overlay.setVisible(ctx, false);
    expect(map.setLayoutProperty).toHaveBeenCalledWith('binnacle-tides-hit', 'visibility', 'none');
    overlay.setVisible(ctx, true);
    overlay.setOpacity?.(ctx, 0);
    expect(map.setLayoutProperty).toHaveBeenCalledWith('binnacle-tides-hit', 'visibility', 'none');
    expect(map.setLayoutProperty).toHaveBeenCalledWith(
      'binnacle-tides-label',
      'visibility',
      'none',
    );

    const night = mapThemePaint('night-red');
    overlay.applyTheme?.(ctx, night);
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      'binnacle-tides-selected',
      'circle-stroke-color',
      night.select,
    );
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      'binnacle-tides-current',
      'circle-stroke-color',
      night.tide,
    );
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      'binnacle-tides-label',
      'text-halo-color',
      night.background,
    );
  });

  it('cancels an armed station touch and pointer when visibility or opacity changes', async () => {
    const store = new TidesStore();
    store.setCatalogs([{ station, distanceMeters: 0 }], []);
    const onSelect = vi.fn();
    const overlay = createTidesOverlay(store, unitsStub() as unknown as UnitsStore, onSelect);
    const map = createFakeMap();
    const ctx = fakeOverlayContext(map);
    const originalEvent = {};
    const touchEvent = (type: string) =>
      ({
        features: [
          {
            geometry: { type: 'Point', coordinates: [-82.7, 27.7] },
            properties: { stationId: 'T1', kind: 'tide' },
          },
        ],
        originalEvent,
        point: { x: 10, y: 10 },
        points: [{ x: 10, y: 10 }],
        type,
      }) as never;
    await overlay.add(ctx);

    map.emitLayer('mouseenter', 'binnacle-tides-hit', {});
    expect(map.getCanvas().style.cursor).toBe('pointer');
    map.emit('touchstart', touchEvent('touchstart'));
    map.emitLayer('touchstart', 'binnacle-tides-hit', touchEvent('touchstart'));
    overlay.setVisible(ctx, false);
    expect(map.getCanvas().style.cursor).toBe('');
    map.emit('touchend', touchEvent('touchend'));
    await Promise.resolve();
    expect(onSelect).not.toHaveBeenCalled();

    overlay.setVisible(ctx, true);
    map.emit('touchstart', touchEvent('touchstart'));
    map.emitLayer('touchstart', 'binnacle-tides-hit', touchEvent('touchstart'));
    overlay.setOpacity?.(ctx, 0);
    map.emit('touchend', touchEvent('touchend'));
    await Promise.resolve();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('dispatches the first resolvable station from marker or label hits and cleans up idempotently', async () => {
    const store = new TidesStore();
    store.setCatalogs([{ station, distanceMeters: 0 }], []);
    const onSelect = vi.fn();
    const overlay = createTidesOverlay(store, unitsStub() as unknown as UnitsStore, onSelect);
    const map = createFakeMap();
    const ctx = fakeOverlayContext(map);
    await overlay.add(ctx);
    await overlay.add(ctx);
    expect(map.handlerCount('click', 'binnacle-tides-hit')).toBe(1);

    map.emitLayer('mouseenter', 'binnacle-tides-hit', {});
    expect(map.getCanvas().style.cursor).toBe('pointer');
    map.emitLayer('click', 'binnacle-tides-label', {
      features: [
        {
          id: 'tide:unknown',
          geometry: { type: 'Point', coordinates: [-82.7, 27.7] },
          properties: { stationId: 'unknown', kind: 'tide' },
        },
        {
          id: 'tide:T1',
          geometry: { type: 'Point', coordinates: [-82.7, 27.7] },
          // Stable feature ids are sufficient even if MapLibre omits or coerces presentation-only
          // properties. The exact layer id and bounded store resolution remain the authority.
          properties: { selected: 0, loaded: 1 },
        },
      ],
    });
    expect(onSelect).toHaveBeenCalledWith({ kind: 'tide', station, mode: 'manual' });

    for (const properties of [
      { stationId: 1, kind: 'tide', selected: false, loaded: true },
      { stationId: 'T1', kind: 'other', selected: false, loaded: true },
      { stationId: 'unknown', kind: 'tide', selected: false, loaded: true },
    ]) {
      map.emitLayer('click', 'binnacle-tides-hit', {
        features: [
          {
            geometry: { type: 'Point', coordinates: [-82.7, 27.7] },
            properties,
          },
        ],
      });
    }
    expect(onSelect).toHaveBeenCalledTimes(1);

    overlay.remove(ctx);
    expect(map.getCanvas().style.cursor).toBe('');
    expect(map.handlerCount('click', 'binnacle-tides-hit')).toBe(0);
    expect(map.layers.size).toBe(0);
    expect(map.sources.has('binnacle-tides')).toBe(false);
  });

  it('prefers the visible label over a neighboring station touch target', async () => {
    const neighboringStation = {
      id: 'T2',
      name: 'Neighbor',
      latitude: 27.7001,
      longitude: -82.7001,
    };
    const store = new TidesStore();
    store.setCatalogs(
      [
        { station, distanceMeters: 0 },
        { station: neighboringStation, distanceMeters: 1 },
      ],
      [],
    );
    const onSelect = vi.fn();
    const overlay = createTidesOverlay(store, unitsStub() as unknown as UnitsStore, onSelect);
    const map = createFakeMap();
    await overlay.add(fakeOverlayContext(map));

    map.emitLayer('click', 'binnacle-tides-label', {
      features: [
        {
          layer: { id: 'binnacle-tides-hit' },
          geometry: { type: 'Point', coordinates: [-82.7001, 27.7001] },
          properties: { stationId: 'T2', kind: 'tide' },
        },
        {
          layer: { id: 'binnacle-tides-label' },
          geometry: { type: 'Point', coordinates: [-82.7, 27.7] },
          properties: { stationId: 'T1', kind: 'tide' },
        },
      ],
    });

    expect(onSelect).toHaveBeenCalledWith({ kind: 'tide', station, mode: 'manual' });
  });

  it('resolves a marker from the rendered snapshot while the store and source are transitioning', async () => {
    const store = new TidesStore();
    store.setCatalogs([{ station, distanceMeters: 0 }], []);
    const onSelect = vi.fn();
    const overlay = createTidesOverlay(store, unitsStub() as unknown as UnitsStore, onSelect);
    const map = createFakeMap();
    const ctx = fakeOverlayContext(map);
    await overlay.add(ctx);
    overlay.sync(ctx);
    const renderedFeature = sourceFeatures(map, 'binnacle-tides')[0];

    // A catalog update can lead the MapLibre worker, leaving this old marker visible briefly.
    store.setCatalogs([], []);
    map.emitLayer('click', 'binnacle-tides-hit', {
      features: [renderedFeature],
    });

    expect(store.resolveStation('tide', 'T1')).toBeUndefined();
    expect(onSelect).toHaveBeenCalledWith({ kind: 'tide', station, mode: 'manual' });
  });

  it('keeps older queued rendered snapshots selectable across multiple source updates', async () => {
    const store = new TidesStore();
    const stationB = { id: 'T2', name: 'Tide B', latitude: 27.8, longitude: -82.8 };
    const stationC = { id: 'T3', name: 'Tide C', latitude: 27.9, longitude: -82.9 };
    store.setCatalogs([{ station, distanceMeters: 0 }], []);
    const onSelect = vi.fn();
    const overlay = createTidesOverlay(store, unitsStub() as unknown as UnitsStore, onSelect);
    const map = createFakeMap();
    const ctx = fakeOverlayContext(map);
    await overlay.add(ctx);
    overlay.sync(ctx);
    const renderedStationA = sourceFeatures(map, 'binnacle-tides')[0];

    store.setCatalogs([{ station: stationB, distanceMeters: 0 }], []);
    overlay.sync(ctx);
    store.setCatalogs([{ station: stationC, distanceMeters: 0 }], []);
    overlay.sync(ctx);
    map.emitLayer('click', 'binnacle-tides-hit', { features: [renderedStationA] });

    expect(store.resolveStation('tide', station.id)).toBeUndefined();
    expect(onSelect).toHaveBeenCalledWith({ kind: 'tide', station, mode: 'manual' });
  });

  it('retries an unchanged source snapshot after its source is recreated', async () => {
    const store = new TidesStore();
    store.setCatalogs([{ station, distanceMeters: 0 }], []);
    const overlay = createTidesOverlay(store, unitsStub() as unknown as UnitsStore);
    const map = createFakeMap();
    const ctx = fakeOverlayContext(map);
    await overlay.add(ctx);
    overlay.sync(ctx);
    map.removeSource('binnacle-tides');
    overlay.sync(ctx);
    await overlay.add(ctx);
    overlay.sync(ctx);

    expect(sourceFeatures(map, 'binnacle-tides')).toHaveLength(1);
  });

  it('blocks delegated station selection while another chart tool owns taps', async () => {
    const store = new TidesStore();
    store.setCatalogs([{ station, distanceMeters: 0 }], []);
    const onSelect = vi.fn();
    const overlay = createTidesOverlay(
      store,
      unitsStub() as unknown as UnitsStore,
      onSelect,
      Date.now,
      () => false,
    );
    const map = createFakeMap();
    await overlay.add(fakeOverlayContext(map));
    map.getCanvas().style.cursor = 'crosshair';

    map.emitLayer('mouseenter', 'binnacle-tides-hit', {});
    map.emitLayer('click', 'binnacle-tides-hit', {
      features: [
        {
          geometry: { type: 'Point', coordinates: [-82.7, 27.7] },
          properties: { stationId: 'T1', kind: 'tide', selected: false, loaded: true },
        },
      ],
    });
    map.emitLayer('mouseleave', 'binnacle-tides-hit', {});

    expect(onSelect).not.toHaveBeenCalled();
    expect(map.getCanvas().style.cursor).toBe('crosshair');
  });

  it('keeps automatic mode when the loaded marker represents signalk-tides output', async () => {
    const pluginStation = {
      id: 'tides',
      name: 'Local tides (signalk-tides)',
      latitude: 27.7,
      longitude: -82.7,
    };
    const store = new TidesStore();
    store.setReadings(
      { station: pluginStation, distanceMeters: 0, events: [] },
      undefined,
      'signalk-tides',
    );
    const onSelect = vi.fn();
    const overlay = createTidesOverlay(store, unitsStub() as unknown as UnitsStore, onSelect);
    const map = createFakeMap();
    await overlay.add(fakeOverlayContext(map));

    map.emitLayer('click', 'binnacle-tides-hit', {
      features: [
        {
          geometry: { type: 'Point', coordinates: [-82.7, 27.7] },
          properties: { stationId: 'tides', kind: 'tide', selected: false, loaded: true },
        },
      ],
    });

    expect(onSelect).toHaveBeenCalledWith({
      kind: 'tide',
      station: pluginStation,
      mode: 'automatic',
    });
  });

  it('keeps the rendered plugin mode while an old signalk-tides marker is still visible', async () => {
    const pluginStation = {
      id: 'noaa/9414290',
      name: 'Local tides (signalk-tides)',
      latitude: 27.7,
      longitude: -82.7,
    };
    const store = new TidesStore();
    store.setReadings(
      { station: pluginStation, distanceMeters: 0, events: [] },
      undefined,
      'signalk-tides',
    );
    const onSelect = vi.fn();
    const overlay = createTidesOverlay(store, unitsStub() as unknown as UnitsStore, onSelect);
    const map = createFakeMap();
    const ctx = fakeOverlayContext(map);
    await overlay.add(ctx);
    overlay.sync(ctx);
    const renderedFeature = sourceFeatures(map, 'binnacle-tides')[0];

    store.setNoCoverage();
    map.emitLayer('click', 'binnacle-tides-hit', {
      features: [renderedFeature],
    });

    expect(store.resolveStation('tide', pluginStation.id)).toBeUndefined();
    expect(onSelect).toHaveBeenCalledWith({
      kind: 'tide',
      station: pluginStation,
      mode: 'automatic',
    });
  });

  it('keeps manual mode when a requested station shares the signalk-tides station id', async () => {
    const pluginStation = {
      id: 'noaa/9414290',
      name: 'Shared station',
      latitude: 27.7,
      longitude: -82.7,
    };
    const store = new TidesStore();
    store.setReadings(
      { station: pluginStation, distanceMeters: 0, events: [] },
      undefined,
      'signalk-tides',
    );
    store.requestManual('tide', pluginStation, 0);
    const onSelect = vi.fn();
    const overlay = createTidesOverlay(store, unitsStub() as unknown as UnitsStore, onSelect);
    const map = createFakeMap();
    const ctx = fakeOverlayContext(map);
    await overlay.add(ctx);
    overlay.sync(ctx);

    map.emitLayer('click', 'binnacle-tides-hit', {
      features: [sourceFeatures(map, 'binnacle-tides')[0]],
    });

    expect(onSelect).toHaveBeenCalledWith({
      kind: 'tide',
      station: pluginStation,
      mode: 'manual',
    });
  });
});
