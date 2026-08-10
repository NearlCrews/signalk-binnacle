import { createRetryableLazyUiLoader } from '$shared/lib';

export { default as WaypointDialog } from './WaypointDialog.svelte';
export {
  createWaypointsController,
  type WaypointLoadState,
} from './waypoint-controller.svelte';
export { createWaypointOverlay } from './waypoint-overlay';

const waypointsPanelLoader = createRetryableLazyUiLoader(() => import('./WaypointsPanel.svelte'), {
  timeoutMessage: 'Waypoints controls took too long to load.',
});

export function loadWaypointsPanel(): Promise<typeof import('./WaypointsPanel.svelte')> {
  return waypointsPanelLoader();
}
