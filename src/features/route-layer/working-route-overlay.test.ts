import { describe, expect, it } from 'vitest';
import { type Route, RouteStore } from '$entities/route';
import { createFakeMap, fakeOverlayContext } from '$shared/testing';
import { createWorkingRouteOverlay } from './working-route-overlay';

const route: Route = {
  id: 'route-1',
  name: 'Test route',
  waypoints: [
    { position: { latitude: 42, longitude: -83 } },
    { position: { latitude: 42.1, longitude: -83.1 } },
    { position: { latitude: 42.2, longitude: -83.2 } },
  ],
};

function setup() {
  const store = new RouteStore();
  const map = createFakeMap();
  const overlay = createWorkingRouteOverlay(store, 'day');
  const ctx = fakeOverlayContext(map);
  overlay.add(ctx);
  store.setWorking(route);
  overlay.sync(ctx);
  return { store, map, overlay, ctx };
}

function sourceWaypoint(
  map: ReturnType<typeof createFakeMap>,
  index: number,
): GeoJSON.Feature<GeoJSON.Point> {
  const source = map.sources.get('binnacle-working-wpt');
  const data = source?.data as GeoJSON.FeatureCollection | undefined;
  const feature = data?.features[index];
  if (feature?.geometry.type !== 'Point') throw new Error(`Missing rendered waypoint ${index}`);
  return feature as GeoJSON.Feature<GeoJSON.Point>;
}

function setRenderedWaypoint(
  map: ReturnType<typeof createFakeMap>,
  sourceIndex: number,
  ...renderedIndex: [unknown] | []
): void {
  const feature = sourceWaypoint(map, sourceIndex);
  map.renderedFeatures.splice(0, map.renderedFeatures.length, {
    ...feature,
    properties: {
      ...feature.properties,
      index: renderedIndex.length === 0 ? sourceIndex : renderedIndex[0],
    },
  });
}

describe('working route overlay', () => {
  it('returns only a valid numeric waypoint index from the current working route', () => {
    const { store, map, overlay } = setup();
    setRenderedWaypoint(map, 1);
    expect(overlay.hitTestWaypoint({ x: 10, y: 10 })).toBe(1);

    for (const invalid of ['1', null, undefined, -1, 1.5, 3, Number.MAX_SAFE_INTEGER + 1]) {
      setRenderedWaypoint(map, 1, invalid);
      expect(overlay.hitTestWaypoint({ x: 10, y: 10 })).toBeUndefined();
    }

    const currentFeature = sourceWaypoint(map, 0);
    map.renderedFeatures.splice(0, map.renderedFeatures.length, {
      ...currentFeature,
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [
          [-83, 42],
          [-83.1, 42.1],
        ],
      },
      properties: currentFeature.properties,
    });
    expect(overlay.hitTestWaypoint({ x: 10, y: 10 })).toBeUndefined();

    store.setWorking(undefined);
    setRenderedWaypoint(map, 0);
    expect(overlay.hitTestWaypoint({ x: 10, y: 10 })).toBeUndefined();
  });

  it('ignores an in-range rendered index shifted by an insertion', () => {
    const { store, map, overlay, ctx } = setup();
    setRenderedWaypoint(map, 1);
    const staleFeature = map.renderedFeatures[0];
    expect(overlay.hitTestWaypoint({ x: 10, y: 10 })).toBe(1);

    store.setWorking({
      ...route,
      waypoints: [
        { position: { latitude: 41.9, longitude: -82.9 }, name: 'Inserted' },
        ...route.waypoints,
      ],
    });
    // Reject the old snapshot before sync even though index 1 is still in range.
    expect(overlay.hitTestWaypoint({ x: 10, y: 10 })).toBeUndefined();

    overlay.sync(ctx);
    map.renderedFeatures.splice(0, map.renderedFeatures.length, staleFeature);
    // Reject the old renderer snapshot after setData() until MapLibre returns the new generation.
    expect(overlay.hitTestWaypoint({ x: 10, y: 10 })).toBeUndefined();

    setRenderedWaypoint(map, 2);
    expect(overlay.hitTestWaypoint({ x: 10, y: 10 })).toBe(2);
  });

  it('uses the first valid current point when overlapping hits start with a stale feature', () => {
    const { map, overlay } = setup();
    const stale = {
      ...sourceWaypoint(map, 0),
      properties: {
        ...sourceWaypoint(map, 0).properties,
        binnacleRenderGeneration: -1,
      },
    };
    const valid = sourceWaypoint(map, 2);
    map.renderedFeatures.splice(0, map.renderedFeatures.length, stale, valid);

    expect(overlay.hitTestWaypoint({ x: 10, y: 10 })).toBe(2);
  });

  it('ignores a rendered waypoint whose index became out of range after an edit', () => {
    const { store, map, overlay, ctx } = setup();
    setRenderedWaypoint(map, 2);
    expect(overlay.hitTestWaypoint({ x: 10, y: 10 })).toBe(2);

    store.setWorking({ ...route, waypoints: route.waypoints.slice(0, 2) });
    overlay.sync(ctx);
    map.renderedFeatures.splice(0, map.renderedFeatures.length, {
      ...sourceWaypoint(map, 1),
      properties: { ...sourceWaypoint(map, 1).properties, index: 2 },
    });
    expect(overlay.hitTestWaypoint({ x: 10, y: 10 })).toBeUndefined();
  });
});
