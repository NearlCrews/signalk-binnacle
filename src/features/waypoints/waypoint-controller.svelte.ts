import {
  cleanWaypointIcon,
  cleanWaypointName,
  type Waypoint,
  type WaypointsStore,
} from '$entities/waypoint';
import { isLatLon, type LatLon } from '$shared/geo';
import { type Toast, uuidv4 } from '$shared/lib';
import { writeRefusedMessage } from '$shared/signalk';
import { deleteWaypoint, fetchWaypoints, saveWaypoint } from './waypoints-client';

export interface WaypointControllerDeps {
  origin: string;
  getToken: () => string | undefined;
  writeBlocked: () => boolean;
  // Ask the server for read/write access again after it refuses a write mid-session (a revoked
  // token, an expired session). The dialog and its entered values stay put while it is outstanding.
  requestWriteAccess: () => Promise<void>;
  waypointsStore: WaypointsStore;
  // A load, save, or delete failure surfaces here instead of a panel-local error, so it is visible
  // even when the panel that triggered the action (or no panel at all, for a chart-dropped
  // waypoint) is not open to show it.
  toast: Toast;
}

export type WaypointLoadState = 'idle' | 'loading' | 'ready' | 'error';

export function createWaypointsController(deps: WaypointControllerDeps) {
  const { origin, waypointsStore } = deps;

  let addWaypointAt = $state<LatLon | undefined>();
  let editingWaypoint = $state<Waypoint | undefined>();
  let loadState = $state<WaypointLoadState>('idle');
  let busy = $state(false);
  let refreshGeneration = 0;

  async function refreshWaypoints(): Promise<void> {
    const generation = ++refreshGeneration;
    loadState = 'loading';
    const fetched = await fetchWaypoints(origin, deps.getToken());
    if (generation !== refreshGeneration) return;
    if (fetched) {
      waypointsStore.setWaypoints(fetched);
      loadState = 'ready';
      return;
    }
    loadState = 'error';
  }

  function onDropWaypoint(position: LatLon): void {
    if (busy || !isLatLon(position)) return;
    if (deps.writeBlocked()) {
      deps.toast.show('A write token is needed to add a waypoint.');
      return;
    }
    addWaypointAt = position;
  }

  async function confirmAddWaypoint(result: { name: string; icon?: string }): Promise<void> {
    if (busy) return;
    if (deps.writeBlocked()) {
      deps.toast.show('A write token is needed to add a waypoint.');
      return;
    }
    const position = addWaypointAt;
    if (!position || !isLatLon(position)) return;
    const icon = cleanWaypointIcon(result.icon);
    const waypoint: Waypoint = {
      id: uuidv4(),
      name: cleanWaypointName(result.name, 'Waypoint'),
      position,
      ...(icon ? { icon } : {}),
    };
    busy = true;
    refreshGeneration += 1;
    try {
      const saved = await saveWaypoint(origin, deps.getToken(), waypoint);
      if (saved !== 'ok') {
        // The dialog and its entered values stay put either way; only the explanation and the
        // recovery differ. A refusal is recoverable without retyping.
        if (saved === 'access-denied') {
          deps.toast.show(writeRefusedMessage('waypoint'));
          void deps.requestWriteAccess();
        } else {
          deps.toast.show('Could not save the waypoint. Check the connection and write access.');
        }
        return;
      }
      waypointsStore.upsertWaypoint(waypoint);
      loadState = 'ready';
      addWaypointAt = undefined;
      await refreshWaypoints();
    } finally {
      busy = false;
    }
  }

  function onOpenEditWaypoint(waypoint: Waypoint): void {
    if (busy || deps.writeBlocked()) return;
    editingWaypoint = waypoint;
  }

  async function onSaveWaypointEdit(result: { name: string; icon?: string }): Promise<void> {
    if (busy) return;
    if (deps.writeBlocked()) {
      deps.toast.show('A write token is needed to edit a waypoint.');
      return;
    }
    const existing = editingWaypoint;
    if (!existing) return;
    const icon = cleanWaypointIcon(result.icon);
    const updated: Waypoint = {
      ...existing,
      name: cleanWaypointName(result.name, existing.name),
      ...(icon ? { icon } : { icon: undefined }),
    };
    busy = true;
    refreshGeneration += 1;
    try {
      const saved = await saveWaypoint(origin, deps.getToken(), updated);
      if (saved !== 'ok') {
        if (saved === 'access-denied') {
          deps.toast.show(writeRefusedMessage('waypoint'));
          void deps.requestWriteAccess();
        } else {
          deps.toast.show('Could not save the waypoint. Check the connection and write access.');
        }
        return;
      }
      waypointsStore.upsertWaypoint(updated);
      loadState = 'ready';
      editingWaypoint = undefined;
      await refreshWaypoints();
    } finally {
      busy = false;
    }
  }

  async function onDeleteWaypoint(id: string): Promise<void> {
    if (busy) return;
    if (deps.writeBlocked()) {
      deps.toast.show('A write token is needed to delete a waypoint.');
      return;
    }
    busy = true;
    refreshGeneration += 1;
    try {
      const deleted = await deleteWaypoint(origin, deps.getToken(), id);
      if (deleted !== 'ok') {
        if (deleted === 'access-denied') {
          deps.toast.show('Signal K refused the delete. Read/write access is being requested.');
          void deps.requestWriteAccess();
        } else {
          deps.toast.show('Could not delete the waypoint. Check the connection and write access.');
        }
        return;
      }
      waypointsStore.removeWaypoint(id);
      loadState = 'ready';
      await refreshWaypoints();
    } finally {
      busy = false;
    }
  }

  // The dialogs render while these states are set, so Cancel must clear them here: the
  // composition root has no other way to dismiss them.
  function cancelAddWaypoint(): void {
    if (busy) return;
    addWaypointAt = undefined;
  }

  function cancelEditWaypoint(): void {
    if (busy) return;
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
    get loadState() {
      return loadState;
    },
    get busy() {
      return busy;
    },
  };
}
