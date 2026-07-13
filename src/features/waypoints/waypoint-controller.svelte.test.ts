import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type Waypoint, WaypointsStore } from '$entities/waypoint';
import type { Toast } from '$shared/lib';
import { createWaypointsController } from './waypoint-controller.svelte';
import * as waypointsClient from './waypoints-client';

vi.mock('./waypoints-client', () => ({
  deleteWaypoint: vi.fn(),
  fetchWaypoints: vi.fn(),
  saveWaypoint: vi.fn(),
}));

const waypoint = (id: string, name = id): Waypoint => ({
  id,
  name,
  position: { latitude: 44, longitude: -86 },
});

function makeController(writeBlocked = false) {
  const waypointsStore = new WaypointsStore();
  const toast = { show: vi.fn() } as unknown as Toast;
  const controller = createWaypointsController({
    origin: 'http://sk',
    getToken: () => 'token',
    writeBlocked: () => writeBlocked,
    waypointsStore,
    toast,
  });
  return { controller, waypointsStore, toast };
}

describe('createWaypointsController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(waypointsClient.fetchWaypoints).mockResolvedValue([]);
    vi.mocked(waypointsClient.saveWaypoint).mockResolvedValue(true);
    vi.mocked(waypointsClient.deleteWaypoint).mockResolvedValue(true);
  });

  it('does not let an older refresh overwrite a newer response', async () => {
    const { controller, waypointsStore } = makeController();
    let resolveFirst!: (waypoints: Waypoint[]) => void;
    vi.mocked(waypointsClient.fetchWaypoints)
      .mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
      .mockResolvedValueOnce([waypoint('new')]);
    const first = controller.refreshWaypoints();
    await controller.refreshWaypoints();
    resolveFirst([waypoint('old')]);
    await first;
    expect(waypointsStore.waypoints.map((item) => item.id)).toEqual(['new']);
  });

  it('keeps the add dialog and input available after a failed save', async () => {
    const { controller } = makeController();
    vi.mocked(waypointsClient.saveWaypoint).mockResolvedValue(false);
    controller.onDropWaypoint({ latitude: 44, longitude: -86 });
    await controller.confirmAddWaypoint({ name: 'Harbor' });
    expect(controller.addWaypointAt).toEqual({ latitude: 44, longitude: -86 });
    expect(controller.busy).toBe(false);
  });

  it('explains blocked chart drops without opening a dialog', () => {
    const { controller, toast } = makeController(true);
    controller.onDropWaypoint({ latitude: 44, longitude: -86 });
    expect(controller.addWaypointAt).toBeUndefined();
    expect(toast.show).toHaveBeenCalledWith('A write token is needed to add a waypoint.');
  });

  it('keeps an accepted add locally when the follow-up refresh fails', async () => {
    const { controller, waypointsStore } = makeController();
    vi.mocked(waypointsClient.fetchWaypoints).mockResolvedValue(undefined);
    controller.onDropWaypoint({ latitude: 44, longitude: -86 });
    await controller.confirmAddWaypoint({ name: '  Harbor  ' });
    expect(waypointsStore.waypoints).toHaveLength(1);
    expect(waypointsStore.waypoints[0].name).toBe('Harbor');
    expect(controller.addWaypointAt).toBeUndefined();
    expect(controller.loadState).toBe('error');
  });

  it('keeps the edit dialog open after a failed edit', async () => {
    const { controller } = makeController();
    vi.mocked(waypointsClient.saveWaypoint).mockResolvedValue(false);
    controller.onOpenEditWaypoint(waypoint('a', 'Old'));
    await controller.onSaveWaypointEdit({ name: 'New' });
    expect(controller.editingWaypoint?.name).toBe('Old');
  });

  it('blocks overlapping writes', async () => {
    const { controller } = makeController();
    let resolveSave!: (ok: boolean) => void;
    vi.mocked(waypointsClient.saveWaypoint).mockImplementationOnce(
      () => new Promise((resolve) => (resolveSave = resolve)),
    );
    controller.onDropWaypoint({ latitude: 44, longitude: -86 });
    const first = controller.confirmAddWaypoint({ name: 'One' });
    const second = controller.confirmAddWaypoint({ name: 'Two' });
    expect(waypointsClient.saveWaypoint).toHaveBeenCalledOnce();
    resolveSave(true);
    await Promise.all([first, second]);
  });

  it('removes an accepted delete before a failed refresh', async () => {
    const { controller, waypointsStore } = makeController();
    vi.mocked(waypointsClient.fetchWaypoints)
      .mockResolvedValueOnce([waypoint('a')])
      .mockResolvedValueOnce(undefined);
    await controller.refreshWaypoints();
    await controller.onDeleteWaypoint('a');
    expect(waypointsStore.waypoints).toEqual([]);
  });
});
