import {
  cleanRouteId,
  featureToRoute,
  MAX_ROUTE_WAYPOINTS,
  type Route,
  routeToFeature,
} from '$entities/route';
import { isLatLon } from '$shared/geo';
import {
  deleteResourceOutcome,
  fetchKeyedResource,
  putResourceOutcome,
  type ResourceMutationResult,
} from '$shared/signalk';

const V2 = '/signalk/v2/api/resources/routes';
const V1 = '/signalk/v1/api/resources/routes';
export const MAX_ROUTES = 1_000;

// Returns the routes, or undefined when both the v2 and v1 endpoints are unreachable (a transient
// failure), so a caller can keep the current list rather than blanking it. A reachable but empty
// server returns []. A reachable v2 wins; v1 is the fallback. The v1 fallback is deliberately
// read-only degradation: saveRoute and deleteRoute below are v2-only, so a v1-only server gets
// list-but-not-edit behavior rather than writes against a legacy API the rest of the app does not
// speak.
export function fetchRoutes(base: string, token?: string): Promise<Route[] | undefined> {
  let accepted = 0;
  return fetchKeyedResource(
    base,
    [V2, V1],
    token,
    (id, raw) => {
      if (accepted >= MAX_ROUTES) return undefined;
      const route = featureToRoute(id, raw);
      if (route) accepted += 1;
      return route;
    },
    (url, status) => console.warn(`[routes] ${url} returned ${status}`),
  );
}

// The server-relative resource href for a route id, as the Course API's activeRoute wants it.
// Owned here, beside the resource clients, so the href format has one home; activationFromCourse in
// course-client.ts is its inverse, recovering the route id from a hydrated course href.
export function routeHref(id: string): string {
  return `/resources/routes/${encodeURIComponent(id)}`;
}

// PUT the route to its client-chosen id. Reports why a write failed, so a refusal the navigator can
// recover from (a token revoked mid-passage) is not flattened into the same message as a dropped
// connection. A route that fails validation here never reached the server, so it is 'failed'.
export function saveRoute(
  base: string,
  token: string | undefined,
  route: Route,
): Promise<ResourceMutationResult> {
  const id = cleanRouteId(route.id);
  if (
    !id ||
    route.waypoints.length < 2 ||
    route.waypoints.length > MAX_ROUTE_WAYPOINTS ||
    route.waypoints.some((waypoint) => !isLatLon(waypoint.position))
  ) {
    return Promise.resolve('failed');
  }
  return putResourceOutcome(`${base}${V2}/${encodeURIComponent(id)}`, token, routeToFeature(route));
}

export function deleteRoute(
  base: string,
  token: string | undefined,
  id: string,
): Promise<ResourceMutationResult> {
  const safeId = cleanRouteId(id);
  if (!safeId) return Promise.resolve('failed');
  return deleteResourceOutcome(`${base}${V2}/${encodeURIComponent(safeId)}`, token);
}
