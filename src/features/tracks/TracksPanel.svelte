<script lang="ts">
import Download from '@lucide/svelte/icons/download';
import Eraser from '@lucide/svelte/icons/eraser';
import Pause from '@lucide/svelte/icons/pause';
import Play from '@lucide/svelte/icons/play';
import Route from '@lucide/svelte/icons/route';
import Save from '@lucide/svelte/icons/save';
import Trash2 from '@lucide/svelte/icons/trash-2';
import Undo2 from '@lucide/svelte/icons/undo-2';
import {
  hasDrawableTrack,
  hasTrackGaps,
  latestTrackSegment,
  type TrackRecorder,
} from '$entities/track';
import { formatDuration, formatKnots, formatNm, PLACEHOLDER } from '$shared/lib';
import type { PersistedValue, TrackSettings } from '$shared/settings';
import type { AuthController } from '$shared/signalk';
import {
  ArmedRow,
  createPanelMinimize,
  defaultSaveName,
  InlineConfirm,
  NameEntry,
  resolveSaveName,
  SavedList,
  SlideOver,
  VisibilityToggle,
} from '$shared/ui';
import type { TrackLoadState, TracksProvisioning } from './track-controller.svelte';
import type { SavedTrack } from './tracks-client';

interface Props {
  auth: AuthController;
  recorder: TrackRecorder;
  settings: PersistedValue<TrackSettings>;
  saved: SavedTrack[];
  shown: ReadonlySet<string>;
  loadState: TrackLoadState;
  // Whether the server has a tracks resource provider at all, which is why a save can fail on a
  // server that is otherwise reachable and authorized.
  provisioning: TracksProvisioning;
  busy: boolean;
  routeBusy: boolean;
  persistenceDegraded: boolean;
  onRetry: () => void;
  // Resolves whether the write succeeded, so a failure keeps the name form and its entered value.
  onSave: (name: string) => Promise<boolean>;
  // Save the current track as a reusable route, and navigate back along it (retrace home).
  onSaveAsRoute: (name: string) => Promise<boolean>;
  onTrackHome: () => void;
  onDelete: (id: string) => void;
  onToggleSaved: (id: string, shown: boolean) => void;
  onExport: (track: SavedTrack) => void;
  onClose: () => void;
  onBack?: () => void;
}

const {
  auth,
  recorder,
  settings,
  saved,
  shown,
  loadState,
  provisioning,
  busy,
  routeBusy,
  persistenceDegraded,
  onRetry,
  onSave,
  onSaveAsRoute,
  onTrackHome,
  onDelete,
  onToggleSaved,
  onExport,
  onClose,
  onBack,
}: Props = $props();

const stats = $derived(recorder.stats);
const colorMode = $derived(settings.value.colorMode);
// Until the track has captured a point, its stats are absent, not zero, so show the placeholder.
const hasTrack = $derived(recorder.points.length > 0);
const canSaveTrack = $derived(hasDrawableTrack(recorder.points));
const canMakeRoute = $derived(latestTrackSegment(recorder.points).length >= 2);
const trackHasGaps = $derived(hasTrackGaps(recorder.points));
const storageMissing = $derived(provisioning === 'unprovisioned');
const writesDisabled = $derived(auth.writeBlocked || busy);
const routeActionsDisabled = $derived(auth.writeBlocked || busy || routeBusy || !canMakeRoute);
const minimize = createPanelMinimize();

// Each saved track's distance and duration, formatted once per change. They ride on the SavedTrack as
// SI metadata saved with the geometry, so the card reads them without re-walking the points; a track
// saved without them shows the placeholder.
const savedCards = $derived(
  saved.map((track) => ({
    track,
    distanceNm: track.distanceMeters == null ? PLACEHOLDER : formatNm(track.distanceMeters),
    durationText:
      track.durationSeconds == null ? PLACEHOLDER : formatDuration(track.durationSeconds),
  })),
);

// An empty saved list means something different in each state: still reading, failed, nowhere to
// read from, or genuinely nothing saved yet.
function savedEmptyMessage(state: TrackLoadState, missingStorage: boolean): string {
  if (state === 'loading') return 'Loading saved tracks…';
  if (state === 'error') return 'Saved tracks are unavailable.';
  if (missingStorage) return 'Saved tracks are unavailable until this server has track storage.';
  return 'No saved tracks yet. Record a track, then tap Save to keep it.';
}

const savedEmptyText = $derived(savedEmptyMessage(loadState, storageMissing));

// Naming a save happens inline through NameEntry rather than a native prompt; one state drives both
// the Save and the Save-as-route flows, so only one name form is open at a time.
let naming = $state<'track' | 'route' | null>(null);
let savingName = $state(false);
// The form closes only once the write is accepted. Closing it on submit discarded the name the
// navigator typed the moment a save failed, which is exactly when it is worth keeping: the failure
// itself is reported on the app-wide toast, so there would be nothing left to retry from.
async function confirmName(value: string): Promise<boolean> {
  if (savingName) return false;
  const target = naming;
  if (!target) return false;
  const trimmed = resolveSaveName(value, target === 'route' ? 'Route' : 'Track');
  savingName = true;
  try {
    const ok = target === 'track' ? await onSave(trimmed) : await onSaveAsRoute(trimmed);
    if (ok) naming = null;
    return ok;
  } finally {
    savingName = false;
  }
}

// Discarding the live recording is destructive, so it arms the same inline confirm as the
// saved-track delete rather than a blocking window.confirm.
let confirmingClear = $state(false);
let confirmingRetrace = $state(false);
function confirmClear(): void {
  confirmingClear = false;
  recorder.clear();
}

// Deleting a saved track is destructive, so it arms a confirm step rather than firing on a
// single tap where a mis-tap on a rolling deck would lose a saved track.
const armedDelete = new ArmedRow((id) => onDelete(id));

function setColorMode(mode: TrackSettings['colorMode']): void {
  settings.set({ ...settings.value, colorMode: mode });
}
</script>

<SlideOver title="Tracks" closeLabel="Close tracks panel" bodyFlex {onClose} {onBack} {minimize}>
  {#if auth.writeBlocked}
    <p class="muted-note" role="status">
      A write token is needed to save or delete tracks. Request a read/write token to continue.
    </p>
  {/if}
  {#if storageMissing}
    <p class="alert-note" role="alert">
      This Signal K server has no track storage, so tracks cannot be saved to it. An administrator
      can enable it: open the Signal K admin UI, choose Server, then Plugin Config, then Resources
      Provider (built-in), add tracks under Resources (custom), and submit.
    </p>
    <button type="button" class="btn btn-ghost" onclick={onRetry}>Check again</button>
  {/if}
  {#if persistenceDegraded}
    <p class="alert-note" role="alert">
      {storageMissing
        ? 'Track storage is memory-only. The current track will be lost on reload. Saving to the server is unavailable until track storage is enabled there.'
        : 'Track storage is memory-only. The current track will be lost on reload. Save it to the server before leaving.'}
    </p>
  {/if}
  <p class="muted-note">
    A track is the breadcrumb trail of where the boat has been. Recording starts automatically while
    underway.
  </p>
  <p class="muted-note status" class:status--on={!recorder.paused} role="status">
    {recorder.paused ? 'Paused' : 'Recording'}
  </p>
  <div class="panel-controls">
    {#if recorder.paused}
      <button type="button" class="btn" onclick={() => recorder.resume()}>
        <Play size={16} aria-hidden="true" />
        Resume
      </button>
    {:else}
      <button type="button" class="btn" onclick={() => recorder.pause()}>
        <Pause size={16} aria-hidden="true" />
        Pause
      </button>
    {/if}
    <button
      type="button"
      class="btn btn-primary"
      onclick={() => (naming = 'track')}
      disabled={!canSaveTrack || writesDisabled || storageMissing}
    >
      <Save size={16} aria-hidden="true" />
      Save
    </button>
    <button
      type="button"
      class="btn btn-danger"
      onclick={() => (confirmingClear = true)}
      disabled={recorder.points.length === 0 || busy}
    >
      <Eraser size={16} aria-hidden="true" />
      Discard
    </button>
  </div>
  {#if naming === 'track'}
    <NameEntry
      label="Save track as"
      value={defaultSaveName('Track')}
      onConfirm={confirmName}
      busy={savingName}
      onCancel={() => (naming = null)}
    />
  {/if}
  {#if confirmingClear}
    <InlineConfirm
      question="Discard the current track? This cannot be undone."
      confirmLabel="Discard"
      onConfirm={confirmClear}
      onCancel={() => (confirmingClear = false)}
    />
  {/if}

  <section class="panel-section" aria-label="Track color">
    <h3 class="caps-label">Track color</h3>
    <div class="color-mode segmented" role="group" aria-label="Track color">
      <button
        type="button"
        class="btn"
        class:is-on={colorMode === 'speed'}
        aria-pressed={colorMode === 'speed'}
        onclick={() => setColorMode('speed')}
      >
        Speed
      </button>
      <button
        type="button"
        class="btn"
        class:is-on={colorMode === 'solid'}
        aria-pressed={colorMode === 'solid'}
        onclick={() => setColorMode('solid')}
      >
        One color
      </button>
    </div>
  </section>

  <div class="panel-controls">
    <button
      type="button"
      class="btn"
      onclick={() => (naming = 'route')}
      disabled={routeActionsDisabled}
    >
      <Route size={16} aria-hidden="true" />
      Save as route
    </button>
    <button
      type="button"
      class="btn"
      onclick={() => (confirmingRetrace = true)}
      disabled={routeActionsDisabled}
    >
      <Undo2 size={16} aria-hidden="true" />
      Retrace track
    </button>
  </div>
  {#if naming === 'route'}
    <NameEntry
      label="Save as route"
      value={defaultSaveName('Route')}
      onConfirm={confirmName}
      busy={savingName}
      onCancel={() => (naming = null)}
    />
  {/if}
  {#if confirmingRetrace}
    <InlineConfirm
      question="Start navigation back along the latest continuous track segment? Check the route before relying on it."
      confirmLabel="Start retrace"
      onConfirm={() => {
        confirmingRetrace = false;
        onTrackHome();
      }}
      onCancel={() => (confirmingRetrace = false)}
    />
  {/if}
  <p class="muted-note">
    Save keeps the track. Save as route makes a reusable route you can follow again. Retrace track
    navigates back the way you came.
  </p>
  {#if trackHasGaps}
    <p class="muted-note">
      GPS gaps split this track. Route actions use only the latest continuous segment. Saving the
      track keeps all segments.
    </p>
  {:else if hasTrack && !canMakeRoute}
    <p class="muted-note">Record at least two connected points to save or retrace a route.</p>
  {/if}

  <section class="panel-section" aria-label="Current track">
    <h3 class="caps-label">Current track</h3>
    <p class="muted-note">
      {recorder.points.length} {recorder.points.length === 1 ? 'point' : 'points'}
    </p>
    <dl class="stat-grid">
      <dt>Distance</dt>
      <dd>
        <span class="num">{hasTrack ? formatNm(stats.distanceMeters) : PLACEHOLDER}</span>
        <span class="unit">nm</span>
      </dd>
      <dt>Duration</dt>
      <dd>
        <span class="num">{hasTrack ? formatDuration(stats.durationSeconds) : PLACEHOLDER}</span>
        <span class="unit"></span>
      </dd>
      <dt>Avg speed</dt>
      <dd>
        <span class="num">{hasTrack ? formatKnots(stats.avgSog) : PLACEHOLDER}</span>
        <span class="unit">kn</span>
      </dd>
      <dt>Top speed</dt>
      <dd>
        <span class="num">{hasTrack ? formatKnots(stats.maxSog) : PLACEHOLDER}</span>
        <span class="unit">kn</span>
      </dd>
    </dl>
  </section>

  {#if loadState === 'error'}
    <p class="alert-note" role="alert">
      {saved.length > 0
        ? 'Could not refresh saved tracks. Showing the last loaded tracks.'
        : 'Could not load saved tracks. Check the connection, then retry.'}
    </p>
    <button type="button" class="btn btn-ghost" onclick={onRetry}>Retry saved tracks</button>
  {:else if loadState === 'loading' && saved.length > 0}
    <p class="muted-note" role="status">Refreshing saved tracks…</p>
  {/if}
  <SavedList
    heading="Saved tracks"
    items={savedCards}
    empty={savedEmptyText}
    key={({ track }) => track.id}
  >
    {#snippet card({ track, distanceNm, durationText })}
      <div class="card-head">
        <span class="name" title={track.name}>{track.name}</span>
      </div>
      <dl class="card-stats">
        <dt class="caps-label">Distance</dt>
        <dd>
          <span class="num">{distanceNm}</span>
          nm
        </dd>
        <dt class="caps-label">Duration</dt>
        <dd><span class="num">{durationText}</span></dd>
      </dl>
      {#if armedDelete.isArmed(track.id)}
        <InlineConfirm
          question="Delete this track?"
          onConfirm={() => armedDelete.confirm(track.id)}
          onCancel={() => armedDelete.cancel()}
        />
      {:else}
        <div class="actions">
          <VisibilityToggle
            visible={shown.has(track.id)}
            onToggle={(v) => onToggleSaved(track.id, v)}
          />
          <button
            type="button"
            class="icon-btn"
            aria-label="Download track file"
            title="Download track file (.geojson)"
            onclick={() => onExport(track)}
          >
            <Download size={18} aria-hidden="true" />
          </button>
          <button
            type="button"
            class="icon-btn icon-btn--danger"
            aria-label="Delete track"
            title="Delete"
            onclick={() => armedDelete.arm(track.id)}
            disabled={writesDisabled}
          >
            <Trash2 size={18} aria-hidden="true" />
          </button>
        </div>
      {/if}
    {/snippet}
  </SavedList>
</SlideOver>

<style>
/* The segment join comes from the global .segmented treatment; only the equal segment widths and
   the off-segment quiet fill are local. */
.color-mode .btn {
  flex: 1;
}
/* The recording-state line: muted while paused, accented while a track is being captured. */
.status--on {
  color: var(--accent);
  font-weight: 600;
}
/* The current-track stats use the global .stat-grid system in app.css. */
/* The saved-track card list, name, stats, and actions come from the global .saved system in app.css. */
/* The armed confirms (saved-track delete, live-track discard) come from the shared InlineConfirm
   component. */
</style>
