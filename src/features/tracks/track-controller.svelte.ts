import { hasDrawableTrack, type TrackPoint } from '$entities/track';
import type { SavedTracksSource } from '$features/track-layer';
import { type Toast, uuidv4 } from '$shared/lib';
import { downloadGeoJson } from './track-export';
import {
  deleteTrack,
  fetchSavedTracks,
  type SavedTrack,
  savedTrackFromPoints,
  savedTracksToFeatures,
  saveTrack,
} from './tracks-client';

export type TrackLoadState = 'idle' | 'loading' | 'ready' | 'error';

export interface TrackControllerDeps {
  origin: string;
  getToken: () => string | undefined;
  getRecorderPoints: () => TrackPoint[];
  clearRecorderThrough: (savedThroughT: number) => void;
  // A load, save, or delete failure surfaces here instead of a panel-local error, so it is
  // visible even after the panel that triggered the action closes.
  toast: Toast;
}

export function createTrackController(deps: TrackControllerDeps) {
  const { origin } = deps;

  let savedTracks = $state.raw<SavedTrack[]>([]);
  let shownSaved = $state<ReadonlySet<string>>(new Set());
  let loadState = $state<TrackLoadState>('idle');
  let busy = $state(false);
  let savedVersion = 0;
  let refreshGeneration = 0;

  const savedSource: SavedTracksSource = {
    version: () => savedVersion,
    features: () => savedTracksToFeatures(savedTracks, shownSaved),
  };

  function bumpSaved(): void {
    savedVersion += 1;
  }

  async function refreshSavedTracks(): Promise<void> {
    const generation = ++refreshGeneration;
    loadState = 'loading';
    const fetched = await fetchSavedTracks(origin, deps.getToken());
    if (generation !== refreshGeneration) return;
    if (fetched) {
      savedTracks = fetched;
      const ids = new Set(fetched.map((track) => track.id));
      shownSaved = new Set([...shownSaved].filter((id) => ids.has(id)));
      loadState = 'ready';
      bumpSaved();
      return;
    }
    loadState = 'error';
    deps.toast.show(
      savedTracks.length === 0
        ? 'Could not load saved tracks. Check the connection.'
        : 'Could not refresh saved tracks. Showing the current list.',
    );
  }

  async function onSaveTrack(name: string): Promise<void> {
    if (busy) return;
    const points = deps.getRecorderPoints().map((point) => ({ ...point }));
    if (!hasDrawableTrack(points)) return;
    busy = true;
    refreshGeneration += 1;
    const id = uuidv4();
    try {
      if (!(await saveTrack(origin, deps.getToken(), id, name, points))) {
        deps.toast.show('Could not save the track. Check the connection and access.');
        return;
      }
      const saved = savedTrackFromPoints(id, name, points);
      savedTracks = [saved, ...savedTracks.filter((track) => track.id !== id)];
      shownSaved = new Set(shownSaved).add(id);
      loadState = 'ready';
      bumpSaved();
      deps.clearRecorderThrough(points[points.length - 1].t);
      await refreshSavedTracks();
    } finally {
      busy = false;
    }
  }

  async function onDeleteSavedTrack(id: string): Promise<void> {
    if (busy) return;
    busy = true;
    refreshGeneration += 1;
    try {
      if (!(await deleteTrack(origin, deps.getToken(), id))) {
        deps.toast.show('Could not delete the track. Check the connection and access.');
        return;
      }
      savedTracks = savedTracks.filter((track) => track.id !== id);
      const next = new Set(shownSaved);
      next.delete(id);
      shownSaved = next;
      bumpSaved();
      await refreshSavedTracks();
    } finally {
      busy = false;
    }
  }

  function onToggleSaved(id: string, shown: boolean): void {
    const next = new Set(shownSaved);
    if (shown) next.add(id);
    else next.delete(id);
    shownSaved = next;
    bumpSaved();
  }

  function onExportSavedTrack(track: SavedTrack): void {
    const points: TrackPoint[] = [];
    track.points.forEach((segment, segmentIndex) => {
      segment.forEach((point, pointIndex) => {
        points.push(pointIndex === 0 && segmentIndex > 0 ? { ...point, gap: true } : point);
      });
    });
    downloadGeoJson(track.name, points);
  }

  return {
    refreshSavedTracks,
    onSaveTrack,
    onDeleteSavedTrack,
    onToggleSaved,
    onExportSavedTrack,
    get savedSource() {
      return savedSource;
    },
    get savedTracks() {
      return savedTracks;
    },
    get shownSaved() {
      return shownSaved;
    },
    get loadState() {
      return loadState;
    },
    get busy() {
      return busy;
    },
  };
}
