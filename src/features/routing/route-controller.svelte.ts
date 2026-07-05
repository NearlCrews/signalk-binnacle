import type { CourseGuidance } from '$entities/course';
import type { Route, RouteStore } from '$entities/route';
import { reverseRoute } from '$entities/route';
import type { TrackPoint } from '$entities/track';
import { trackToRoute } from '$features/track-layer';
import type { LatLon } from '$shared/geo';
import { uuidv4 } from '$shared/lib';
import { defaultSaveName } from '$shared/ui';
import {
  activateRoute,
  activationFromCourse,
  advancePoint,
  clearCourse,
  hydrateCourse,
  setDestination,
} from './course-client';
import { parseGpxRoutes } from './gpx-import';
import { downloadRouteGpx } from './route-gpx';
import { deleteRoute, fetchRoutes, routeHref, saveRoute } from './routes-client';

export interface RouteControllerDeps {
  origin: string;
  getToken: () => string | undefined;
  routeStore: RouteStore;
  courseGuidance: CourseGuidance;
  flyTo: (lat: number, lon: number) => void;
  fitBounds: (bounds: [number, number, number, number]) => void;
  startRouteEdit: (route?: Route, initialPoint?: LatLon) => void;
  stopRouteEdit: () => void;
  getBounds: () => [number, number, number, number] | undefined;
  // The live recorder's points, read at call time so the save-as-route actions never rebuild
  // closures per GPS fix in the composition root.
  getTrackPoints: () => TrackPoint[];
}

export function createRouteController(deps: RouteControllerDeps) {
  const { origin, routeStore, courseGuidance } = deps;

  let routeError = $state<string | undefined>();
  let gotoActive = $state(false);

  const courseActive = $derived(routeStore.activeId !== undefined || gotoActive);

  let wasGuidanceActive = false;
  $effect(() => {
    const active = courseGuidance.active;
    if (!active && wasGuidanceActive && courseActive) {
      routeStore.setActive(undefined);
      gotoActive = false;
    }
    wasGuidanceActive = active;
  });

  function flagRouteError(message: string): void {
    routeError = message;
  }

  function clearRouteError(): void {
    routeError = undefined;
  }

  async function refreshRoutes(): Promise<void> {
    const routes = await fetchRoutes(origin, deps.getToken());
    if (routes) {
      routeStore.setRoutes(routes);
      return;
    }
    if (routeStore.routes.length === 0) {
      flagRouteError('Could not load routes. Check the connection.');
    }
  }

  async function stopActiveCourse(): Promise<boolean> {
    if (!(await clearCourse(origin, deps.getToken()))) return false;
    routeStore.setActive(undefined);
    gotoActive = false;
    courseGuidance.clear();
    return true;
  }

  async function hydrateAndSeedCourse(): Promise<void> {
    const startedAt = Date.now();
    const { info, calc } = await hydrateCourse(origin, deps.getToken());
    courseGuidance.seed(info, calc, startedAt);
    const activation = activationFromCourse(info);
    if (!activation) return;
    if (activation.routeId) {
      if (routeStore.activeId !== activation.routeId) {
        routeStore.setActive(activation.routeId);
        routeStore.toggleShown(activation.routeId, true);
      }
      gotoActive = false;
    } else if (activation.goto) {
      routeStore.setActive(undefined);
      gotoActive = true;
    }
  }

  function flyToRouteStart(id: string): void {
    const start = routeStore.routeById(id)?.waypoints[0]?.position;
    if (start) deps.flyTo(start.latitude, start.longitude);
  }

  function onToggleRouteShown(id: string, shown: boolean): void {
    routeStore.toggleShown(id, shown);
    if (shown) flyToRouteStart(id);
  }

  function beginNewRoute(initialPoint?: LatLon): void {
    clearRouteError();
    routeStore.setWorking({ id: uuidv4(), name: '', waypoints: [] });
    deps.startRouteEdit(undefined, initialPoint);
  }

  function onEditRoute(id: string): void {
    const route = routeStore.routeById(id);
    if (!route) return;
    routeStore.setWorking(route);
    deps.startRouteEdit(route);
    flyToRouteStart(id);
  }

  async function onSaveRoute(name: string): Promise<void> {
    clearRouteError();
    const working = routeStore.working;
    if (!working || working.waypoints.length < 2) return;
    const route = { ...working, name: name.trim() || defaultSaveName('Route') };
    if (!(await saveRoute(origin, deps.getToken(), route))) {
      flagRouteError('Could not save the route. It is kept under edit so you can retry.');
      routeStore.setWorking(route);
      return;
    }
    deps.stopRouteEdit();
    routeStore.setWorking(undefined);
    routeStore.toggleShown(route.id, true);
    await refreshRoutes();
  }

  function onCancelRouteEdit(): void {
    deps.stopRouteEdit();
    routeStore.setWorking(undefined);
  }

  async function onDeleteRoute(id: string): Promise<void> {
    clearRouteError();
    if (id === routeStore.activeId && !(await stopActiveCourse())) {
      flagRouteError('Could not stop the active route, so it was not deleted.');
      return;
    }
    if (!(await deleteRoute(origin, deps.getToken(), id))) {
      flagRouteError('Could not delete the route.');
      return;
    }
    routeStore.toggleShown(id, false);
    await refreshRoutes();
  }

  async function onActivateRoute(id: string): Promise<void> {
    clearRouteError();
    if (!(await activateRoute(origin, deps.getToken(), routeHref(id)))) {
      flagRouteError('Could not activate the route. Check the connection.');
      return;
    }
    routeStore.setActive(id);
    gotoActive = false;
    routeStore.toggleShown(id, true);
    flyToRouteStart(id);
    await hydrateAndSeedCourse();
  }

  async function onStopCourse(): Promise<void> {
    clearRouteError();
    if (!(await stopActiveCourse())) {
      flagRouteError('Could not stop the active route. Check the connection.');
    }
  }

  function onSkipPoint(delta: number): void {
    void advancePoint(origin, deps.getToken(), delta).then((ok) => {
      if (!ok) flagRouteError('Could not skip the waypoint. Check the connection.');
    });
  }

  async function onSaveTrackAsRoute(name: string): Promise<void> {
    clearRouteError();
    const points = deps.getTrackPoints();
    if (points.length < 2) return;
    const route = trackToRoute(points, name);
    if (!(await saveRoute(origin, deps.getToken(), route))) {
      flagRouteError('Could not save the track as a route.');
      return;
    }
    await refreshRoutes();
    routeStore.toggleShown(route.id, true);
  }

  async function onTrackHome(): Promise<void> {
    clearRouteError();
    const points = deps.getTrackPoints();
    if (points.length < 2) return;
    const route = trackToRoute(points, 'Track home');
    route.waypoints.reverse();
    if (!(await saveRoute(origin, deps.getToken(), route))) {
      flagRouteError('Could not build the route home.');
      return;
    }
    await refreshRoutes();
    if (!(await activateRoute(origin, deps.getToken(), routeHref(route.id)))) {
      flagRouteError('Could not start navigating home.');
      return;
    }
    routeStore.setActive(route.id);
    gotoActive = false;
    routeStore.toggleShown(route.id, true);
    await hydrateAndSeedCourse();
  }

  async function onReverseRoute(id: string): Promise<void> {
    clearRouteError();
    const route = routeStore.routeById(id);
    if (!route) return;
    const reversed = reverseRoute(route);
    if (!(await saveRoute(origin, deps.getToken(), reversed))) {
      flagRouteError('Could not reverse the route.');
      return;
    }
    await refreshRoutes();
    routeStore.toggleShown(reversed.id, true);
  }

  function onExportRouteGpx(id: string): void {
    const route = routeStore.routeById(id);
    if (route) downloadRouteGpx(route);
  }

  async function onImportRouteGpx(gpxText: string): Promise<void> {
    clearRouteError();
    const parsed = parseGpxRoutes(gpxText);
    if (parsed.length === 0) {
      flagRouteError('No routes found in that GPX file.');
      return;
    }
    const saved = [];
    for (const route of parsed) {
      if (await saveRoute(origin, deps.getToken(), route)) saved.push(route.id);
    }
    if (saved.length === 0) {
      flagRouteError('Could not save the imported route.');
      return;
    }
    if (saved.length < parsed.length) {
      flagRouteError(`Imported ${saved.length} of ${parsed.length} routes; the rest did not save.`);
    }
    await refreshRoutes();
    for (const id of saved) routeStore.toggleShown(id, true);
  }

  async function onGoToHere(position: LatLon): Promise<void> {
    clearRouteError();
    if (!(await setDestination(origin, deps.getToken(), position))) {
      flagRouteError('Could not set the destination. Check the connection.');
      return;
    }
    routeStore.setActive(undefined);
    gotoActive = true;
    await hydrateAndSeedCourse();
  }

  return {
    refreshRoutes,
    hydrateAndSeedCourse,
    onToggleRouteShown,
    beginNewRoute,
    onEditRoute,
    onSaveRoute,
    onCancelRouteEdit,
    onDeleteRoute,
    onActivateRoute,
    onStopCourse,
    onSkipPoint,
    onSaveTrackAsRoute,
    onTrackHome,
    onReverseRoute,
    onExportRouteGpx,
    onImportRouteGpx,
    onGoToHere,
    flyToRouteStart,
    flagRouteError,
    clearRouteError,
    get routeError() {
      return routeError;
    },
    get courseActive() {
      return courseActive;
    },
    get gotoActive() {
      return gotoActive;
    },
  };
}
