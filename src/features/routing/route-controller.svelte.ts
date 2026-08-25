import type { CourseGuidance } from '$entities/course';
import type { Route, RouteStore } from '$entities/route';
import { reverseRoute } from '$entities/route';
import { type TrackPoint, trackToRoute } from '$entities/track';
import { type Waypoint, waypointHref } from '$entities/waypoint';
import { boundsOfPoints, type LatLon } from '$shared/geo';
import { createBusyGate, ErrorState, type Toast, uuidv4 } from '$shared/lib';
import {
  type ActiveRoute,
  type CourseInfo,
  createWriteOutcomeGate,
  deleteRefusedMessage,
  writeRefusedMessage,
} from '$shared/signalk';
import { defaultSaveName } from '$shared/ui';
import {
  activateRoute,
  activationFromCourse,
  advancePoint,
  clearCourse,
  type DestinationTarget,
  hydrateCourse,
  refreshActiveRoute,
  setActiveRoutePointIndex,
  setDestination,
} from './course-client';
import { parseGpxRoutesDetailed } from './gpx-import';
import { downloadRouteGpx } from './route-gpx';
import {
  deleteRoute,
  fetchRoutes,
  fetchRoutesProvisioned,
  routeHref,
  saveRoute,
} from './routes-client';

export interface RouteControllerDeps {
  origin: string;
  getToken: () => string | undefined;
  writeBlocked: () => boolean;
  // Ask the server for read/write access again after it refuses a write mid-session (a revoked
  // token, an expired session). The draft stays on screen while the request is outstanding.
  requestWriteAccess: () => Promise<void>;
  // A live chart-tool exclusion checked at every edit entry point. The shell supplies Measure's
  // active state so route editing refuses overlap instead of silently ending either tool.
  editBlockedReason?: () => string | undefined;
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
  wait?: (ms: number) => Promise<void>;
  arrivalAdvanceDelayMs?: number;
}

export type RouteLoadState = 'idle' | 'loading' | 'ready' | 'error';
// Whether the server has a routes resource provider at all: 'unknown' until the probe answers,
// then sticky through transient outages so the admin-path note never flashes at a healthy server.
export type RoutesProvisioning = 'unknown' | 'provisioned' | 'unprovisioned';

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
  let provisioning = $state<RoutesProvisioning>('unknown');
  let busy = $state(false);
  let refreshSequence = 0;
  let hydrateSequence = 0;
  let arrivalAdvanceSequence = 0;
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

  // Reports through the route error state rather than a bare toast, so a failed write lands where
  // the routes panel already looks for one.
  const accepted = createWriteOutcomeGate({
    report: flagRouteError,
    requestWriteAccess: () => deps.requestWriteAccess(),
  });

  function clearRouteError(): void {
    routeError.clear();
  }

  function invalidateRefresh(): void {
    refreshSequence += 1;
    refreshing = false;
    if (loadState === 'loading') loadState = routeStore.routes.length > 0 ? 'ready' : 'idle';
  }

  function queueWaypointChange(change: () => Promise<void>): void {
    // A transport or hydration exception must not poison the shared queue. Recover before each
    // append, then consume this task's rejection so later manual and arrival advances still run.
    skipQueue = skipQueue.then(change).catch((error) => {
      console.warn('[routing] waypoint update failed', error);
      flagRouteError('Could not update the active waypoint. Check the connection.');
    });
  }

  const withBusy = createBusyGate(
    () => busy,
    (next) => {
      busy = next;
    },
  );

  async function refreshRoutes(): Promise<void> {
    const sequence = ++refreshSequence;
    refreshing = true;
    loadState = 'loading';
    const token = deps.getToken();
    const [routes, provisioned] = await Promise.all([
      fetchRoutes(origin, token),
      fetchRoutesProvisioned(origin, token),
    ]);
    if (sequence !== refreshSequence) return;
    refreshing = false;
    // An unanswered probe keeps the last known value (the tracks pattern): a transient outage
    // must not flash the no-route-storage note at a server that has a provider.
    if (provisioned !== undefined) provisioning = provisioned ? 'provisioned' : 'unprovisioned';
    if (routes) {
      routeStore.setRoutes(routes);
      loadState = 'ready';
      return;
    }
    loadState = 'error';
  }

  async function stopActiveCourse(): Promise<boolean> {
    hydrateSequence += 1;
    arrivalAdvanceSequence += 1;
    if (!(await clearCourse(origin, deps.getToken()))) return false;
    routeStore.setActive(undefined);
    gotoActive = false;
    courseGuidance.clear();
    return true;
  }

  async function hydrateAndSeedCourse(): Promise<CourseInfo | undefined> {
    const sequence = ++hydrateSequence;
    const startedAt = Date.now();
    const { info, calc } = await hydrateCourse(origin, deps.getToken());
    if (sequence !== hydrateSequence) return undefined;
    courseGuidance.seed(info, calc, startedAt);
    const activation = activationFromCourse(info);
    if (!activation) return info;
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
    return info;
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
    // The invariant is enforced twice in the UI today (the panel disables New route while a route
    // is under edit, and the chart context menu is suppressed entirely), by two different
    // mechanisms, and nowhere in the controller that owns it. Hold it here too, so a third caller
    // cannot silently discard an in-progress edit.
    if (routeStore.working) {
      flagRouteError('Save or cancel the route under edit before starting a new one.');
      return;
    }
    if (deps.writeBlocked()) {
      flagRouteError(
        'Read-only access: the route was not created. Request read and write access to continue.',
      );
      return;
    }
    const blockedReason = deps.editBlockedReason?.();
    if (blockedReason) {
      flagRouteError(blockedReason);
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
      flagRouteError(
        'Read-only access: the route was not changed. Request read and write access to continue.',
      );
      return;
    }
    const blockedReason = deps.editBlockedReason?.();
    if (blockedReason) {
      flagRouteError(blockedReason);
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
      flagRouteError(
        'Read-only access: the route was not changed. Request read and write access to continue.',
      );
      return;
    }
    const blockedReason = deps.editBlockedReason?.();
    if (blockedReason) {
      flagRouteError(blockedReason);
      return;
    }
    editorLoadFailed = false;
    clearRouteError();
    if (!deps.startRouteEdit(lastEditRequest.route, lastEditRequest.initialPoint)) {
      routeError.flag('The chart is still loading. Try again in a moment.');
    }
  }

  // Resolves whether the route was saved, so the panel can keep its name form (and the name the
  // navigator typed) on screen when it was not.
  async function onSaveRoute(name: string): Promise<boolean> {
    clearRouteError();
    if (deps.writeBlocked()) {
      flagRouteError(
        'Read-only access: the route was not saved. Request read and write access to continue.',
      );
      return false;
    }
    const working = routeStore.working;
    if (!working || working.waypoints.length < 2) return false;
    invalidateRefresh();
    const route = { ...working, name: name.trim() || defaultSaveName('Route') };
    // The route stays under edit either way, so a refusal is recoverable without redrawing it.
    const saved = await saveRoute(origin, deps.getToken(), route);
    if (
      !accepted(
        saved,
        writeRefusedMessage('route'),
        'Could not save the route. It is kept under edit so you can retry.',
      )
    ) {
      routeStore.setWorking(route);
      return false;
    }
    deps.stopRouteEdit();
    routeStore.setWorking(undefined);
    routeStore.upsertRoute(route);
    routeStore.toggleShown(route.id, true);
    // A write the server accepted is direct proof a routes provider is registered, which is
    // stronger evidence than the probe and covers a server whose _providers route never answers.
    provisioning = 'provisioned';
    if (route.id === routeStore.activeId) {
      if (!(await refreshActiveRoute(origin, deps.getToken()))) {
        flagRouteError('The route was saved, but active navigation could not refresh.');
      }
      await hydrateAndSeedCourse();
    }
    await refreshRoutes();
    return true;
  }

  function onCancelRouteEdit(): void {
    deps.stopRouteEdit();
    routeStore.setWorking(undefined);
  }

  async function onDeleteRoute(id: string): Promise<void> {
    clearRouteError();
    if (deps.writeBlocked()) {
      flagRouteError(
        'Read-only access: the route was not deleted. Request read and write access to continue.',
      );
      return;
    }
    invalidateRefresh();
    const wasActive = id === routeStore.activeId;
    if (wasActive && !(await stopActiveCourse())) {
      flagRouteError('Could not stop the active route, so it was not deleted.');
      return;
    }
    const deleted = await deleteRoute(origin, deps.getToken(), id);
    if (deleted !== 'ok') {
      if (!wasActive) {
        accepted(deleted, deleteRefusedMessage(), 'Could not delete the route.');
        return;
      }
      if (deleted === 'access-denied') void deps.requestWriteAccess();
      if (await activateRoute(origin, deps.getToken(), routeHref(id))) {
        routeStore.setActive(id);
        routeStore.toggleShown(id, true);
        await hydrateAndSeedCourse();
        flagRouteError('Could not delete the route. Active navigation was restarted.');
      } else {
        flagRouteError('Could not delete the route, and active navigation could not be restarted.');
      }
      return;
    }
    routeStore.removeRoute(id);
    await refreshRoutes();
  }

  async function onActivateRoute(id: string): Promise<void> {
    clearRouteError();
    if (deps.writeBlocked()) {
      flagRouteError(
        'Read-only access: navigation was not started. Request read and write access to continue.',
      );
      return;
    }
    hydrateSequence += 1;
    arrivalAdvanceSequence += 1;
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
      flagRouteError(
        'Read-only access: navigation was not stopped. Request read and write access to continue.',
      );
      return;
    }
    if (!(await stopActiveCourse())) {
      flagRouteError('Could not stop the active route. Check the connection.');
    }
  }

  function onSkipPoint(delta: number): void {
    if (deps.writeBlocked()) {
      flagRouteError(
        'Read-only access: the active waypoint was not changed. Request read and write access to continue.',
      );
      return;
    }
    arrivalAdvanceSequence += 1;
    queueWaypointChange(async () => {
      if (!(await advancePoint(origin, deps.getToken(), delta))) {
        flagRouteError('Could not skip the waypoint. Check the connection.');
        return;
      }
      await hydrateAndSeedCourse();
    });
  }

  // Arrival auto-advance is intentionally absolute and delayed briefly. Signal K may advance the
  // course itself at the arrival circle; rehydrating after the grace period lets that update win.
  // If the same point is still active, writing the captured target index is idempotent and cannot
  // double-step when another station sends the same target concurrently.
  function onArrivalAdvance(snapshot: ActiveRoute): void {
    if (deps.writeBlocked()) {
      flagRouteError(
        'Read-only access: the active waypoint was not advanced. Request read and write access to continue.',
      );
      return;
    }
    const href = snapshot.href;
    const pointIndex = snapshot.pointIndex;
    const pointTotal = snapshot.pointTotal;
    if (
      typeof href !== 'string' ||
      !Number.isInteger(pointIndex) ||
      pointIndex === undefined ||
      !Number.isInteger(pointTotal) ||
      pointTotal === undefined ||
      pointIndex < 0 ||
      pointIndex >= pointTotal - 1
    ) {
      return;
    }
    // pointIndex always follows traversal order. On a reversed route, Signal K maps index zero to
    // the route's final geometry point, so advancing still increments the sequential index.
    const target = pointIndex + 1;
    const sequence = ++arrivalAdvanceSequence;
    const wait =
      deps.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    queueWaypointChange(async () => {
      await wait(deps.arrivalAdvanceDelayMs ?? 750);
      if (sequence !== arrivalAdvanceSequence) return;
      const current = await hydrateAndSeedCourse();
      if (sequence !== arrivalAdvanceSequence) return;
      const active = current?.activeRoute;
      if (active?.href !== href || !Number.isInteger(active.pointIndex)) return;
      if ((active.pointIndex as number) >= target) return;
      if (active.pointIndex !== pointIndex) return;
      if (!(await setActiveRoutePointIndex(origin, deps.getToken(), active, target))) {
        flagRouteError('Could not advance the waypoint. Check the connection.');
        return;
      }
      await hydrateAndSeedCourse();
    });
  }

  // Resolves whether the route was saved, so the tracks panel can keep its name form (and the name
  // the navigator typed) on screen when it was not.
  async function onSaveTrackAsRoute(name: string): Promise<boolean> {
    clearRouteError();
    if (deps.writeBlocked()) {
      flagRouteError(
        'Read-only access: the route was not saved. Request read and write access to continue.',
      );
      return false;
    }
    const points = deps.getTrackPoints();
    const route = trackToRoute(points, name);
    if (route.waypoints.length < 2) {
      flagRouteError('Record at least two connected track points before making a route.');
      return false;
    }
    invalidateRefresh();
    const savedAsRoute = await saveRoute(origin, deps.getToken(), route);
    if (
      !accepted(savedAsRoute, writeRefusedMessage('track'), 'Could not save the track as a route.')
    ) {
      return false;
    }
    routeStore.upsertRoute(route);
    await refreshRoutes();
    routeStore.toggleShown(route.id, true);
    return true;
  }

  async function onTrackHome(): Promise<void> {
    clearRouteError();
    if (deps.writeBlocked()) {
      flagRouteError(
        'Read-only access: navigation was not started. Request read and write access to continue.',
      );
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
    const savedHome = await saveRoute(origin, deps.getToken(), route);
    if (
      !accepted(savedHome, writeRefusedMessage('route home'), 'Could not build the route home.')
    ) {
      return;
    }
    routeStore.upsertRoute(route);
    await refreshRoutes();
    hydrateSequence += 1;
    arrivalAdvanceSequence += 1;
    if (!(await activateRoute(origin, deps.getToken(), routeHref(route.id)))) {
      flagRouteError('Could not start navigating home.');
      return;
    }
    routeStore.setActive(route.id);
    gotoActive = false;
    routeStore.toggleShown(route.id, true);
    await hydrateAndSeedCourse();
  }

  // Rename in place. The strip's quick Save lands a route under a dated default name, so a route
  // drawn from the chart needs a way to be named without re-entering chart edit mode.
  async function onRenameRoute(id: string, name: string): Promise<boolean> {
    clearRouteError();
    if (deps.writeBlocked()) {
      flagRouteError(
        'Read-only access: the route was not renamed. Request read and write access to continue.',
      );
      return false;
    }
    const route = routeStore.routeById(id);
    const trimmed = name.trim();
    if (!route || !trimmed || trimmed === route.name) return false;
    invalidateRefresh();
    const renamed = { ...route, name: trimmed };
    const saved = await saveRoute(origin, deps.getToken(), renamed);
    if (!accepted(saved, writeRefusedMessage('route'), 'Could not rename the route.')) {
      return false;
    }
    routeStore.upsertRoute(renamed);
    await refreshRoutes();
    return true;
  }

  async function onReverseRoute(id: string): Promise<void> {
    clearRouteError();
    if (deps.writeBlocked()) {
      flagRouteError(
        'Read-only access: the route was not reversed. Request read and write access to continue.',
      );
      return;
    }
    const route = routeStore.routeById(id);
    if (!route) return;
    invalidateRefresh();
    const reversed = reverseRoute(route);
    const savedReverse = await saveRoute(origin, deps.getToken(), reversed);
    if (
      !accepted(savedReverse, writeRefusedMessage('reversed route'), 'Could not reverse the route.')
    ) {
      return;
    }
    routeStore.upsertRoute(reversed);
    await refreshRoutes();
    // The reversed route starts at the original's far end, so showing it moves the viewport away
    // from the boat on purpose: that end is where the return leg begins.
    onToggleRouteShown(reversed.id, true);
  }

  function onExportRouteGpx(id: string): void {
    const route = routeStore.routeById(id);
    if (route) downloadRouteGpx(route);
  }

  async function onImportRouteGpx(gpxText: string): Promise<void> {
    clearRouteError();
    if (deps.writeBlocked()) {
      flagRouteError(
        'Read-only access: the route was not imported. Request read and write access to continue.',
      );
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
      flagRouteError(
        parsedResult.sawTracks
          ? 'That GPX file holds tracks, not routes. Binnacle imports routes only.'
          : 'No routes found in that GPX file.',
      );
      return;
    }
    invalidateRefresh();
    const saved: string[] = [];
    let refused = false;
    for (const route of parsed) {
      const outcome = await saveRoute(origin, deps.getToken(), route);
      refused ||= outcome === 'access-denied';
      if (outcome === 'ok') {
        saved.push(route.id);
        routeStore.upsertRoute(route);
      }
    }
    if (saved.length === 0) {
      accepted(
        refused ? 'access-denied' : 'failed',
        writeRefusedMessage('import'),
        'Could not save the imported route.',
      );
      return;
    }
    if (refused) void deps.requestWriteAccess();
    if (saved.length < parsed.length) {
      flagRouteError(`Imported ${saved.length} of ${parsed.length} routes; the rest did not save.`);
    }
    await refreshRoutes();
    for (const id of saved) routeStore.toggleShown(id, true);
    // One pan for the whole import: showing each route through onToggleRouteShown would fly once per
    // route and leave the viewport on whichever imported last.
    const [firstSaved] = saved;
    if (firstSaved) flyToRouteStart(firstSaved);
  }

  // Both goto entry points share the write guard, the sequence bumps that discard an in-flight
  // hydration, and the bookkeeping a single-point course needs. fallback is attempted once, only
  // when the server rejects the primary target.
  async function goToDestination(
    target: DestinationTarget,
    fallback?: DestinationTarget,
  ): Promise<void> {
    clearRouteError();
    if (deps.writeBlocked()) {
      flagRouteError(
        'Read-only access: navigation was not started. Request read and write access to continue.',
      );
      return;
    }
    hydrateSequence += 1;
    arrivalAdvanceSequence += 1;
    let destinationSet = await setDestination(origin, deps.getToken(), target);
    if (!destinationSet && fallback) {
      destinationSet = await setDestination(origin, deps.getToken(), fallback);
    }
    if (!destinationSet) {
      flagRouteError('Could not set the destination. Check the connection.');
      return;
    }
    routeStore.setActive(undefined);
    gotoActive = true;
    await hydrateAndSeedCourse();
  }

  function onGoToHere(position: LatLon): Promise<void> {
    return goToDestination({ position });
  }

  // Navigating to a saved waypoint sends its resource href, so the server resolves the waypoint and
  // publishes its name on nextPoint; a position-only destination leaves every station reading an
  // unnamed course. The waypoint came from this server, so a rejected href is either a transient
  // failure, where the position retry fails too and the error surfaces, or an href-specific quirk,
  // where navigation still starts without the name.
  function onGoToWaypoint(waypoint: Pick<Waypoint, 'id' | 'position'>): Promise<void> {
    return goToDestination({ href: waypointHref(waypoint.id) }, { position: waypoint.position });
  }

  return {
    refreshRoutes,
    hydrateAndSeedCourse,
    onToggleRouteShown,
    beginNewRoute,
    onEditRoute,
    onSaveRoute: withBusy(onSaveRoute, false),
    onCancelRouteEdit,
    onDeleteRoute: withBusy(onDeleteRoute),
    onActivateRoute: withBusy(onActivateRoute),
    onStopCourse: withBusy(onStopCourse),
    onSkipPoint,
    onArrivalAdvance,
    onSaveTrackAsRoute: withBusy(onSaveTrackAsRoute, false),
    onTrackHome: withBusy(onTrackHome),
    onRenameRoute: withBusy(onRenameRoute, false),
    onReverseRoute: withBusy(onReverseRoute),
    onExportRouteGpx,
    onImportRouteGpx: withBusy(onImportRouteGpx),
    onGoToHere: withBusy(onGoToHere),
    onGoToWaypoint: withBusy(onGoToWaypoint),
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
    get provisioning() {
      return provisioning;
    },
    get busy() {
      return busy;
    },
  };
}
