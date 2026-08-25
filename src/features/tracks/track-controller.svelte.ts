import { hasDrawableTrack, type SavedTracksSource, type TrackPoint } from '$entities/track';
import { createBusyGate, type Toast, uuidv4 } from '$shared/lib';
import { createWriteOutcomeGate, deleteRefusedMessage, writeRefusedMessage } from '$shared/signalk';
import { downloadGeoJsonFromSegments } from './track-export';
import {
  deleteTrack,
  fetchSavedTracks,
  fetchTracksProvisioned,
  type SavedTrack,
  savedTrackFromPoints,
  savedTracksToFeatures,
  saveTrack,
} from './tracks-client';

export type TrackLoadState = 'idle' | 'loading' | 'ready' | 'error';

// Whether this server can store tracks at all, which is separate from whether a read succeeded: a
// server with no tracks provider answers every read and write with 404. 'unknown' until a probe
// answers, so the panel never blames storage for a plain connection failure.
export type TracksProvisioning = 'unknown' | 'provisioned' | 'unprovisioned';

export interface TrackControllerDeps {
  origin: string;
  getToken: () => string | undefined;
  getRecorderPoints: () => TrackPoint[];
  clearRecorderThrough: (savedThroughT: number) => void;
  // Ask the server for read/write access again after it refuses a write mid-session (a revoked
  // token, an expired session). The name form stays open while it is outstanding.
  requestWriteAccess: () => Promise<void>;
  // A load, save, or delete failure surfaces here instead of a panel-local error, so it is
  // visible even after the panel that triggered the action closes.
  toast: Toast;
}

export function createTrackController(deps: TrackControllerDeps) {
  const { origin } = deps;

  const accepted = createWriteOutcomeGate({
    report: (message) => deps.toast.show(message),
    requestWriteAccess: () => deps.requestWriteAccess(),
  });

  let savedTracks = $state.raw<SavedTrack[]>([]);
  let shownSaved = $state<ReadonlySet<string>>(new Set());
  let loadState = $state<TrackLoadState>('idle');
  let provisioning = $state<TracksProvisioning>('unknown');
  let busy = $state(false);
  // Every mutating action is serialized against one busy flag, so a second tap while a write is in
  // flight is dropped rather than racing it.
  const withBusy = createBusyGate(
    () => busy,
    (next) => {
      busy = next;
    },
  );
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
    const token = deps.getToken();
    const [fetched, provisioned] = await Promise.all([
      fetchSavedTracks(origin, token),
      fetchTracksProvisioned(origin, token),
    ]);
    if (generation !== refreshGeneration) return;
    // An unanswered probe keeps the last known value: a transient outage must not flash the
    // "no track storage" banner at a server that has a provider.
    if (provisioned !== undefined) provisioning = provisioned ? 'provisioned' : 'unprovisioned';
    if (fetched) {
      savedTracks = fetched;
      const ids = new Set(fetched.map((track) => track.id));
      shownSaved = new Set([...shownSaved].filter((id) => ids.has(id)));
      loadState = 'ready';
      bumpSaved();
      return;
    }
    loadState = 'error';
  }

  // Resolves whether the track was saved, so the panel can keep its name form (and the name the
  // navigator typed) on screen when it was not.
  async function onSaveTrack(name: string): Promise<boolean> {
    const points = deps.getRecorderPoints().map((point) => ({ ...point }));
    if (!hasDrawableTrack(points)) return false;
    refreshGeneration += 1;
    const id = uuidv4();
    const outcome = await saveTrack(origin, deps.getToken(), id, name, points);
    // With provisioning unconfirmed (an older server whose probe route never answered), a missing
    // tracks provider is just as likely as a connection problem, so the copy must not point at
    // only the wrong causes.
    if (
      !accepted(
        outcome,
        writeRefusedMessage('track'),
        provisioning === 'provisioned'
          ? 'Could not save the track. Check the connection and access.'
          : 'Could not save the track. Check the connection and access, and whether this server has track storage.',
      )
    ) {
      return false;
    }
    const saved = savedTrackFromPoints(id, name, points);
    savedTracks = [saved, ...savedTracks.filter((track) => track.id !== id)];
    shownSaved = new Set(shownSaved).add(id);
    loadState = 'ready';
    // A write the server accepted is direct proof that a tracks provider is registered, which is
    // stronger evidence than the probe and covers a server whose _providers route never answers.
    provisioning = 'provisioned';
    bumpSaved();
    deps.clearRecorderThrough(points[points.length - 1].t);
    await refreshSavedTracks();
    return true;
  }

  async function onDeleteSavedTrack(id: string): Promise<void> {
    refreshGeneration += 1;
    const deleted = await deleteTrack(origin, deps.getToken(), id);
    if (
      !accepted(
        deleted,
        deleteRefusedMessage(),
        'Could not delete the track. Check the connection and access.',
      )
    ) {
      return;
    }
    savedTracks = savedTracks.filter((track) => track.id !== id);
    const next = new Set(shownSaved);
    next.delete(id);
    shownSaved = next;
    bumpSaved();
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
    downloadGeoJsonFromSegments(track.name, track.points);
  }

  return {
    refreshSavedTracks,
    // onSaveTrack reports whether it saved, so a dropped call must answer false, not undefined.
    onSaveTrack: withBusy(onSaveTrack, false),
    onDeleteSavedTrack: withBusy(onDeleteSavedTrack),
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
    get provisioning() {
      return provisioning;
    },
    get busy() {
      return busy;
    },
  };
}
