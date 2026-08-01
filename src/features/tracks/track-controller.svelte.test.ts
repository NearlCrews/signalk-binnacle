import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackPoint } from '$entities/track';
import type { Toast } from '$shared/lib';
import type { ResourceMutationResult } from '$shared/signalk';
import { createTrackController } from './track-controller.svelte';
import * as tracksClient from './tracks-client';

vi.mock('./tracks-client', () => ({
  deleteTrack: vi.fn(),
  fetchSavedTracks: vi.fn(),
  fetchTracksProvisioned: vi.fn(),
  saveTrack: vi.fn(),
  savedTrackFromPoints: vi.fn((id: string, name: string, points: TrackPoint[]) => ({
    id,
    name,
    points: [points],
    distanceMeters: 10,
    durationSeconds: 10,
  })),
  savedTracksToFeatures: vi.fn(() => ({ type: 'FeatureCollection', features: [] })),
}));

const points: TrackPoint[] = [
  { lat: 1, lon: 1, t: 0, sog: 1 },
  { lat: 1.001, lon: 1, t: 10_000, sog: 1 },
];

function makeController() {
  const clearRecorderThrough = vi.fn();
  const toast = { show: vi.fn() } as unknown as Toast;
  const requestWriteAccess = vi.fn(async () => {});
  const controller = createTrackController({
    origin: 'http://sk',
    getToken: () => 'token',
    requestWriteAccess,
    getRecorderPoints: () => points,
    clearRecorderThrough,
    toast,
  });
  return { controller, clearRecorderThrough, toast, requestWriteAccess };
}

describe('createTrackController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(tracksClient.fetchSavedTracks).mockResolvedValue([]);
    vi.mocked(tracksClient.fetchTracksProvisioned).mockResolvedValue(true);
    vi.mocked(tracksClient.saveTrack).mockResolvedValue('ok');
    vi.mocked(tracksClient.deleteTrack).mockResolvedValue('ok');
  });

  it('does not let an older refresh overwrite a newer response', async () => {
    const { controller } = makeController();
    let resolveFirst!: (tracks: tracksClient.SavedTrack[]) => void;
    vi.mocked(tracksClient.fetchSavedTracks)
      .mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
      .mockResolvedValueOnce([{ id: 'new', name: 'New', points: [points] }]);
    const first = controller.refreshSavedTracks();
    await controller.refreshSavedTracks();
    resolveFirst([{ id: 'old', name: 'Old', points: [points] }]);
    await first;
    expect(controller.savedTracks.map((track) => track.id)).toEqual(['new']);
  });

  it('keeps a successful save locally when the follow-up refresh fails', async () => {
    const { controller, clearRecorderThrough, toast } = makeController();
    vi.mocked(tracksClient.fetchSavedTracks).mockResolvedValue(undefined);
    await controller.onSaveTrack('Passage');
    expect(clearRecorderThrough).toHaveBeenCalledWith(10_000);
    expect(controller.savedTracks).toHaveLength(1);
    expect(controller.savedTracks[0].name).toBe('Passage');
    expect(controller.shownSaved.has(controller.savedTracks[0].id)).toBe(true);
    expect(controller.loadState).toBe('error');
    expect(toast.show).not.toHaveBeenCalled();
  });

  it('widens the save-failure copy while provisioning is unconfirmed', async () => {
    // On a server whose probe route never answered, a missing tracks provider is as likely as a
    // connection problem, so the toast must not point at only the wrong causes.
    const { controller, toast } = makeController();
    vi.mocked(tracksClient.saveTrack).mockResolvedValue('failed');
    await controller.onSaveTrack('Passage');
    expect(toast.show).toHaveBeenCalledWith(
      'Could not save the track. Check the connection and access, and whether this server has track storage.',
    );

    vi.mocked(tracksClient.saveTrack).mockResolvedValue('failed');
    await controller.refreshSavedTracks();
    await controller.onSaveTrack('Passage two');
    expect(toast.show).toHaveBeenLastCalledWith(
      'Could not save the track. Check the connection and access.',
    );
  });

  it('reports a save as failed so the name form can stay open', async () => {
    const { controller } = makeController();
    vi.mocked(tracksClient.saveTrack).mockResolvedValue('failed');
    await expect(controller.onSaveTrack('Passage')).resolves.toBe(false);
    vi.mocked(tracksClient.saveTrack).mockResolvedValue('ok');
    await expect(controller.onSaveTrack('Passage')).resolves.toBe(true);
  });

  it('requests write access after a refused save and reports it as not saved', async () => {
    const { controller, toast, requestWriteAccess } = makeController();
    vi.mocked(tracksClient.saveTrack).mockResolvedValue('access-denied');
    await expect(controller.onSaveTrack('Passage')).resolves.toBe(false);
    expect(requestWriteAccess).toHaveBeenCalledOnce();
    expect(toast.show).toHaveBeenCalledWith(
      'Signal K refused the write. Your track is kept while read/write access is requested.',
    );
  });

  it('requests write access after a refused delete', async () => {
    const { controller, toast, requestWriteAccess } = makeController();
    vi.mocked(tracksClient.deleteTrack).mockResolvedValue('access-denied');
    await controller.onDeleteSavedTrack('a');
    expect(requestWriteAccess).toHaveBeenCalledOnce();
    expect(toast.show).toHaveBeenCalledWith(
      'Signal K refused the delete. Read/write access is being requested.',
    );
  });

  it('blocks overlapping saves', async () => {
    const { controller } = makeController();
    let resolveSave!: (result: ResourceMutationResult) => void;
    vi.mocked(tracksClient.saveTrack).mockImplementationOnce(
      () => new Promise((resolve) => (resolveSave = resolve)),
    );
    const first = controller.onSaveTrack('One');
    const second = controller.onSaveTrack('Two');
    expect(tracksClient.saveTrack).toHaveBeenCalledOnce();
    resolveSave('ok');
    await Promise.all([first, second]);
  });

  it('records what the provisioning probe answered', async () => {
    const { controller } = makeController();
    expect(controller.provisioning).toBe('unknown');
    await controller.refreshSavedTracks();
    expect(controller.provisioning).toBe('provisioned');
    vi.mocked(tracksClient.fetchTracksProvisioned).mockResolvedValue(false);
    await controller.refreshSavedTracks();
    expect(controller.provisioning).toBe('unprovisioned');
  });

  it('keeps the last known provisioning when the probe does not answer', async () => {
    const { controller } = makeController();
    vi.mocked(tracksClient.fetchTracksProvisioned).mockResolvedValue(false);
    await controller.refreshSavedTracks();
    vi.mocked(tracksClient.fetchTracksProvisioned).mockResolvedValue(undefined);
    await controller.refreshSavedTracks();
    expect(controller.provisioning).toBe('unprovisioned');
  });

  it('drops a stale probe answer', async () => {
    const { controller } = makeController();
    let resolveFirst!: (provisioned: boolean | undefined) => void;
    vi.mocked(tracksClient.fetchTracksProvisioned)
      .mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
      .mockResolvedValueOnce(true);
    const first = controller.refreshSavedTracks();
    await controller.refreshSavedTracks();
    resolveFirst(false);
    await first;
    expect(controller.provisioning).toBe('provisioned');
  });

  it('treats an accepted save as proof that the server stores tracks', async () => {
    const { controller } = makeController();
    vi.mocked(tracksClient.fetchTracksProvisioned).mockResolvedValue(undefined);
    await controller.refreshSavedTracks();
    expect(controller.provisioning).toBe('unknown');
    await controller.onSaveTrack('Passage');
    expect(controller.provisioning).toBe('provisioned');
  });

  it('removes a deleted track before a failed refresh', async () => {
    const { controller } = makeController();
    vi.mocked(tracksClient.fetchSavedTracks)
      .mockResolvedValueOnce([{ id: 'a', name: 'A', points: [points] }])
      .mockResolvedValueOnce(undefined);
    await controller.refreshSavedTracks();
    controller.onToggleSaved('a', true);
    await controller.onDeleteSavedTrack('a');
    expect(controller.savedTracks).toEqual([]);
    expect(controller.shownSaved.has('a')).toBe(false);
  });
});
