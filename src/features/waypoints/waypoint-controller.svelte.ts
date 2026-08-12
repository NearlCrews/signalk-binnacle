import {
  cleanWaypointIcon,
  cleanWaypointName,
  type Waypoint,
  type WaypointsStore,
} from '$entities/waypoint';
import { isLatLon, type LatLon } from '$shared/geo';
import { createBusyGate, type Toast, uuidv4 } from '$shared/lib';
import { createWriteOutcomeGate, deleteRefusedMessage, writeRefusedMessage } from '$shared/signalk';
import {
  deleteWaypoint,
  fetchWaypoints,
  fetchWaypointsProvisioned,
  saveWaypoint,
} from './waypoints-client';

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
// Whether the server has a waypoints resource provider at all: 'unknown' until the probe answers,
// then sticky through transient outages so the admin-path note never flashes at a healthy server.
export type WaypointsProvisioning = 'unknown' | 'provisioned' | 'unprovisioned';

export function createWaypointsController(deps: WaypointControllerDeps) {
  // One place to turn a write outcome into a toast and, when the server refused, into a fresh
  // access request. The dialog and its entered values stay put on any failure; only the
  // explanation and the recovery differ.
  const accepted = createWriteOutcomeGate({
    report: (message) => deps.toast.show(message),
    requestWriteAccess: () => deps.requestWriteAccess(),
  });

  const { origin, waypointsStore } = deps;

  let addWaypointAt = $state<LatLon | undefined>();
  let editingWaypoint = $state<Waypoint | undefined>();
  let loadState = $state<WaypointLoadState>('idle');
  let provisioning = $state<WaypointsProvisioning>('unknown');
  let busy = $state(false);
  let refreshGeneration = 0;
  // Every mutating action is serialized against one busy flag, so a second tap while a write is in
  // flight is dropped rather than racing it. The synchronous guards below (drop, open-edit, cancel)
  // read the same flag without owning it.
  const withBusy = createBusyGate(
    () => busy,
    (next) => {
      busy = next;
    },
  );

  async function refreshWaypoints(): Promise<void> {
    const generation = ++refreshGeneration;
    loadState = 'loading';
    const token = deps.getToken();
    const [fetched, provisioned] = await Promise.all([
      fetchWaypoints(origin, token),
      fetchWaypointsProvisioned(origin, token),
    ]);
    if (generation !== refreshGeneration) return;
    // An unanswered probe keeps the last known value (the tracks pattern): a transient outage
    // must not flash the no-waypoint-storage note at a server that has a provider.
    if (provisioned !== undefined) provisioning = provisioned ? 'provisioned' : 'unprovisioned';
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
      deps.toast.show(
        'Read-only access: the waypoint was not added. Request read and write access to save it.',
      );
      return;
    }
    addWaypointAt = position;
  }

  // Resolves to the saved waypoint so a caller can chain an action on the new mark (save and
  // navigate), or undefined when nothing was saved.
  async function confirmAddWaypoint(result: {
    name: string;
    icon?: string;
  }): Promise<Waypoint | undefined> {
    if (deps.writeBlocked()) {
      deps.toast.show(
        'Read-only access: the waypoint was not added. Request read and write access to save it.',
      );
      return undefined;
    }
    const position = addWaypointAt;
    if (!position || !isLatLon(position)) return undefined;
    const icon = cleanWaypointIcon(result.icon);
    const waypoint: Waypoint = {
      id: uuidv4(),
      name: cleanWaypointName(result.name, 'Waypoint'),
      position,
      ...(icon ? { icon } : {}),
    };
    refreshGeneration += 1;
    const saved = await saveWaypoint(origin, deps.getToken(), waypoint);
    if (
      !accepted(
        saved,
        writeRefusedMessage('waypoint'),
        'Could not save the waypoint. Check the connection and write access.',
      )
    ) {
      return undefined;
    }
    waypointsStore.upsertWaypoint(waypoint);
    loadState = 'ready';
    // A write the server accepted is direct proof a waypoints provider is registered.
    provisioning = 'provisioned';
    addWaypointAt = undefined;
    await refreshWaypoints();
    return waypoint;
  }

  function onOpenEditWaypoint(waypoint: Waypoint): void {
    if (busy || deps.writeBlocked()) return;
    editingWaypoint = waypoint;
  }

  async function onSaveWaypointEdit(result: { name: string; icon?: string }): Promise<void> {
    if (deps.writeBlocked()) {
      deps.toast.show(
        'Read-only access: the waypoint was not changed. Request read and write access to edit it.',
      );
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
    refreshGeneration += 1;
    const saved = await saveWaypoint(origin, deps.getToken(), updated);
    if (
      !accepted(
        saved,
        writeRefusedMessage('waypoint'),
        'Could not save the waypoint. Check the connection and write access.',
      )
    ) {
      return;
    }
    waypointsStore.upsertWaypoint(updated);
    loadState = 'ready';
    provisioning = 'provisioned';
    editingWaypoint = undefined;
    await refreshWaypoints();
  }

  async function onDeleteWaypoint(id: string): Promise<void> {
    if (deps.writeBlocked()) {
      deps.toast.show(
        'Read-only access: the waypoint was not deleted. Request read and write access to delete it.',
      );
      return;
    }
    refreshGeneration += 1;
    const deleted = await deleteWaypoint(origin, deps.getToken(), id);
    if (
      !accepted(
        deleted,
        deleteRefusedMessage(),
        'Could not delete the waypoint. Check the connection and write access.',
      )
    ) {
      return;
    }
    waypointsStore.removeWaypoint(id);
    loadState = 'ready';
    await refreshWaypoints();
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
    confirmAddWaypoint: withBusy(confirmAddWaypoint),
    cancelAddWaypoint,
    onOpenEditWaypoint,
    onSaveWaypointEdit: withBusy(onSaveWaypointEdit),
    cancelEditWaypoint,
    onDeleteWaypoint: withBusy(onDeleteWaypoint),
    get addWaypointAt() {
      return addWaypointAt;
    },
    get editingWaypoint() {
      return editingWaypoint;
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
