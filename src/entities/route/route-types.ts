import type { LatLon } from '$shared/geo';

// A route waypoint. Position is decimal degrees (the SI exception); name is optional. Named
// RouteWaypoint to distinguish it from the waypoint entity's richer Waypoint (id, required name, icon).
export interface RouteWaypoint {
  position: LatLon;
  name?: string;
  // Untouched coordinate metadata from other Signal K clients, including waypoint hrefs.
  metadata?: Record<string, unknown>;
}

// A planned route: an ordered list of waypoints with a stable client id and a name.
export interface Route {
  id: string;
  name: string;
  waypoints: RouteWaypoint[];
  // Provider-owned fields survive replacement writes. Geometry and editable names remain
  // authoritative in the typed model; these bags contain only the other resource fields.
  resourceExtras?: Record<string, unknown>;
  featureExtras?: Record<string, unknown>;
  properties?: Record<string, unknown>;
}

// Which part of the working route is highlighted for the cross-highlight between the leg list and the
// chart. A leg lights its segment and both end dots; a waypoint lights itself and the legs it joins.
export type RouteHighlight = { kind: 'leg'; index: number } | { kind: 'waypoint'; index: number };
