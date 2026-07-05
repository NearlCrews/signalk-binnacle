import type { TrackPoint } from '$entities/track';
import type { SavedTracksSource } from '$features/track-layer';
import { uuidv4 } from '$shared/lib';
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
  let trackError = $state<string | undefined>();

  const savedSource: SavedTracksSource = {
    version: () => savedVersion,
    features: () => savedTracksToFeatures(savedTracks, shownSaved),
  };

  function getToken(): string | undefined {
    return deps.getToken();
  }

  function bumpSaved(): void {
    savedVersion += 1;
  }

  async function refreshSavedTracks(): Promise<void> {
    const fetched = await fetchSavedTracks(origin, getToken());
    if (fetched) {
      savedTracks = fetched;
      bumpSaved();
    }
  }

  async function onSaveTrack(name: string): Promise<void> {
    const points = deps.getRecorderPoints();
    if (points.length < 2) return;
    trackError = undefined;
    const id = uuidv4();
    if (!(await saveTrack(origin, getToken(), id, name, points))) {
      trackError = 'Could not save the track. Check the connection and access.';
      return;
    }
    deps.clearRecorder();
    shownSaved = new Set(shownSaved).add(id);
    await refreshSavedTracks();
  }

  async function onDeleteSavedTrack(id: string): Promise<void> {
    trackError = undefined;
    if (!(await deleteTrack(origin, getToken(), id))) {
      trackError = 'Could not delete the track. Check the connection and access.';
      return;
    }
    const next = new Set(shownSaved);
    next.delete(id);
    shownSaved = next;
    await refreshSavedTracks();
  }

  function onToggleSaved(id: string): void {
    const next = new Set(shownSaved);
    if (next.has(id)) next.delete(id);
    else next.add(id);
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
    get trackError() {
      return trackError;
    },
  };
}
