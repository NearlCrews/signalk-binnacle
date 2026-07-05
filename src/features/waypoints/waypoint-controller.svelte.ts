import type { Waypoint, WaypointsStore } from '$entities/waypoint';
import type { LatLon } from '$shared/geo';
import { uuidv4 } from '$shared/lib';
import { deleteWaypoint, fetchWaypoints, saveWaypoint } from './waypoints-client';

export interface WaypointControllerDeps {
  origin: string;
  getToken: () => string | undefined;
  waypointsStore: WaypointsStore;
}

export function createWaypointsController(deps: WaypointControllerDeps) {
  const { origin, waypointsStore } = deps;

  let waypointError = $state<string | undefined>();
  let addWaypointAt = $state<LatLon | undefined>();
  let editingWaypoint = $state<Waypoint | undefined>();

  function getToken(): string | undefined {
    return deps.getToken();
  }

  async function refreshWaypoints(): Promise<void> {
    const fetched = await fetchWaypoints(origin, getToken());
    if (fetched) {
      waypointsStore.setWaypoints(fetched);
      return;
    }
    if (waypointsStore.waypoints.length === 0) {
      waypointError = 'Could not load waypoints. Check the connection.';
    }
  }

  function onDropWaypoint(position: LatLon): void {
    waypointError = undefined;
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
    if (!(await saveWaypoint(origin, getToken(), waypoint))) {
      waypointError = 'Could not save the waypoint. Check the connection and write access.';
      return;
    }
    await refreshWaypoints();
  }

  function onOpenEditWaypoint(waypoint: Waypoint): void {
    waypointError = undefined;
    editingWaypoint = waypoint;
  }

  async function onSaveWaypointEdit(result: { name: string; icon?: string }): Promise<void> {
    const existing = editingWaypoint;
    editingWaypoint = undefined;
    if (!existing) return;
    waypointError = undefined;
    const updated: Waypoint = { ...existing, name: result.name, icon: result.icon };
    if (!(await saveWaypoint(origin, getToken(), updated))) {
      waypointError = 'Could not save the waypoint. Check the connection and write access.';
      return;
    }
    await refreshWaypoints();
  }

  async function onDeleteWaypoint(id: string): Promise<void> {
    waypointError = undefined;
    if (!(await deleteWaypoint(origin, getToken(), id))) {
      waypointError = 'Could not delete the waypoint.';
      return;
    }
    await refreshWaypoints();
  }

  return {
    refreshWaypoints,
    onDropWaypoint,
    confirmAddWaypoint,
    onOpenEditWaypoint,
    onSaveWaypointEdit,
    onDeleteWaypoint,
    get waypointError() {
      return waypointError;
    },
    get addWaypointAt() {
      return addWaypointAt;
    },
    get editingWaypoint() {
      return editingWaypoint;
    },
  };
}
