import type { Waypoint } from '$entities/waypoint';
import type { LatLon } from '$shared/geo';
import {
  filterNavRows,
  type NavSortKey,
  navMetrics,
  type SortableNavRow,
  type SortDir,
  sortNavRows,
} from '$shared/nav';

export interface WaypointRow extends SortableNavRow {
  waypoint: Waypoint;
}

export function toWaypointRows(waypoints: readonly Waypoint[], vessel?: LatLon): WaypointRow[] {
  return waypoints.map((waypoint) => ({
    waypoint,
    id: waypoint.id,
    name: waypoint.name,
    ...navMetrics(vessel, waypoint.position),
  }));
}

export function filterWaypointRows(
  rows: readonly WaypointRow[],
  query: string,
): readonly WaypointRow[] {
  return filterNavRows(rows, query, (row) => [row.waypoint.name, row.waypoint.description]);
}

export function sortWaypointRows(
  rows: readonly WaypointRow[],
  key: NavSortKey,
  dir: SortDir,
): WaypointRow[] {
  return sortNavRows(rows, key, dir);
}
