import { MAX_ROUTE_WAYPOINTS, type RouteWaypoint } from '$entities/route';
import { isLatLon, type LatLon } from '$shared/geo';

export type RoutePointEdit =
  | { kind: 'add'; position: LatLon }
  | { kind: 'insert' | 'move'; index: number; position: LatLon }
  | { kind: 'reorder'; index: number; direction: -1 | 1 }
  | { kind: 'delete'; index: number };

export function editRoutePoints(
  waypoints: RouteWaypoint[],
  edit: RoutePointEdit,
): RouteWaypoint[] | undefined {
  if ('position' in edit && !isLatLon(edit.position)) return undefined;
  if (
    edit.kind !== 'add' &&
    (!Number.isInteger(edit.index) || edit.index < 0 || edit.index >= waypoints.length)
  )
    return undefined;
  if ((edit.kind === 'add' || edit.kind === 'insert') && waypoints.length >= MAX_ROUTE_WAYPOINTS)
    return undefined;
  if (
    edit.kind === 'reorder' &&
    ((edit.direction !== -1 && edit.direction !== 1) ||
      edit.index + edit.direction < 0 ||
      edit.index + edit.direction >= waypoints.length)
  )
    return undefined;
  const next = waypoints.map((waypoint) => ({ ...waypoint, position: { ...waypoint.position } }));
  if (edit.kind === 'delete') next.splice(edit.index, 1);
  else if (edit.kind === 'reorder') {
    const target = edit.index + edit.direction;
    [next[edit.index], next[target]] = [next[target], next[edit.index]];
  } else if (edit.kind === 'add') next.push({ position: { ...edit.position } });
  else if (edit.kind === 'insert')
    next.splice(edit.index + 1, 0, { position: { ...edit.position } });
  else next[edit.index] = { position: { ...edit.position } };
  return next;
}

export function sameRoutePointPositions(left: RouteWaypoint[], right: RouteWaypoint[]): boolean {
  return (
    left.length === right.length &&
    left.every(
      (point, index) =>
        Math.abs(point.position.latitude - right[index].position.latitude) <= 1e-9 &&
        Math.abs(point.position.longitude - right[index].position.longitude) <= 1e-9,
    )
  );
}
