import type { CourseGuidance } from '$entities/course';
import type { Route, RouteStore } from '$entities/route';
import { reverseRoute } from '$entities/route';
import type { TrackPoint } from '$entities/track';
import { trackToRoute } from '$features/track-layer';
import { boundsOfPoints, type LatLon } from '$shared/geo';
import { ErrorState, type Toast, uuidv4 } from '$shared/lib';
import { defaultSaveName } from '$shared/ui';
import {
  activateRoute,
  activationFromCourse,
  advancePoint,
  clearCourse,
  hydrateCourse,
  refreshActiveRoute,
  setDestination,
} from './course-client';
import { parseGpxRoutesDetailed } from './gpx-import';
import { downloadRouteGpx } from './route-gpx';
import { deleteRoute, fetchRoutes, routeHref, saveRoute } from './routes-client';

export interface RouteControllerDeps {
  origin: string;
  getToken: () => string | undefined;
  writeBlocked: () => boolean;
  routeStore: RouteStore;
  courseGuidance: CourseGuidance;
  // Transient action failures (a failed save, activate, stop, delete, and similar) surface here
  // instead of the panel-local routeError, so they are still visible after the panel that raised
  // them closes.
  toast: Toast;
  flyTo: (lat: number, lon: number) => void;
  fitBounds: (bounds: [number, number, number, number]) => void;
  startRouteEdit: (route?: Route, initialPoint?: LatLon) => boolean;
  stopRouteEdit: () => void;
  // The live recorder's points, read at call time so the save-as-route actions never rebuild
  // closures per GPS fix in the composition root.
  getTrackPoints: () => TrackPoint[];
}

export type RouteLoadState = 'idle' | 'loading' | 'ready' | 'error';

export function createRouteController(deps: RouteControllerDeps) {
  const { origin, routeStore, courseGuidance } = deps;

  const routeError = new ErrorState();
  let gotoActive = $state(false);
  // The route or initial point the last startRouteEdit call used, so a Retry after a lazy-load
  // failure can replay the exact same request rather than needing its own separate state machine.
  let lastEditRequest: { route?: Route; initialPoint?: LatLon } | undefined;
  let editorLoadFailed = $state(false);
  let refreshing = $state(false);
  let loadState = $state<RouteLoadState>('idle');
  let busy = $state(false);
  let refreshSequence = 0;
  let skipQueue = Promise.resolve();

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

  // A transient action failure (a failed save, activate, stop, delete, and similar): shown as a
  // toast so it survives the panel that raised it closing, rather than the panel-local routeError,
  // which is reserved for the editor-load failure below (contextual, with its own Retry action).
  function flagRouteError(message: string): void {
    deps.toast.show(message);
  }

  function clearRouteError(): void {
    routeError.clear();
  }

  function invalidateRefresh(): void {
    refreshSequence += 1;
    refreshing = false;
    if (loadState === 'loading') loadState = routeStore.routes.length > 0 ? 'ready' : 'idle';
  }

  function withBusy<Args extends unknown[]>(
    action: (...args: Args) => Promise<void>,
  ): (...args: Args) => Promise<void> {
    return async (...args) => {
      if (busy) return;
      busy = true;
      try {
        await action(...args);
      } finally {
        busy = false;
      }
    };
  }

  async function refreshRoutes(): Promise<void> {
    const sequence = ++refreshSequence;
    refreshing = true;
    loadState = 'loading';
    const routes = await fetchRoutes(origin, deps.getToken());
    if (sequence !== refreshSequence) return;
    refreshing = false;
    if (routes) {
      routeStore.setRoutes(routes);
      loadState = 'ready';
      return;
    }
    loadState = 'error';
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

  function showRoute(id: string): void {
    const route = routeStore.routeById(id);
    if (!route) return;
    const bounds = boundsOfPoints(route.waypoints.map((waypoint) => waypoint.position));
    if (bounds) deps.fitBounds(bounds);
  }

  function onToggleRouteShown(id: string, shown: boolean): void {
    routeStore.toggleShown(id, shown);
    if (shown) flyToRouteStart(id);
  }

  function beginNewRoute(initialPoint?: LatLon): void {
    clearRouteError();
    if (deps.writeBlocked()) {
      flagRouteError('A write token is needed to create routes.');
      return;
    }
    editorLoadFailed = false;
    lastEditRequest = { initialPoint };
    routeStore.setWorking({ id: uuidv4(), name: '', waypoints: [] });
    if (!deps.startRouteEdit(undefined, initialPoint)) {
      routeStore.setWorking(undefined);
      routeError.flag('The chart is still loading. Try creating the route again in a moment.');
    }
  }

  function onEditRoute(id: string): void {
    if (deps.writeBlocked()) {
      flagRouteError('A write token is needed to edit routes.');
      return;
    }
    const route = routeStore.routeById(id);
    if (!route) return;
    clearRouteError();
    editorLoadFailed = false;
    lastEditRequest = { route };
    routeStore.setWorking(route);
    if (!deps.startRouteEdit(route)) {
      routeStore.setWorking(undefined);
      routeError.flag('The chart is still loading. Try editing the route again in a moment.');
      return;
    }
    flyToRouteStart(id);
  }

  // The editor's dynamic import failed (a bad chunk fetch, not a user action). loadRouteEditor
  // already resets its own cache so the next startRouteEdit call re-triggers the import; Retry only
  // needs to replay the last request, not any new recovery logic of its own.
  function flagEditorLoadFailed(): void {
    editorLoadFailed = true;
    routeError.flag('The route editor failed to load.');
  }

  function retryRouteEdit(): void {
    if (!lastEditRequest) return;
    if (deps.writeBlocked()) {
      flagRouteError('A write token is needed to edit routes.');
      return;
    }
    editorLoadFailed = false;
    clearRouteError();
    if (!deps.startRouteEdit(lastEditRequest.route, lastEditRequest.initialPoint)) {
      routeError.flag('The chart is still loading. Try again in a moment.');
    }
  }

  async function onSaveRoute(name: string): Promise<void> {
    clearRouteError();
    if (deps.writeBlocked()) {
      flagRouteError('A write token is needed to save routes.');
      return;
    }
    const working = routeStore.working;
    if (!working || working.waypoints.length < 2) return;
    invalidateRefresh();
    const route = { ...working, name: name.trim() || defaultSaveName('Route') };
    if (!(await saveRoute(origin, deps.getToken(), route))) {
      flagRouteError('Could not save the route. It is kept under edit so you can retry.');
      routeStore.setWorking(route);
      return;
    }
    deps.stopRouteEdit();
    routeStore.setWorking(undefined);
    routeStore.upsertRoute(route);
    routeStore.toggleShown(route.id, true);
    if (route.id === routeStore.activeId) {
      if (!(await refreshActiveRoute(origin, deps.getToken()))) {
        flagRouteError('The route was saved, but active navigation could not refresh.');
      }
      await hydrateAndSeedCourse();
    }
    await refreshRoutes();
  }

  function onCancelRouteEdit(): void {
    deps.stopRouteEdit();
    routeStore.setWorking(undefined);
  }

  async function onDeleteRoute(id: string): Promise<void> {
    clearRouteError();
    if (deps.writeBlocked()) {
      flagRouteError('A write token is needed to delete routes.');
      return;
    }
    invalidateRefresh();
    if (id === routeStore.activeId && !(await stopActiveCourse())) {
      flagRouteError('Could not stop the active route, so it was not deleted.');
      return;
    }
    if (!(await deleteRoute(origin, deps.getToken(), id))) {
      flagRouteError('Could not delete the route.');
      return;
    }
    routeStore.removeRoute(id);
    await refreshRoutes();
  }

  async function onActivateRoute(id: string): Promise<void> {
    clearRouteError();
    if (deps.writeBlocked()) {
      flagRouteError('A write token is needed to start navigation.');
      return;
    }
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
    if (deps.writeBlocked()) {
      flagRouteError('A write token is needed to stop navigation.');
      return;
    }
    if (!(await stopActiveCourse())) {
      flagRouteError('Could not stop the active route. Check the connection.');
    }
  }

  function onSkipPoint(delta: number): void {
    if (deps.writeBlocked()) {
      flagRouteError('A write token is needed to change the active waypoint.');
      return;
    }
    skipQueue = skipQueue.then(async () => {
      if (!(await advancePoint(origin, deps.getToken(), delta))) {
        flagRouteError('Could not skip the waypoint. Check the connection.');
        return;
      }
      await hydrateAndSeedCourse();
    });
  }

  async function onSaveTrackAsRoute(name: string): Promise<void> {
    clearRouteError();
    if (deps.writeBlocked()) {
      flagRouteError('A write token is needed to save routes.');
      return;
    }
    const points = deps.getTrackPoints();
    const route = trackToRoute(points, name);
    if (route.waypoints.length < 2) {
      flagRouteError('Record at least two connected track points before making a route.');
      return;
    }
    invalidateRefresh();
    if (!(await saveRoute(origin, deps.getToken(), route))) {
      flagRouteError('Could not save the track as a route.');
      return;
    }
    routeStore.upsertRoute(route);
    await refreshRoutes();
    routeStore.toggleShown(route.id, true);
  }

  async function onTrackHome(): Promise<void> {
    clearRouteError();
    if (deps.writeBlocked()) {
      flagRouteError('A write token is needed to start navigation.');
      return;
    }
    const points = deps.getTrackPoints();
    const route = trackToRoute(points, 'Track home');
    if (route.waypoints.length < 2) {
      flagRouteError('Record at least two connected track points before retracing.');
      return;
    }
    invalidateRefresh();
    route.waypoints.reverse();
    if (!(await saveRoute(origin, deps.getToken(), route))) {
      flagRouteError('Could not build the route home.');
      return;
    }
    routeStore.upsertRoute(route);
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
    if (deps.writeBlocked()) {
      flagRouteError('A write token is needed to reverse routes.');
      return;
    }
    const route = routeStore.routeById(id);
    if (!route) return;
    invalidateRefresh();
    const reversed = reverseRoute(route);
    if (!(await saveRoute(origin, deps.getToken(), reversed))) {
      flagRouteError('Could not reverse the route.');
      return;
    }
    routeStore.upsertRoute(reversed);
    await refreshRoutes();
    routeStore.toggleShown(reversed.id, true);
  }

  function onExportRouteGpx(id: string): void {
    const route = routeStore.routeById(id);
    if (route) downloadRouteGpx(route);
  }

  async function onImportRouteGpx(gpxText: string): Promise<void> {
    clearRouteError();
    if (deps.writeBlocked()) {
      flagRouteError('A write token is needed to import routes.');
      return;
    }
    const parsedResult = parseGpxRoutesDetailed(gpxText);
    if (parsedResult.error) {
      const messages = {
        'file-too-large': 'That GPX file is too large. The limit is 5 MB.',
        'too-many-routes': 'That GPX file has too many routes. The limit is 100.',
        'too-many-waypoints': 'That GPX file has too many waypoints. The limit is 10,000.',
      } as const;
      flagRouteError(messages[parsedResult.error]);
      return;
    }
    const parsed = parsedResult.routes;
    if (parsed.length === 0) {
      flagRouteError('No routes found in that GPX file.');
      return;
    }
    invalidateRefresh();
    const saved = [];
    for (const route of parsed) {
      if (await saveRoute(origin, deps.getToken(), route)) {
        saved.push(route.id);
        routeStore.upsertRoute(route);
      }
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
    if (deps.writeBlocked()) {
      flagRouteError('A write token is needed to start navigation.');
      return;
    }
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
    onSaveRoute: withBusy(onSaveRoute),
    onCancelRouteEdit,
    onDeleteRoute: withBusy(onDeleteRoute),
    onActivateRoute: withBusy(onActivateRoute),
    onStopCourse: withBusy(onStopCourse),
    onSkipPoint,
    onSaveTrackAsRoute: withBusy(onSaveTrackAsRoute),
    onTrackHome: withBusy(onTrackHome),
    onReverseRoute: withBusy(onReverseRoute),
    onExportRouteGpx,
    onImportRouteGpx: withBusy(onImportRouteGpx),
    onGoToHere: withBusy(onGoToHere),
    flyToRouteStart,
    showRoute,
    clearRouteError,
    flagEditorLoadFailed,
    retryRouteEdit,
    get routeError() {
      return routeError.message;
    },
    get editorLoadFailed() {
      return editorLoadFailed;
    },
    get courseActive() {
      return courseActive;
    },
    get gotoActive() {
      return gotoActive;
    },
    get refreshing() {
      return refreshing;
    },
    get loadState() {
      return loadState;
    },
    get busy() {
      return busy;
    },
  };
}
