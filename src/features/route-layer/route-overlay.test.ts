import { describe, expect, it } from 'vitest';
import { RouteStore } from '$entities/route';
import { mapThemePaint, type OverlayContext } from '$shared/map';
import { createFakeMap } from '$shared/testing';
import { createRouteOverlay } from './route-overlay';

function ctxFor(map: ReturnType<typeof createFakeMap>): OverlayContext {
  return { map: map as never, beforeIdFor: () => undefined };
}

function storeWithShownRoute(): RouteStore {
  const store = new RouteStore();
  store.setRoutes([
    {
      id: 'r1',
      name: 'R',
      waypoints: [
        { position: { latitude: 0, longitude: 0 } },
        { position: { latitude: 0, longitude: 1 } },
      ],
    },
  ]);
  store.toggleShown('r1', true);
  return store;
}

describe('route overlay', () => {
  it('adds the route, waypoint, and label layers and syncs shown routes', () => {
    const overlay = createRouteOverlay(storeWithShownRoute());
    const map = createFakeMap();
    overlay.add(ctxFor(map));
    overlay.sync(ctxFor(map));
    expect(overlay.band).toBe('routes');
    expect(map.getLayer('binnacle-route-line-casing')).toBeTruthy();
    expect(map.getLayer('binnacle-route-line')).toBeTruthy();
    expect(map.getLayer('binnacle-route-waypoint')).toBeTruthy();
    expect(map.getLayer('binnacle-route-waypoint-label')).toBeTruthy();
    const lineFc = map.sources.get('binnacle-route-lines')?.data as GeoJSON.FeatureCollection;
    expect(lineFc.features).toHaveLength(1);
    const wptFc = map.sources.get('binnacle-route-waypoints')?.data as GeoJSON.FeatureCollection;
    expect(wptFc.features).toHaveLength(2);
  });

  it('sync is a no-op when the store version is unchanged', () => {
    const store = storeWithShownRoute();
    const overlay = createRouteOverlay(store);
    const map = createFakeMap();
    overlay.add(ctxFor(map));
    overlay.sync(ctxFor(map));
    map.sources.get('binnacle-route-lines')?.setData?.('marker');
    overlay.sync(ctxFor(map));
    expect(map.sources.get('binnacle-route-lines')?.data).toBe('marker');
  });

  it('applyTheme recolors the layers', () => {
    const overlay = createRouteOverlay(storeWithShownRoute());
    const map = createFakeMap();
    overlay.add(ctxFor(map));
    overlay.applyTheme?.(ctxFor(map), mapThemePaint('night-red'));
    expect(map.setPaintProperty).toHaveBeenCalled();
  });

  it('remove tears down layers and sources', () => {
    const overlay = createRouteOverlay(storeWithShownRoute());
    const map = createFakeMap();
    overlay.add(ctxFor(map));
    overlay.remove(ctxFor(map));
    expect(map.layers.size).toBe(0);
    expect(map.sources.size).toBe(0);
  });
});
