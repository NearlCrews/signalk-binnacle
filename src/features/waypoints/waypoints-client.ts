import {
  cleanWaypointId,
  featureToWaypoint,
  type Waypoint,
  waypointToFeature,
} from '$entities/waypoint';
import { isLatLon } from '$shared/geo';
import {
  deleteResourceOutcome,
  fetchKeyedResource,
  putResourceOutcome,
  type ResourceMutationResult,
} from '$shared/signalk';

const V2 = '/signalk/v2/api/resources/waypoints';
const V1 = '/signalk/v1/api/resources/waypoints';
export const MAX_WAYPOINTS = 5_000;

// Returns the waypoints, or undefined when both the v2 and v1 endpoints are unreachable (a
// transient failure), so a caller can keep the current list rather than blanking it. A reachable
// but empty server returns []. A reachable v2 wins; v1 is the fallback. The v1 fallback is
// deliberately read-only degradation: saveWaypoint and deleteWaypoint below are v2-only, so a
// v1-only server gets list-but-not-edit behavior rather than writes against a legacy API the
// rest of the app does not speak.
export function fetchWaypoints(base: string, token?: string): Promise<Waypoint[] | undefined> {
  let accepted = 0;
  return fetchKeyedResource(
    base,
    [V2, V1],
    token,
    (id, raw) => {
      if (accepted >= MAX_WAYPOINTS) return undefined;
      const waypoint = featureToWaypoint(id, raw);
      if (waypoint) accepted += 1;
      return waypoint;
    },
    (url, status) => console.warn(`[waypoints] ${url} returned ${status}`),
  );
}

// PUT the waypoint to its client-chosen id. Returns whether the write succeeded.
export function saveWaypoint(
  base: string,
  token: string | undefined,
  waypoint: Waypoint,
): Promise<ResourceMutationResult> {
  const id = cleanWaypointId(waypoint.id);
  if (!id || !isLatLon(waypoint.position)) return Promise.resolve('failed');
  return putResourceOutcome(
    `${base}${V2}/${encodeURIComponent(id)}`,
    token,
    waypointToFeature(waypoint),
  );
}

export function deleteWaypoint(
  base: string,
  token: string | undefined,
  id: string,
): Promise<ResourceMutationResult> {
  const safeId = cleanWaypointId(id);
  if (!safeId) return Promise.resolve('failed');
  return deleteResourceOutcome(`${base}${V2}/${encodeURIComponent(safeId)}`, token);
}
