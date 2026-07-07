<script lang="ts">
import { Download, Eraser, Pause, Play, Route, Save, Trash2, Undo2 } from '@lucide/svelte';
import type { TrackRecorder } from '$entities/track';
import { formatDuration, formatKnots, formatNm, PLACEHOLDER } from '$shared/lib';
import type { PersistedValue, TrackSettings } from '$shared/settings';
import {
  ArmedRow,
  defaultSaveName,
  InlineConfirm,
  NameEntry,
  resolveSaveName,
  SavedList,
  SlideOver,
  VisibilityToggle,
} from '$shared/ui';
import type { SavedTrack } from './tracks-client';

interface Props {
  recorder: TrackRecorder;
  settings: PersistedValue<TrackSettings>;
  saved: SavedTrack[];
  shown: ReadonlySet<string>;
  onSave: (name: string) => void;
  // Save the current track as a reusable route, and navigate back along it (retrace home).
  onSaveAsRoute: (name: string) => void;
  onTrackHome: () => void;
  onDelete: (id: string) => void;
  onToggleSaved: (id: string, shown: boolean) => void;
  onExport: (track: SavedTrack) => void;
  // A failed save or delete, shown until the next action, matching the routes and waypoints panels.
  error?: string;
  onClose: () => void;
  onBack?: () => void;
}

const {
  recorder,
  settings,
  saved,
  shown,
  onSave,
  onSaveAsRoute,
  onTrackHome,
  onDelete,
  onToggleSaved,
  onExport,
  error,
  onClose,
  onBack,
}: Props = $props();

const stats = $derived(recorder.stats);
const colorMode = $derived(settings.value.colorMode);
// Until the track has captured a point, its stats are absent, not zero, so show the placeholder.
const hasTrack = $derived(recorder.points.length > 0);

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

// Naming a save happens inline through NameEntry rather than a native prompt; one state drives both
// the Save and the Save-as-route flows, so only one name form is open at a time.
let naming = $state<'track' | 'route' | null>(null);
function confirmName(value: string): void {
  const kind = naming === 'route' ? 'Route' : 'Track';
  const trimmed = resolveSaveName(value, kind);
  if (naming === 'track') onSave(trimmed);
  else if (naming === 'route') onSaveAsRoute(trimmed);
  naming = null;
}

// Discarding the live recording is destructive, so it arms the same inline confirm as the
// saved-track delete rather than a blocking window.confirm.
let confirmingClear = $state(false);
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

<SlideOver title="Tracks" closeLabel="Close tracks panel" bodyFlex {onClose} {onBack}>
  {#if error}
    <p class="alert-note" role="alert">{error}</p>
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
      disabled={recorder.points.length < 2}
    >
      <Save size={16} aria-hidden="true" />
      Save
    </button>
    <button
      type="button"
      class="btn btn-danger"
      onclick={() => (confirmingClear = true)}
      disabled={recorder.points.length === 0}
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
      disabled={recorder.points.length < 2}
    >
      <Route size={16} aria-hidden="true" />
      Save as route
    </button>
    <button type="button" class="btn" onclick={onTrackHome} disabled={recorder.points.length < 2}>
      <Undo2 size={16} aria-hidden="true" />
      Retrace track
    </button>
  </div>
  {#if naming === 'route'}
    <NameEntry
      label="Save as route"
      value={defaultSaveName('Route')}
      onConfirm={confirmName}
      onCancel={() => (naming = null)}
    />
  {/if}
  <p class="muted-note">
    Save keeps the track. Save as route makes a reusable route you can follow again. Retrace track
    navigates back the way you came.
  </p>

  <section class="panel-section" aria-label="Current track">
    <h3 class="caps-label">Current track</h3>
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

  <SavedList
    heading="Saved tracks"
    items={savedCards}
    empty="No saved tracks yet. Record a track, then tap Save to keep it."
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
