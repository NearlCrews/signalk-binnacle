import type { Waypoint } from './waypoint-types';

// The reactive home for waypoints. A version counter lets the overlay poll for changes the way
// the route overlay does, without deep reactivity on the array. There is no per-waypoint shown
// set on purpose: the overlay renders every waypoint, and visibility is the layer toggle.
export class WaypointsStore {
  waypoints = $state.raw<Waypoint[]>([]);
  version = $state(0);

  setWaypoints(waypoints: Waypoint[]): void {
    this.waypoints = waypoints;
    this.version += 1;
  }

  upsertWaypoint(waypoint: Waypoint): void {
    this.waypoints = [waypoint, ...this.waypoints.filter((item) => item.id !== waypoint.id)];
    this.version += 1;
  }

  removeWaypoint(id: string): void {
    const next = this.waypoints.filter((waypoint) => waypoint.id !== id);
    if (next.length === this.waypoints.length) return;
    this.waypoints = next;
    this.version += 1;
  }
}
