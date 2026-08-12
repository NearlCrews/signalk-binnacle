import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CourseGuidance } from '$entities/course';
import { RouteStore } from '$entities/route';
import type { Toast } from '$shared/lib';
import type { ResourceMutationResult } from '$shared/signalk';
import * as courseClient from './course-client';
import { createRouteController } from './route-controller.svelte';
import * as routesClient from './routes-client';

vi.mock('./course-client', () => ({
  activateRoute: vi.fn(),
  activationFromCourse: vi.fn(() => ({})),
  advancePoint: vi.fn(),
  clearCourse: vi.fn(),
  hydrateCourse: vi.fn(async () => ({})),
  refreshActiveRoute: vi.fn(),
  setActiveRoutePointIndex: vi.fn(),
  setDestination: vi.fn(),
}));

vi.mock('./routes-client', () => ({
  deleteRoute: vi.fn(),
  fetchRoutes: vi.fn(),
  fetchRoutesProvisioned: vi.fn(),
  routeHref: (id: string) => `/resources/routes/${encodeURIComponent(id)}`,
  saveRoute: vi.fn(),
}));

const route = {
  id: 'r1',
  name: 'Passage',
  waypoints: [
    { position: { latitude: 42, longitude: -83 } },
    { position: { latitude: 43, longitude: -82 } },
  ],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function makeController(
  writeBlocked = false,
  wait: (ms: number) => Promise<void> = async () => {},
  editBlockedReason?: () => string | undefined,
) {
  const routeStore = new RouteStore();
  const toast = { show: vi.fn() } as unknown as Toast;
  const guidance = {
    active: false,
    seed: vi.fn(),
    clear: vi.fn(),
  } as unknown as CourseGuidance;
  const fitBounds = vi.fn();
  const flyTo = vi.fn();
  const startRouteEdit = vi.fn(() => true);
  const requestWriteAccess = vi.fn(async () => {});
  const controller = createRouteController({
    origin: 'http://sk',
    getToken: () => 'token',
    writeBlocked: () => writeBlocked,
    requestWriteAccess,
    editBlockedReason,
    routeStore,
    courseGuidance: guidance,
    toast,
    flyTo,
    fitBounds,
    startRouteEdit,
    stopRouteEdit: vi.fn(),
    getTrackPoints: () => [],
    wait,
  });
  return {
    controller,
    routeStore,
    toast,
    guidance,
    fitBounds,
    flyTo,
    startRouteEdit,
    requestWriteAccess,
  };
}

// The server keeps what was just written, so the refresh that follows a mutation returns it. Without
// this the default empty fetch would clear the store and hide any follow-up the saved route drives.
function echoStoreOnRefresh(routeStore: RouteStore): void {
  vi.mocked(routesClient.fetchRoutes).mockImplementation(async () => [...routeStore.routes]);
}

function gpxRoute(name: string, lat: number, lon: number): string {
  return `<rte><name>${name}</name><rtept lat="${lat}" lon="${lon}"/><rtept lat="${lat + 1}" lon="${lon + 1}"/></rte>`;
}

describe('createRouteController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(courseClient.hydrateCourse).mockResolvedValue({});
    vi.mocked(courseClient.activationFromCourse).mockReturnValue({});
    vi.mocked(routesClient.fetchRoutes).mockResolvedValue([]);
    vi.mocked(routesClient.fetchRoutesProvisioned).mockResolvedValue(true);
    vi.mocked(routesClient.saveRoute).mockResolvedValue('ok');
    vi.mocked(routesClient.deleteRoute).mockResolvedValue('ok');
    vi.mocked(courseClient.clearCourse).mockResolvedValue(true);
    vi.mocked(courseClient.activateRoute).mockResolvedValue(true);
    vi.mocked(courseClient.refreshActiveRoute).mockResolvedValue(true);
    vi.mocked(courseClient.setActiveRoutePointIndex).mockResolvedValue(true);
  });

  it('keeps a saved route locally when the follow-up refresh fails', async () => {
    const { controller, routeStore, toast } = makeController();
    routeStore.setWorking(route);
    vi.mocked(routesClient.fetchRoutes).mockResolvedValue(undefined);
    await controller.onSaveRoute('Passage');
    expect(routeStore.routeById('r1')).toEqual(route);
    expect(routeStore.shownIds.has('r1')).toBe(true);
    expect(vi.mocked(toast.show)).not.toHaveBeenCalled();
  });

  it('does not let an older route refresh overwrite a newer response', async () => {
    const { controller, routeStore } = makeController();
    let resolveFirst = (_routes: (typeof route)[]): void => {};
    vi.mocked(routesClient.fetchRoutes)
      .mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
      .mockResolvedValueOnce([{ ...route, id: 'new', name: 'New response' }]);
    const first = controller.refreshRoutes();
    const second = controller.refreshRoutes();
    await second;
    resolveFirst([{ ...route, id: 'old', name: 'Old response' }]);
    await first;
    expect(routeStore.routes.map((item) => item.id)).toEqual(['new']);
  });

  it('refreshes the Course API after saving the active route', async () => {
    const { controller, routeStore } = makeController();
    routeStore.setRoutes([route]);
    routeStore.setActive('r1');
    routeStore.setWorking(route);
    await controller.onSaveRoute('Passage');
    expect(courseClient.refreshActiveRoute).toHaveBeenCalledWith('http://sk', 'token');
    expect(courseClient.hydrateCourse).toHaveBeenCalled();
  });

  it('prevents duplicate route mutations while one is in flight', async () => {
    const { controller, routeStore } = makeController();
    routeStore.setWorking(route);
    let resolveSave = (_value: ResourceMutationResult): void => {};
    vi.mocked(routesClient.saveRoute).mockImplementation(
      () => new Promise((resolve) => (resolveSave = resolve)),
    );
    const first = controller.onSaveRoute('Passage');
    const second = controller.onSaveRoute('Passage');
    expect(controller.busy).toBe(true);
    expect(routesClient.saveRoute).toHaveBeenCalledTimes(1);
    resolveSave('ok');
    await Promise.all([first, second]);
    expect(controller.busy).toBe(false);
  });

  it('restarts navigation when deleting the active route fails', async () => {
    const { controller, routeStore, toast } = makeController();
    routeStore.setRoutes([route]);
    routeStore.setActive('r1');
    vi.mocked(routesClient.deleteRoute).mockResolvedValue('failed');

    await controller.onDeleteRoute('r1');

    expect(courseClient.clearCourse).toHaveBeenCalled();
    expect(courseClient.activateRoute).toHaveBeenCalledWith(
      'http://sk',
      'token',
      '/resources/routes/r1',
    );
    expect(routeStore.activeId).toBe('r1');
    expect(toast.show).toHaveBeenCalledWith(
      'Could not delete the route. Active navigation was restarted.',
    );
  });

  it('reports when failed active-route deletion cannot restore navigation', async () => {
    const { controller, routeStore, toast } = makeController();
    routeStore.setRoutes([route]);
    routeStore.setActive('r1');
    vi.mocked(routesClient.deleteRoute).mockResolvedValue('failed');
    vi.mocked(courseClient.activateRoute).mockResolvedValue(false);

    await controller.onDeleteRoute('r1');

    expect(routeStore.activeId).toBeUndefined();
    expect(toast.show).toHaveBeenCalledWith(
      'Could not delete the route, and active navigation could not be restarted.',
    );
  });

  it('serializes rapid waypoint skips', async () => {
    const { controller } = makeController();
    let resolveFirst = (_value: boolean): void => {};
    vi.mocked(courseClient.advancePoint)
      .mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
      .mockResolvedValueOnce(true);
    controller.onSkipPoint(1);
    controller.onSkipPoint(1);
    await Promise.resolve();
    expect(courseClient.advancePoint).toHaveBeenCalledTimes(1);
    resolveFirst(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(courseClient.advancePoint).toHaveBeenCalledTimes(2);
  });

  it('continues processing waypoint skips after an exception', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { controller, toast } = makeController();
    vi.mocked(courseClient.advancePoint)
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(true);

    controller.onSkipPoint(1);
    controller.onSkipPoint(1);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(courseClient.advancePoint).toHaveBeenCalledTimes(2);
    expect(toast.show).toHaveBeenCalledWith(
      'Could not update the active waypoint. Check the connection.',
    );
    warn.mockRestore();
  });

  it('discards an older course hydration that resolves after a newer one', async () => {
    const older = deferred<Awaited<ReturnType<typeof courseClient.hydrateCourse>>>();
    const newer = deferred<Awaited<ReturnType<typeof courseClient.hydrateCourse>>>();
    vi.mocked(courseClient.hydrateCourse)
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);
    vi.mocked(courseClient.activationFromCourse).mockImplementation((info) => ({
      routeId: info?.activeRoute?.href?.split('/').at(-1),
    }));
    const { controller, routeStore, guidance } = makeController();

    const first = controller.hydrateAndSeedCourse();
    const second = controller.hydrateAndSeedCourse();
    newer.resolve({
      info: { activeRoute: { href: '/resources/routes/new', pointIndex: 0, pointTotal: 2 } },
    });
    await second;
    older.resolve({
      info: { activeRoute: { href: '/resources/routes/old', pointIndex: 0, pointTotal: 2 } },
    });
    await first;

    expect(routeStore.activeId).toBe('new');
    expect(guidance.seed).toHaveBeenCalledTimes(1);
    expect(guidance.seed).toHaveBeenCalledWith(
      expect.objectContaining({
        activeRoute: expect.objectContaining({ href: expect.stringMatching(/new$/) }),
      }),
      undefined,
      expect.any(Number),
    );
  });

  it('does not double-advance when the server already advanced on arrival', async () => {
    const { controller } = makeController();
    vi.mocked(courseClient.hydrateCourse).mockResolvedValueOnce({
      info: {
        activeRoute: { href: '/resources/routes/r1', pointIndex: 1, pointTotal: 3 },
      },
    });

    controller.onArrivalAdvance({
      href: '/resources/routes/r1',
      pointIndex: 0,
      pointTotal: 3,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(courseClient.setActiveRoutePointIndex).not.toHaveBeenCalled();
  });

  it('writes the captured absolute target when the server has not advanced', async () => {
    const { controller } = makeController();
    const activeRoute = { href: '/resources/routes/r1', pointIndex: 0, pointTotal: 3 };
    vi.mocked(courseClient.hydrateCourse)
      .mockResolvedValueOnce({ info: { activeRoute } })
      .mockResolvedValueOnce({
        info: { activeRoute: { ...activeRoute, pointIndex: 1 } },
      });

    controller.onArrivalAdvance(activeRoute);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(courseClient.setActiveRoutePointIndex).toHaveBeenCalledWith(
      'http://sk',
      'token',
      activeRoute,
      1,
    );
  });

  it('increments the traversal index on a reversed route', async () => {
    const { controller } = makeController();
    const activeRoute = {
      href: '/resources/routes/r1',
      pointIndex: 0,
      pointTotal: 3,
      reverse: true,
    };
    vi.mocked(courseClient.hydrateCourse)
      .mockResolvedValueOnce({ info: { activeRoute } })
      .mockResolvedValueOnce({
        info: { activeRoute: { ...activeRoute, pointIndex: 1 } },
      });

    controller.onArrivalAdvance(activeRoute);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(courseClient.setActiveRoutePointIndex).toHaveBeenCalledWith(
      'http://sk',
      'token',
      activeRoute,
      1,
    );
  });

  it('cancels pending arrival auto-advance when the navigator skips manually', async () => {
    const releaseArrival = deferred<void>();
    const { controller } = makeController(false, () => releaseArrival.promise);
    vi.mocked(courseClient.advancePoint).mockResolvedValue(true);
    controller.onArrivalAdvance({
      href: '/resources/routes/r1',
      pointIndex: 0,
      pointTotal: 3,
    });
    await Promise.resolve();

    controller.onSkipPoint(1);
    releaseArrival.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(courseClient.setActiveRoutePointIndex).not.toHaveBeenCalled();
    expect(courseClient.advancePoint).toHaveBeenCalledOnce();
  });

  it('fits the full route bounds when showing a route', () => {
    const { controller, routeStore, fitBounds } = makeController();
    routeStore.setRoutes([route]);
    controller.showRoute('r1');
    expect(fitBounds).toHaveBeenCalledWith([-83, 42, -82, 43]);
  });

  it('pans once to the first imported route', async () => {
    const { controller, routeStore, flyTo } = makeController();
    echoStoreOnRefresh(routeStore);

    await controller.onImportRouteGpx(
      `<gpx>${gpxRoute('First', 42, -83)}${gpxRoute('Second', 50, -70)}</gpx>`,
    );

    expect(routeStore.routes).toHaveLength(2);
    expect(routeStore.shownIds.size).toBe(2);
    expect(flyTo).toHaveBeenCalledOnce();
    expect(flyTo).toHaveBeenCalledWith(42, -83);
  });

  it('names tracks as the reason a GPX file imported no routes', async () => {
    const { controller, toast } = makeController();

    await controller.onImportRouteGpx(
      '<gpx><trk><name>Yesterday</name><trkseg><trkpt lat="42" lon="-83"/></trkseg></trk></gpx>',
    );

    expect(toast.show).toHaveBeenCalledWith(
      'That GPX file holds tracks, not routes. Binnacle imports routes only.',
    );
  });

  it('pans to the reversed route start, the far end of the original', async () => {
    const { controller, routeStore, flyTo } = makeController();
    routeStore.setRoutes([route]);
    echoStoreOnRefresh(routeStore);

    await controller.onReverseRoute('r1');

    expect(flyTo).toHaveBeenCalledWith(43, -82);
  });

  it('reports whether a route save was accepted', async () => {
    const { controller, routeStore } = makeController();
    routeStore.setWorking(route);
    vi.mocked(routesClient.saveRoute).mockResolvedValueOnce('failed');

    expect(await controller.onSaveRoute('Passage')).toBe(false);
    expect(routeStore.working).toEqual(route);
    expect(await controller.onSaveRoute('Passage')).toBe(true);
    expect(routeStore.working).toBeUndefined();
  });

  it('reports load failure without turning it into a real empty result', async () => {
    const { controller, toast } = makeController();
    vi.mocked(routesClient.fetchRoutes).mockResolvedValue(undefined);
    await controller.refreshRoutes();
    expect(controller.loadState).toBe('error');
    expect(toast.show).not.toHaveBeenCalled();
  });

  it('blocks chart-side route creation without write access', () => {
    const { controller, routeStore, toast } = makeController(true);
    controller.beginNewRoute({ latitude: 42, longitude: -83 });
    expect(routeStore.working).toBeUndefined();
    expect(toast.show).toHaveBeenCalledWith(
      'Read-only access: the route was not created. Request read and write access to continue.',
    );
  });

  it('blocks new and existing route editing while another chart tool owns gestures', () => {
    const reason = 'Finish the measurement before editing a route.';
    const { controller, routeStore, toast, startRouteEdit } = makeController(
      false,
      async () => {},
      () => reason,
    );
    routeStore.setRoutes([route]);

    controller.beginNewRoute({ latitude: 42, longitude: -83 });
    controller.onEditRoute('r1');

    expect(routeStore.working).toBeUndefined();
    expect(startRouteEdit).not.toHaveBeenCalled();
    expect(toast.show).toHaveBeenCalledTimes(2);
    expect(toast.show).toHaveBeenNthCalledWith(1, reason);
    expect(toast.show).toHaveBeenNthCalledWith(2, reason);
  });

  describe('goto destinations', () => {
    const waypoint = {
      id: 'b7a1f0e2-3c4d-4a5b-8c6d-7e8f9a0b1c2d',
      name: 'Harbor entrance',
      position: { latitude: 44.1, longitude: -86.5 },
    };
    const href = `/resources/waypoints/${waypoint.id}`;

    it('sends a bare position for a chart-tap destination', async () => {
      const { controller } = makeController();
      vi.mocked(courseClient.setDestination).mockResolvedValue(true);

      await controller.onGoToHere({ latitude: 42, longitude: -83 });

      expect(courseClient.setDestination).toHaveBeenCalledExactlyOnceWith('http://sk', 'token', {
        position: { latitude: 42, longitude: -83 },
      });
      expect(controller.gotoActive).toBe(true);
    });

    it('navigates to a saved waypoint by resource href so the server publishes its name', async () => {
      const { controller, routeStore } = makeController();
      routeStore.setRoutes([route]);
      routeStore.setActive('r1');
      vi.mocked(courseClient.setDestination).mockResolvedValue(true);

      await controller.onGoToWaypoint(waypoint);

      expect(courseClient.setDestination).toHaveBeenCalledExactlyOnceWith('http://sk', 'token', {
        href,
      });
      expect(routeStore.activeId).toBeUndefined();
      expect(controller.gotoActive).toBe(true);
      expect(courseClient.hydrateCourse).toHaveBeenCalled();
    });

    it('retries with the position only after the href destination is rejected', async () => {
      const { controller, toast } = makeController();
      vi.mocked(courseClient.setDestination)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      await controller.onGoToWaypoint(waypoint);

      expect(vi.mocked(courseClient.setDestination).mock.calls.map((call) => call[2])).toEqual([
        { href },
        { position: waypoint.position },
      ]);
      expect(controller.gotoActive).toBe(true);
      expect(toast.show).not.toHaveBeenCalled();
    });

    it('flags the destination error when both the href and the position are rejected', async () => {
      const { controller, toast } = makeController();
      vi.mocked(courseClient.setDestination).mockResolvedValue(false);

      await controller.onGoToWaypoint(waypoint);

      expect(courseClient.setDestination).toHaveBeenCalledTimes(2);
      expect(controller.gotoActive).toBe(false);
      expect(toast.show).toHaveBeenCalledWith(
        'Could not set the destination. Check the connection.',
      );
    });

    it('blocks waypoint navigation without write access', async () => {
      const { controller, toast } = makeController(true);

      await controller.onGoToWaypoint(waypoint);

      expect(courseClient.setDestination).not.toHaveBeenCalled();
      expect(toast.show).toHaveBeenCalledWith(
        'Read-only access: navigation was not started. Request read and write access to continue.',
      );
    });
  });

  it('refuses to start a new route over one already under edit', () => {
    const { controller, routeStore, startRouteEdit, toast } = makeController();
    controller.beginNewRoute();
    expect(routeStore.working).toBeDefined();
    const underEdit = routeStore.working;
    startRouteEdit.mockClear();

    controller.beginNewRoute();
    expect(routeStore.working).toBe(underEdit);
    expect(startRouteEdit).not.toHaveBeenCalled();
    expect(toast.show).toHaveBeenCalledWith(
      'Save or cancel the route under edit before starting a new one.',
    );
  });
});
