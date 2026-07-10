import type { Waypoint, WaypointsStore } from '$entities/waypoint';
import type { LatLon } from '$shared/geo';
import { type Toast, uuidv4 } from '$shared/lib';
import { deleteWaypoint, fetchWaypoints, saveWaypoint } from './waypoints-client';

export interface WaypointControllerDeps {
  origin: string;
  getToken: () => string | undefined;
  waypointsStore: WaypointsStore;
  // A load, save, or delete failure surfaces here instead of a panel-local error, so it is visible
  // even when the panel that triggered the action (or no panel at all, for a chart-dropped
  // waypoint) is not open to show it.
  toast: Toast;
}

export function createWaypointsController(deps: WaypointControllerDeps) {
  const { origin, waypointsStore } = deps;

  let addWaypointAt = $state<LatLon | undefined>();
  let editingWaypoint = $state<Waypoint | undefined>();

  async function refreshWaypoints(): Promise<void> {
    const fetched = await fetchWaypoints(origin, deps.getToken());
    if (fetched) {
      waypointsStore.setWaypoints(fetched);
      return;
    }
    if (waypointsStore.waypoints.length === 0) {
      deps.toast.show('Could not load waypoints. Check the connection.');
    }
  }

  function onDropWaypoint(position: LatLon): void {
    addWaypointAt = position;
  }

  async function confirmAddWaypoint(result: { name: string; icon?: string }): Promise<void> {
    const position = addWaypointAt;
    addWaypointAt = undefined;
    if (!position) return;
    const waypoint: Waypoint = {
      id: uuidv4(),
      name: result.name,
      position,
      ...(result.icon ? { icon: result.icon } : {}),
    };
    if (!(await saveWaypoint(origin, deps.getToken(), waypoint))) {
      deps.toast.show('Could not save the waypoint. Check the connection and write access.');
      return;
    }
    await refreshWaypoints();
  }

  function onOpenEditWaypoint(waypoint: Waypoint): void {
    editingWaypoint = waypoint;
  }

  async function onSaveWaypointEdit(result: { name: string; icon?: string }): Promise<void> {
    const existing = editingWaypoint;
    editingWaypoint = undefined;
    if (!existing) return;
    const updated: Waypoint = { ...existing, name: result.name, icon: result.icon };
    if (!(await saveWaypoint(origin, deps.getToken(), updated))) {
      deps.toast.show('Could not save the waypoint. Check the connection and write access.');
      return;
    }
    await refreshWaypoints();
  }

  async function onDeleteWaypoint(id: string): Promise<void> {
    if (!(await deleteWaypoint(origin, deps.getToken(), id))) {
      deps.toast.show('Could not delete the waypoint.');
      return;
    }
    await refreshWaypoints();
  }

  // The dialogs render while these states are set, so Cancel must clear them here: the
  // composition root has no other way to dismiss them.
  function cancelAddWaypoint(): void {
    addWaypointAt = undefined;
  }

  function cancelEditWaypoint(): void {
    editingWaypoint = undefined;
  }

  return {
    refreshWaypoints,
    onDropWaypoint,
    confirmAddWaypoint,
    cancelAddWaypoint,
    onOpenEditWaypoint,
    onSaveWaypointEdit,
    cancelEditWaypoint,
    onDeleteWaypoint,
    get addWaypointAt() {
      return addWaypointAt;
    },
    get editingWaypoint() {
      return editingWaypoint;
    },
  };
}
