import { latLonToLonLat } from '$shared/geo';
import { antimeridianLineGeometry, featureCollection } from '$shared/map';
import type { Route, RouteHighlight } from './route-types';

// The cross-highlight derivation: given the highlighted leg or waypoint, which dots and which legs
// light up. Pure so it is unit-tested without a map; the overlay and the panel both build on it, so
// a lit segment for leg L always lines up with the panel row keyed leg.fromIndex === L.

// A leg L lights waypoints L and L+1; a waypoint D lights only itself. Indices out of range are
// dropped, so an endpoint highlight or a stale one never points past the route.
export function litWaypointIndices(h: RouteHighlight | undefined, waypointCount: number): number[] {
  if (!h) return [];
  const inRange = (i: number): boolean => i >= 0 && i < waypointCount;
  if (h.kind === 'waypoint') return inRange(h.index) ? [h.index] : [];
  return [h.index, h.index + 1].filter(inRange);
}

// A leg L lights leg L; a waypoint D lights the legs it joins (D-1 and D). Bounded to valid legs
// (0..waypointCount-2), so an endpoint waypoint lights exactly one leg.
export function litLegIndices(h: RouteHighlight | undefined, waypointCount: number): number[] {
  if (!h) return [];
  const legCount = Math.max(0, waypointCount - 1);
  const inRange = (i: number): boolean => i >= 0 && i < legCount;
  if (h.kind === 'leg') return inRange(h.index) ? [h.index] : [];
  return [h.index - 1, h.index].filter(inRange);
}

// The lit dots and lit segments for the current highlight, as GeoJSON for the overlay's two highlight
// sources. Empty collections when there is no highlight or the route is too short to have the leg.
export function highlightFeatures(
  route: Route,
  h: RouteHighlight | undefined,
): { dots: GeoJSON.FeatureCollection; segments: GeoJSON.FeatureCollection } {
  const wps = route.waypoints;
  const dots: GeoJSON.Feature[] = litWaypointIndices(h, wps.length).map((i) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: latLonToLonLat(wps[i].position) },
    properties: { index: i },
  }));
  const segments: GeoJSON.Feature[] = litLegIndices(h, wps.length).map((i) => ({
    type: 'Feature',
    geometry: antimeridianLineGeometry([
      latLonToLonLat(wps[i].position),
      latLonToLonLat(wps[i + 1].position),
    ]),
    properties: { index: i },
  }));
  return { dots: featureCollection(dots), segments: featureCollection(segments) };
}
