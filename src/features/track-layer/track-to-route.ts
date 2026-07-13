import type { Route, RouteWaypoint } from '$entities/route';
import { latestTrackSegment, type TrackPoint } from '$entities/track';
import { uuidv4 } from '$shared/lib';
import { METERS_PER_DEG } from '$shared/nav';
import { douglasPeucker } from './simplify';

// The default coarsening distance for a track-to-route conversion. A track is recorded at display
// density (a point every few seconds); a route wants a handful of turning points, so a coarse
// tolerance drops the straight-line filler and keeps the corners.
const DEFAULT_ROUTE_TOLERANCE_M = 100;

// Turn a recorded track into a planned route: coarsen the points with Douglas-Peucker so the route
// carries its turning points rather than the track's full density, then map each kept point to an
// unnamed waypoint in travel order. The caller is responsible for only offering this when the track
// has at least two points, since a route needs at least two waypoints.
export function trackToRoute(
  points: readonly TrackPoint[],
  name: string,
  toleranceMeters: number = DEFAULT_ROUTE_TOLERANCE_M,
): Route {
  const kept = douglasPeucker(latestTrackSegment(points), toleranceMeters / METERS_PER_DEG);
  const waypoints: RouteWaypoint[] = kept.map((p) => ({
    position: { latitude: p.lat, longitude: p.lon },
  }));
  return { id: uuidv4(), name, waypoints };
}
