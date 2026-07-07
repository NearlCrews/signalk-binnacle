import type { TrackPoint } from '$entities/track';
import type { SavedTracksSource } from '$features/track-layer';
import { ErrorState, uuidv4 } from '$shared/lib';
import { downloadGeoJson } from './track-export';
import {
  deleteTrack,
  fetchSavedTracks,
  type SavedTrack,
  savedTracksToFeatures,
  saveTrack,
} from './tracks-client';

export interface TrackControllerDeps {
  origin: string;
  getToken: () => string | undefined;
  getRecorderPoints: () => TrackPoint[];
  clearRecorder: () => void;
}

export function createTrackController(deps: TrackControllerDeps) {
  const { origin } = deps;

  let savedTracks = $state.raw<SavedTrack[]>([]);
  let shownSaved = $state<ReadonlySet<string>>(new Set());
  let savedVersion = 0;
  const trackError = new ErrorState();

  const savedSource: SavedTracksSource = {
    version: () => savedVersion,
    features: () => savedTracksToFeatures(savedTracks, shownSaved),
  };

  function bumpSaved(): void {
    savedVersion += 1;
  }

  function clearTrackError(): void {
    trackError.clear();
  }

  async function refreshSavedTracks(): Promise<void> {
    const fetched = await fetchSavedTracks(origin, deps.getToken());
    if (fetched) {
      savedTracks = fetched;
      bumpSaved();
      return;
    }
    if (savedTracks.length === 0) {
      trackError.flag('Could not load saved tracks. Check the connection.');
    }
  }

  async function onSaveTrack(name: string): Promise<void> {
    const points = deps.getRecorderPoints();
    if (points.length < 2) return;
    trackError.clear();
    const id = uuidv4();
    if (!(await saveTrack(origin, deps.getToken(), id, name, points))) {
      trackError.flag('Could not save the track. Check the connection and access.');
      return;
    }
    deps.clearRecorder();
    shownSaved = new Set(shownSaved).add(id);
    await refreshSavedTracks();
  }

  async function onDeleteSavedTrack(id: string): Promise<void> {
    trackError.clear();
    if (!(await deleteTrack(origin, deps.getToken(), id))) {
      trackError.flag('Could not delete the track. Check the connection and access.');
      return;
    }
    const next = new Set(shownSaved);
    next.delete(id);
    shownSaved = next;
    await refreshSavedTracks();
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
    clearTrackError,
    get savedSource() {
      return savedSource;
    },
    get savedTracks() {
      return savedTracks;
    },
    get shownSaved() {
      return shownSaved;
    },
    get trackError() {
      return trackError.message;
    },
  };
}
