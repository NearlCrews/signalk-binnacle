import { type Route, waypointPointFeatures } from '$entities/route';
import { latLonToLonLat as toLonLat } from '$shared/geo';
import { antimeridianLineGeometry, featureCollection } from '$shared/map';

// One line feature per shown route, flagged active so the overlay can style the active route apart.
export function routeLineFeatures(
  routes: readonly Route[],
  shownIds: ReadonlySet<string>,
  activeId: string | undefined,
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const route of routes) {
    if (!shownIds.has(route.id)) continue;
    if (route.waypoints.length < 2) continue;
    features.push({
      type: 'Feature',
      geometry: antimeridianLineGeometry(route.waypoints.map((w) => toLonLat(w.position))),
      properties: { id: route.id, active: route.id === activeId },
    });
  }
  return featureCollection(features);
}

// One Point per waypoint of each shown route, carrying its name and zero-based index for labels.
export function waypointFeatures(
  routes: readonly Route[],
  shownIds: ReadonlySet<string>,
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const route of routes) {
    if (!shownIds.has(route.id)) continue;
    features.push(...waypointPointFeatures(route.waypoints, { id: route.id }));
  }
  return featureCollection(features);
}
