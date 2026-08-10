import { createRetryableLazyUiLoader } from '$shared/lib';

export {
  activateRoute,
  activationFromCourse,
  advancePoint,
  clearCourse,
  hydrateCourse,
  setActiveRoutePointIndex,
  setDestination,
} from './course-client';
export { parseGpxRoutes } from './gpx-import';
export { createRouteController, type RouteLoadState } from './route-controller.svelte';
export { fetchRoutes } from './routes-client';

const routesPanelLoader = createRetryableLazyUiLoader(() => import('./RoutesPanel.svelte'), {
  timeoutMessage: 'Routes controls took too long to load.',
});

export function loadRoutesPanel(): Promise<typeof import('./RoutesPanel.svelte')> {
  return routesPanelLoader();
}
