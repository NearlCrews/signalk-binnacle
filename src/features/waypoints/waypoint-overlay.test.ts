import { afterEach, describe, expect, it, vi } from 'vitest';
import { SymbolsStore, symbolIconId } from '$entities/symbols';
import { WaypointsStore } from '$entities/waypoint';
import { iconOffsetExpression, mapThemePaint } from '$shared/map';
import type { SkSymbol } from '$shared/signalk';
import { createFakeMap, fakeOverlayContext } from '$shared/testing';
import { createWaypointOverlay } from './waypoint-overlay';

function storeWith(waypoint: Partial<{ icon: string }> = {}): WaypointsStore {
  const store = new WaypointsStore();
  store.setWaypoints([
    { id: 'w1', name: 'Anchorage', position: { latitude: 44.1, longitude: -86.5 }, ...waypoint },
  ]);
  return store;
}

function featureCollection(map: ReturnType<typeof createFakeMap>): GeoJSON.FeatureCollection {
  return map.sources.get('binnacle-waypoints')?.data as GeoJSON.FeatureCollection;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
}

// A symbol aliased binnacle:waypoint is the host built-in for the 'waypoint' id, so a plain
// waypoint adopts it; role 'waypoint' passes the overlay's role filter.
function waypointSymbol(overrides: Partial<SkSymbol> = {}): SkSymbol {
  return {
    uuid: 'w9',
    aliases: ['binnacle:waypoint'],
    name: 'Waypoint flag',
    url: '/s/w9.svg',
    roles: ['waypoint'],
    anchor: [12, 24],
    ...overrides,
  };
}

function symbolsStore(symbol: SkSymbol): SymbolsStore {
  const rasterize = vi.fn().mockResolvedValue({
    image: { width: 48, height: 48, data: new Uint8ClampedArray(4) } as never,
    cssWidth: 24,
    cssHeight: 24,
    scale: 1,
  });
  return new SymbolsStore('http://pi', undefined, [symbol], rasterize);
}

describe('waypoint overlay', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('adds the marker, symbol, and label layers and syncs the waypoints', async () => {
    const overlay = createWaypointOverlay(storeWith());
    const map = createFakeMap();
    await overlay.add(fakeOverlayContext(map));
    overlay.sync(fakeOverlayContext(map));
    expect(overlay.band).toBe('routes');
    expect(map.getLayer('binnacle-waypoint-marker')).toBeTruthy();
    expect(map.getLayer('binnacle-waypoint-symbol')).toBeTruthy();
    expect(map.getLayer('binnacle-waypoint-label')).toBeTruthy();
    const fc = featureCollection(map);
    expect(fc.features).toHaveLength(1);
    expect((fc.features[0].geometry as GeoJSON.Point).coordinates).toEqual([-86.5, 44.1]);
    // No symbols store: the waypoint renders as the disc, so it carries no iconImage.
    expect(fc.features[0].properties).toEqual({ id: 'w1', name: 'Anchorage' });
  });

  it('sync is a no-op when the store version is unchanged', async () => {
    const store = storeWith();
    const overlay = createWaypointOverlay(store);
    const map = createFakeMap();
    await overlay.add(fakeOverlayContext(map));
    overlay.sync(fakeOverlayContext(map));
    map.sources.get('binnacle-waypoints')?.setData?.('marker');
    overlay.sync(fakeOverlayContext(map));
    expect(map.sources.get('binnacle-waypoints')?.data).toBe('marker');
  });

  it('applyTheme recolors the layers', async () => {
    const overlay = createWaypointOverlay(storeWith());
    const map = createFakeMap();
    await overlay.add(fakeOverlayContext(map));
    overlay.applyTheme?.(fakeOverlayContext(map), mapThemePaint('night-red'));
    expect(map.setPaintProperty).toHaveBeenCalled();
  });

  it('remove tears down layers and sources', async () => {
    const overlay = createWaypointOverlay(storeWith());
    const map = createFakeMap();
    await overlay.add(fakeOverlayContext(map));
    overlay.remove(fakeOverlayContext(map));
    expect(map.layers.size).toBe(0);
    expect(map.sources.size).toBe(0);
  });

  it('renders a waypoint as a provided symbol once its image registers', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response('<svg/>', { headers: { 'Content-Type': 'image/svg+xml' } }),
        ),
    );
    // No explicit icon: the binnacle:waypoint symbol is the host built-in for 'waypoint'.
    const overlay = createWaypointOverlay(storeWith(), symbolsStore(waypointSymbol()));
    const map = createFakeMap();
    await overlay.add(fakeOverlayContext(map));
    // Before the image loads the waypoint stays a disc (no iconImage).
    expect(featureCollection(map).features[0].properties).toEqual({ id: 'w1', name: 'Anchorage' });
    await settle();
    expect(map.hasImage(symbolIconId('w9'))).toBe(true);
    // Once registered, the feature carries the icon and the per-symbol anchor offset is applied.
    expect(featureCollection(map).features[0].properties).toMatchObject({
      iconImage: symbolIconId('w9'),
    });
    const offsetCall = map.setLayoutProperty.mock.calls
      .filter((c) => c[0] === 'binnacle-waypoint-symbol' && c[1] === 'icon-offset')
      .at(-1);
    // What this pins: the overlay routed the symbol's anchor offset into the shared builder and
    // applied its result. The builder's own unit test pins the expression grammar.
    expect(offsetCall?.[2]).toEqual(
      iconOffsetExpression('iconImage', new Map([[symbolIconId('w9'), [0, -12]]])),
    );
  });

  it('keeps the disc when the symbol SVG fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network')));
    const overlay = createWaypointOverlay(storeWith(), symbolsStore(waypointSymbol()));
    const map = createFakeMap();
    await overlay.add(fakeOverlayContext(map));
    await settle();
    expect(map.hasImage(symbolIconId('w9'))).toBe(false);
    expect(featureCollection(map).features[0].properties).toEqual({ id: 'w1', name: 'Anchorage' });
  });

  it('leaves a waypoint as a disc when no symbol matches its role', async () => {
    const noteOnly = waypointSymbol({ roles: ['note'] });
    const overlay = createWaypointOverlay(storeWith(), symbolsStore(noteOnly));
    const map = createFakeMap();
    await overlay.add(fakeOverlayContext(map));
    expect(map.getLayer('binnacle-waypoint-symbol')).toBeTruthy();
    expect(featureCollection(map).features[0].properties).toEqual({ id: 'w1', name: 'Anchorage' });
  });

  it('cancels a deferred symbol registration when removed', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response('<svg/>', { headers: { 'Content-Type': 'image/svg+xml' } }),
        ),
    );
    let resolveRaster!: (value: Awaited<ReturnType<SymbolsStore['rasterize']>>) => void;
    const rasterize = vi.fn(
      () =>
        new Promise<Awaited<ReturnType<SymbolsStore['rasterize']>>>((resolve) => {
          resolveRaster = resolve;
        }),
    );
    const symbols = new SymbolsStore('http://pi', undefined, [waypointSymbol()], rasterize);
    const overlay = createWaypointOverlay(storeWith(), symbols);
    const map = createFakeMap();
    const ctx = fakeOverlayContext(map);
    await overlay.add(ctx);
    await settle();

    overlay.remove(ctx);
    resolveRaster({
      image: { width: 48, height: 48, data: new Uint8ClampedArray(4) } as never,
      cssWidth: 24,
      cssHeight: 24,
      scale: 1,
    });
    await settle();

    expect(map.hasImage(symbolIconId('w9'))).toBe(false);
    expect(map.sources.size).toBe(0);
    expect(map.layers.size).toBe(0);
  });

  describe('marker taps', () => {
    function markerHit(id: unknown) {
      return {
        features: [{ geometry: { type: 'Point', coordinates: [-86.5, 44.1] }, properties: { id } }],
      };
    }

    it('selects the tapped mark from either marker layer', async () => {
      const onSelect = vi.fn();
      const overlay = createWaypointOverlay(storeWith(), undefined, { onSelect });
      const map = createFakeMap();
      await overlay.add(fakeOverlayContext(map));

      map.emitLayer('click', 'binnacle-waypoint-marker', markerHit('w1'));
      map.emitLayer('click', 'binnacle-waypoint-symbol', markerHit('w1'));

      expect(onSelect).toHaveBeenCalledTimes(2);
      expect(onSelect).toHaveBeenCalledWith('w1');
    });

    it('ignores a feature with no resource id', async () => {
      const onSelect = vi.fn();
      const overlay = createWaypointOverlay(storeWith(), undefined, { onSelect });
      const map = createFakeMap();
      await overlay.add(fakeOverlayContext(map));

      map.emitLayer('click', 'binnacle-waypoint-marker', markerHit(undefined));

      expect(onSelect).not.toHaveBeenCalled();
    });

    it('does not select while another chart tool owns taps, or once faded out', async () => {
      const onSelect = vi.fn();
      const overlay = createWaypointOverlay(storeWith(), undefined, {
        onSelect,
        interactionsAllowed: () => false,
      });
      const map = createFakeMap();
      const ctx = fakeOverlayContext(map);
      await overlay.add(ctx);

      map.emitLayer('click', 'binnacle-waypoint-marker', markerHit('w1'));
      expect(onSelect).not.toHaveBeenCalled();

      const visible = createWaypointOverlay(storeWith(), undefined, { onSelect });
      const otherMap = createFakeMap();
      const otherCtx = fakeOverlayContext(otherMap);
      await visible.add(otherCtx);
      visible.setOpacity?.(otherCtx, 0);
      otherMap.emitLayer('click', 'binnacle-waypoint-marker', markerHit('w1'));
      expect(onSelect).not.toHaveBeenCalled();

      visible.setVisible?.(otherCtx, false);
      visible.setOpacity?.(otherCtx, 1);
      otherMap.emitLayer('click', 'binnacle-waypoint-marker', markerHit('w1'));
      expect(onSelect).not.toHaveBeenCalled();
    });

    it('drops its listeners when removed', async () => {
      const onSelect = vi.fn();
      const overlay = createWaypointOverlay(storeWith(), undefined, { onSelect });
      const map = createFakeMap();
      const ctx = fakeOverlayContext(map);
      await overlay.add(ctx);
      overlay.remove(ctx);

      map.emitLayer('click', 'binnacle-waypoint-marker', markerHit('w1'));

      expect(onSelect).not.toHaveBeenCalled();
      expect(map.handlerCount('click', 'binnacle-waypoint-marker')).toBe(0);
    });
  });
});
