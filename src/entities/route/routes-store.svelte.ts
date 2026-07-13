import type { Route, RouteHighlight } from './route-types';

function routesEqual(a: Route[], b: Route[]): boolean {
  return (
    a.length === b.length &&
    a.every((route, index) => {
      const other = b[index];
      return (
        route.id === other.id &&
        route.name === other.name &&
        route.waypoints.length === other.waypoints.length &&
        route.waypoints.every((waypoint, waypointIndex) => {
          const otherWaypoint = other.waypoints[waypointIndex];
          return (
            waypoint.name === otherWaypoint.name &&
            waypoint.position.latitude === otherWaypoint.position.latitude &&
            waypoint.position.longitude === otherWaypoint.position.longitude
          );
        })
      );
    })
  );
}

// The reactive home for routes. A version counter lets the overlay poll for changes the way the
// saved-tracks overlay does, without deep reactivity on the arrays.
export class RouteStore {
  routes = $state.raw<Route[]>([]);
  shownIds = $state<Set<string>>(new Set());
  working = $state<Route | undefined>(undefined);
  activeId = $state<string | undefined>(undefined);
  version = $state(0);
  // The leg or waypoint of the working route the leg list and the chart cross-highlight.
  highlight = $state<RouteHighlight | undefined>(undefined);
  // A separate version counter for the working route, bumped on every working-route edit and highlight
  // change. The saved-route overlay polls `version` and the working-route overlay polls this, so a
  // per-pointermove edit re-syncs only the working overlay, not the saved-route layers.
  editVersion = $state(0);

  setRoutes(routes: Route[]): void {
    const nextRoutes = routes
      .slice()
      .sort(
        (a, b) =>
          a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) ||
          a.id.localeCompare(b.id),
      );
    const known = new Set(routes.map((route) => route.id));
    const shown = new Set([...this.shownIds].filter((id) => known.has(id)));
    if (this.activeId && known.has(this.activeId)) shown.add(this.activeId);
    const shownChanged =
      shown.size !== this.shownIds.size || [...shown].some((id) => !this.shownIds.has(id));
    if (routesEqual(this.routes, nextRoutes) && !shownChanged) return;
    this.routes = nextRoutes;
    if (shownChanged) this.shownIds = shown;
    this.version += 1;
  }

  upsertRoute(route: Route): void {
    this.setRoutes([...this.routes.filter((candidate) => candidate.id !== route.id), route]);
  }

  removeRoute(id: string): void {
    const next = this.routes.filter((route) => route.id !== id);
    if (next.length === this.routes.length) return;
    this.routes = next;
    const shown = new Set(this.shownIds);
    shown.delete(id);
    this.shownIds = shown;
    if (this.activeId === id) this.activeId = undefined;
    this.version += 1;
  }

  isShown(id: string): boolean {
    return this.shownIds.has(id);
  }

  routeById(id: string): Route | undefined {
    return this.routes.find((route) => route.id === id);
  }

  toggleShown(id: string, shown: boolean): void {
    if (this.shownIds.has(id) === shown) return;
    const next = new Set(this.shownIds);
    if (shown) next.add(id);
    else next.delete(id);
    this.shownIds = next;
    this.version += 1;
  }

  setWorking(route: Route | undefined): void {
    // `version` is not bumped: the working route is not drawn by the saved-route overlay, and the
    // panel reads `working` as reactive $state directly. `editVersion` is bumped so the working-route
    // overlay re-syncs its dots and highlight on every edit, including each pointermove of a drag.
    const prevCount = this.working?.waypoints.length ?? 0;
    this.working = route;
    const nextCount = route?.waypoints.length ?? 0;
    // A waypoint insert or delete shifts indices, so a kept highlight would point at the wrong dot.
    // Clear it on any count change; a pure drag (same count) keeps it.
    if (nextCount !== prevCount) this.highlight = undefined;
    this.editVersion += 1;
  }

  setHighlight(next: RouteHighlight): void {
    // A plain set, not a toggle: a click MapLibre synthesizes at the end of a small drag must not
    // toggle a dot's highlight off. The leg-list toggle lives in the panel's handler instead.
    if (this.highlight?.kind === next.kind && this.highlight?.index === next.index) return;
    this.highlight = next;
    this.editVersion += 1;
  }

  clearHighlight(): void {
    if (!this.highlight) return;
    this.highlight = undefined;
    this.editVersion += 1;
  }

  setActive(id: string | undefined): void {
    if (this.activeId === id) return;
    this.activeId = id;
    if (id) {
      const shown = new Set(this.shownIds);
      shown.add(id);
      this.shownIds = shown;
    }
    this.version += 1;
  }
}
