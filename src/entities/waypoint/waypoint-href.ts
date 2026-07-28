// The server-relative resource href for a waypoint id, as the Course API's destination wants it.
// It lives in the entity because routing cannot reach into the waypoints feature, and both slices
// must spell the reference the same way. Mirrors routeHref in routes-client.ts.
export function waypointHref(id: string): string {
  return `/resources/waypoints/${encodeURIComponent(id)}`;
}
