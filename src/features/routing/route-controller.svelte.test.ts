import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CourseGuidance } from '$entities/course';
import { RouteStore } from '$entities/route';
import type { Toast } from '$shared/lib';
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
  setDestination: vi.fn(),
}));

vi.mock('./routes-client', () => ({
  deleteRoute: vi.fn(),
  fetchRoutes: vi.fn(),
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

function makeController(writeBlocked = false) {
  const routeStore = new RouteStore();
  const toast = { show: vi.fn() } as unknown as Toast;
  const guidance = {
    active: false,
    seed: vi.fn(),
    clear: vi.fn(),
  } as unknown as CourseGuidance;
  const fitBounds = vi.fn();
  const controller = createRouteController({
    origin: 'http://sk',
    getToken: () => 'token',
    writeBlocked: () => writeBlocked,
    routeStore,
    courseGuidance: guidance,
    toast,
    flyTo: vi.fn(),
    fitBounds,
    startRouteEdit: vi.fn(() => true),
    stopRouteEdit: vi.fn(),
    getTrackPoints: () => [],
  });
  return { controller, routeStore, toast, guidance, fitBounds };
}

describe('createRouteController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(routesClient.fetchRoutes).mockResolvedValue([]);
    vi.mocked(routesClient.saveRoute).mockResolvedValue(true);
    vi.mocked(courseClient.refreshActiveRoute).mockResolvedValue(true);
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
    let resolveSave = (_value: boolean): void => {};
    vi.mocked(routesClient.saveRoute).mockImplementation(
      () => new Promise((resolve) => (resolveSave = resolve)),
    );
    const first = controller.onSaveRoute('Passage');
    const second = controller.onSaveRoute('Passage');
    expect(controller.busy).toBe(true);
    expect(routesClient.saveRoute).toHaveBeenCalledTimes(1);
    resolveSave(true);
    await Promise.all([first, second]);
    expect(controller.busy).toBe(false);
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

  it('fits the full route bounds when showing a route', () => {
    const { controller, routeStore, fitBounds } = makeController();
    routeStore.setRoutes([route]);
    controller.showRoute('r1');
    expect(fitBounds).toHaveBeenCalledWith([-83, 42, -82, 43]);
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
    expect(toast.show).toHaveBeenCalledWith('A write token is needed to create routes.');
  });
});
