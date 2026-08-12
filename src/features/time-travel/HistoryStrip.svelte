<script lang="ts">
import ChevronLeft from '@lucide/svelte/icons/chevron-left';
import ChevronRight from '@lucide/svelte/icons/chevron-right';
import Pause from '@lucide/svelte/icons/pause';
import Play from '@lucide/svelte/icons/play';
import type { UnitsStore } from '$entities/units';
import {
  DAY_MS,
  formatKnotsOr,
  formatLengthOr,
  formatPressureOr,
  HOUR_MS,
  lengthUnit,
  pressureUnit,
} from '$shared/lib';
import type { TimeTravelController } from './time-travel-controller.svelte';
import {
  TIME_TRAVEL_PRESETS,
  TIME_TRAVEL_SPEEDS,
  timeTravelPreset,
  timeTravelSpeedDescription,
  timeTravelSpeedLabel,
} from './time-travel-presets';
import {
  formatTimeTravelTimestamp,
  relativeTimeText,
  scrubValueText,
} from './time-travel-timeline';

interface Props {
  controller: TimeTravelController;
  units: UnitsStore;
  onExit: () => void;
}

const { controller, units, onExit }: Props = $props();

// One strip is mounted at a time (App renders it for the single time-travel session), so a constant
// id is enough to point every reduced-motion-disabled control at the one explanation.
const MOTION_NOTE_ID = 'time-travel-motion-note';

const current = $derived(controller.current);
const acceptedPreset = $derived(controller.accepted?.preset);
const selectedRangeId = $derived(controller.requestedRangeId ?? controller.rangeId);
const depthUnit = $derived(lengthUnit(units.mode));
const baroUnit = $derived(pressureUnit(units.mode));
const timestamp = $derived(formatTimeTravelTimestamp(controller.scrubMs));
const relative = $derived(relativeTimeText(controller.to, controller.scrubMs));
const valueText = $derived(
  scrubValueText(timestamp, relative, controller.markerSample !== undefined),
);

function compactDuration(durationMs: number): string {
  if (durationMs >= DAY_MS) {
    const days = Math.max(1, Math.round(durationMs / DAY_MS));
    return `${days} ${days === 1 ? 'day' : 'days'}`;
  }
  if (durationMs < HOUR_MS) return 'less than 1 hour';
  const hours = Math.max(1, Math.round(durationMs / HOUR_MS));
  return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
}

const coverageNote = $derived.by(() => {
  const accepted = controller.accepted;
  const first = accepted?.samples[0];
  const last = accepted?.samples.at(-1);
  if (!accepted || !first || !last) return undefined;
  const recordedMs = last.t - first.t;
  const requestedMs = accepted.preset.durationSeconds * 1000;
  const resolutionMs = accepted.preset.resolutionSeconds * 1000;
  if (recordedMs + resolutionMs >= requestedMs) return undefined;
  return `Recorded samples cover ${compactDuration(recordedMs)} of the requested ${accepted.preset.name}.`;
});

const errorText = $derived.by(() => {
  const loadError = controller.error;
  if (!loadError || controller.samples.length === 0) return undefined;
  const requested = timeTravelPreset(loadError.rangeId);
  const showing = acceptedPreset;
  if (loadError.kind === 'no-provider') {
    return `The history provider is unavailable. Showing the accepted ${showing?.name ?? 'history'}.`;
  }
  if (loadError.kind === 'empty') {
    return `No recorded data was found in ${requested.name}. Showing ${showing?.name ?? 'the accepted range'}.`;
  }
  return `Could not load ${requested.name}. Showing ${showing?.name ?? 'the accepted range'}. Retry, or choose a shorter range.`;
});

const liveMessage = $derived.by(() => {
  if (controller.playing) return '';
  if (controller.refreshing) {
    return `Loading ${timeTravelPreset(controller.requestedRangeId ?? controller.rangeId).name}. Accepted history remains visible.`;
  }
  if (errorText) return errorText;
  if (controller.status === 'ready') return valueText;
  if (controller.status === 'loading') return 'Loading history';
  if (controller.status === 'no-provider') {
    return 'Playback needs a history provider on the server';
  }
  if (controller.status === 'empty')
    return 'No recorded history in this range. Recording your own track lives in Tracks.';
  if (controller.status === 'failed') return 'Could not load history';
  return '';
});
</script>

{#if controller.active}
  <aside class="bottom-strip bottom-strip--accent history-strip" aria-label="Playback">
    <div class="head">
      <span class="title">Playback</span>
      {#if controller.samples.length > 0}
        <span class="note num" aria-hidden="true">{timestamp} · {relative}</span>
      {/if}
      <div class="actions">
        {#if controller.samples.length > 0}
          <button
            type="button"
            class="ack"
            disabled={controller.refreshing}
            onclick={() => void controller.reload()}
          >
            Refresh
          </button>
          <!-- "Latest", not "Now": this jumps to the newest loaded sample and stays in time
               travel, so naming it for the current time would promise live data. -->
          <button type="button" class="ack" onclick={() => controller.goToLatest()}>Latest</button>
        {/if}
        <button type="button" class="ack" onclick={onExit}>Exit</button>
      </div>
    </div>

    <div class="range-row">
      <span class="control-label" id="time-travel-range-label">Range</span>
      <div class="segmented range-options" role="group" aria-labelledby="time-travel-range-label">
        {#each TIME_TRAVEL_PRESETS as preset (preset.id)}
          <button
            type="button"
            class="btn"
            class:is-on={selectedRangeId === preset.id}
            aria-pressed={selectedRangeId === preset.id}
            onclick={() => void controller.setRange(preset.id)}
          >
            {preset.label}
          </button>
        {/each}
      </div>
    </div>

    {#if controller.refreshing}
      <p class="muted-note load-note" role="status">
        Loading {timeTravelPreset(controller.requestedRangeId ?? controller.rangeId).name}. Showing
        {acceptedPreset?.name ?? 'accepted history'}
        until it finishes.
      </p>
    {/if}

    {#if errorText}
      <div class="alert-note load-error action-note" role="alert">
        <span>{errorText}</span>
        <button type="button" class="btn btn-ghost" onclick={() => void controller.retry()}>
          Retry
        </button>
      </div>
    {/if}

    {#if controller.status === 'loading' && controller.samples.length === 0}
      <div class="row"><span class="muted-note">Loading history…</span></div>
    {:else if controller.status === 'no-provider' && controller.samples.length === 0}
      <div class="row">
        <span class="muted-note">
          A history provider on the server, for example signalk-questdb, unlocks time travel.
        </span>
      </div>
    {:else if controller.status === 'empty' && controller.samples.length === 0}
      <div class="row">
        <span class="muted-note"
          >No recorded data was found in {acceptedPreset?.name ?? 'this range'}.</span
        >
      </div>
    {:else if controller.status === 'failed' && controller.samples.length === 0}
      <div class="row load-failed">
        <span class="alert-note" role="alert">Could not load history.</span>
        <button type="button" class="ack" onclick={() => void controller.retry()}>Retry</button>
      </div>
    {:else if controller.samples.length > 0}
      <div class="scrubber" role="group" aria-label="History playback">
        <button
          type="button"
          class="icon-btn step"
          aria-label="Earlier"
          disabled={controller.scrubMs <= controller.from}
          onclick={() => controller.step(-1)}
        >
          <ChevronLeft size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          class="icon-btn step"
          aria-label={controller.playing ? 'Pause history playback' : 'Play history'}
          aria-describedby={controller.reducedMotion ? MOTION_NOTE_ID : undefined}
          disabled={controller.samples.length < 2 || controller.reducedMotion || controller.refreshing}
          onclick={() => (controller.playing ? controller.pause() : controller.play())}
        >
          {#if controller.playing}
            <Pause size={16} aria-hidden="true" />
          {:else}
            <Play size={16} aria-hidden="true" />
          {/if}
        </button>
        <button
          type="button"
          class="icon-btn step"
          aria-label="Later"
          disabled={controller.scrubMs >= controller.to}
          onclick={() => controller.step(1)}
        >
          <ChevronRight size={16} aria-hidden="true" />
        </button>
        <span class="track-wrap">
          <input
            class="track range"
            type="range"
            min={controller.from}
            max={controller.to}
            step={(acceptedPreset?.resolutionSeconds ?? 60) * 1000}
            value={controller.scrubMs}
            aria-label="History time"
            aria-valuetext={valueText}
            oninput={(event) => controller.setScrub(event.currentTarget.valueAsNumber)}
          >
        </span>
        <span class="time">{timestamp}</span>
      </div>

      <div class="speed-row">
        <span class="control-label" id="time-travel-speed-label">Playback speed</span>
        <div
          class="segmented speed-options"
          role="group"
          aria-labelledby="time-travel-speed-label"
          aria-describedby={controller.reducedMotion ? MOTION_NOTE_ID : undefined}
        >
          {#each TIME_TRAVEL_SPEEDS as speed (speed)}
            <button
              type="button"
              class="btn"
              class:is-on={controller.speed === speed}
              aria-pressed={controller.speed === speed}
              aria-label={timeTravelSpeedDescription(speed)}
              disabled={controller.reducedMotion}
              onclick={() => controller.setSpeed(speed)}
            >
              {timeTravelSpeedLabel(speed)}
            </button>
          {/each}
        </div>
      </div>

      {#if controller.reducedMotion}
        <p class="muted-note" id={MOTION_NOTE_ID} role="status">
          Automatic playback is off because reduced motion is enabled. Manual stepping and scrubbing
          remain available.
        </p>
      {/if}

      <p class="source-note muted-note">
        Source: <span class="num">{controller.accepted?.provider}</span>. {acceptedPreset?.name}
        loaded.
      </p>
      {#if coverageNote}
        <p class="muted-note">{coverageNote}</p>
      {/if}
      {#if !current}
        <p class="muted-note" role="status">No recorded sample is available near this time.</p>
      {:else}
        {#if controller.markerSample === undefined}
          <p class="muted-note" role="status">
            Position unavailable near this time. The replay marker is hidden.
          </p>
        {/if}
        <div class="row">
          <span class="metric"
            >Depth <b>{formatLengthOr(current.depth ?? null, units.mode)}</b> {depthUnit}</span
          >
          <span class="metric">Wind <b>{formatKnotsOr(current.windApparent ?? null)}</b> kn</span>
          <span class="metric"
            >Baro <b>{formatPressureOr(current.pressure ?? null, units.mode)}</b> {baroUnit}</span
          >
          <span class="metric">SOG <b>{formatKnotsOr(current.sog ?? null)}</b> kn</span>
        </div>
      {/if}
    {/if}

    <span class="visually-hidden" role="status">{liveMessage}</span>
  </aside>
{/if}

<style>
.history-strip {
  container-type: inline-size;
}

.range-row,
.speed-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-block: var(--space-2);
}

.control-label {
  flex: 0 0 auto;
  font-size: var(--text-sm);
  color: var(--text-muted);
}

.range-options,
.speed-options {
  flex: 1;
}

.range-options .btn,
.speed-options .btn {
  flex: 1 1 0;
  min-inline-size: var(--control-size);
  padding-inline: var(--space-2);
}

.load-note,
.source-note {
  margin: var(--space-1) 0;
}

.load-error {
  margin-block: var(--space-2);
}

.load-error span {
  flex: 1;
}

.load-failed {
  align-items: center;
}

@container (max-width: 26rem) {
  .range-row,
  .speed-row {
    align-items: stretch;
    flex-direction: column;
    gap: var(--space-1);
  }

  .range-options {
    display: grid;
    grid-template-columns: repeat(4, minmax(var(--control-size), 1fr));
  }

  .speed-options {
    display: grid;
    grid-template-columns: repeat(3, minmax(var(--control-size), 1fr));
  }

  .load-error {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
