import { uuidv4 } from '$shared/lib';
import type { Route } from './route-types';

// A reversed copy of a route: the same waypoints in opposite order, a fresh id, and a name marked
// "(reverse)" so the return leg saves as a distinct route from the outbound one rather than
// overwriting it. Per-waypoint names ride along, still attached to their points.
export function reverseRoute(route: Route): Route {
  return {
    ...route,
    id: uuidv4(),
    name: `${route.name} (reverse)`,
    waypoints: [...route.waypoints].reverse(),
  };
}
