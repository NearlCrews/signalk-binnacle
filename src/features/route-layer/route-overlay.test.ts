import { describe, expect, it } from 'vitest';
import { RouteStore } from '$entities/route';
import { mapThemePaint } from '$shared/map';
import { createFakeMap, fakeOverlayContext } from '$shared/testing';
import { createRouteOverlay } from './route-overlay';

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
  it('adds the route, waypoint, and label layers and syncs shown routes', async () => {
    const overlay = createRouteOverlay(storeWithShownRoute());
    const map = createFakeMap();
    await overlay.add(fakeOverlayContext(map));
    overlay.sync(fakeOverlayContext(map));
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

  it('sync is a no-op when the store version is unchanged', async () => {
    const store = storeWithShownRoute();
    const overlay = createRouteOverlay(store);
    const map = createFakeMap();
    await overlay.add(fakeOverlayContext(map));
    overlay.sync(fakeOverlayContext(map));
    map.sources.get('binnacle-route-lines')?.setData?.('marker');
    overlay.sync(fakeOverlayContext(map));
    expect(map.sources.get('binnacle-route-lines')?.data).toBe('marker');
  });

  it('applyTheme recolors the layers', async () => {
    const overlay = createRouteOverlay(storeWithShownRoute());
    const map = createFakeMap();
    await overlay.add(fakeOverlayContext(map));
    overlay.applyTheme?.(fakeOverlayContext(map), mapThemePaint('night-red'));
    expect(map.setPaintProperty).toHaveBeenCalled();
  });

  it('setOpacity dims the waypoint dot stroke with the rest of the route', async () => {
    const overlay = createRouteOverlay(storeWithShownRoute());
    const map = createFakeMap();
    await overlay.add(fakeOverlayContext(map));
    overlay.setOpacity?.(fakeOverlayContext(map), 0.4);
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      'binnacle-route-waypoint',
      'circle-opacity',
      0.4,
    );
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      'binnacle-route-waypoint',
      'circle-stroke-opacity',
      0.4,
    );
  });

  it('remove tears down layers and sources', async () => {
    const overlay = createRouteOverlay(storeWithShownRoute());
    const map = createFakeMap();
    await overlay.add(fakeOverlayContext(map));
    overlay.remove(fakeOverlayContext(map));
    expect(map.layers.size).toBe(0);
    expect(map.sources.size).toBe(0);
  });
});
