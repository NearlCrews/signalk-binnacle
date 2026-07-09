<script lang="ts">
import { ChevronLeft, ChevronRight } from '@lucide/svelte';
import type { UnitsStore } from '$entities/units';
import {
  formatClockTime,
  formatKnotsOr,
  formatLengthOr,
  formatPressureOr,
  lengthUnit,
  MINUTE_MS,
  pressureUnit,
} from '$shared/lib';
import { HISTORY_RESOLUTION_SECONDS } from '$shared/signalk';
import { registerDismiss } from '$shared/ui';
import type { TimeTravelStore } from './time-travel-store.svelte';
import { relativeHours, scrubValueText } from './time-travel-timeline';

interface Props {
  store: TimeTravelStore;
  units: UnitsStore;
  onExit: () => void;
}

const { store, units, onExit }: Props = $props();

// Coarse button step: a quarter-hour nudge keeps gloved-hand stepping useful across the 24 h
// window, while the slider's fine 60 s step (keyboard arrows) still allows precise scrubbing.
const STEP_MS = 15 * MINUTE_MS;

$effect(() => {
  if (store.active) return registerDismiss(onExit);
});

const current = $derived(store.current);
const depthUnit = $derived(lengthUnit(units.mode));
const baroUnit = $derived(pressureUnit(units.mode));
const clock = $derived(current ? formatClockTime(current.t) : '');
const hoursAgo = $derived(current ? relativeHours(store.to, current.t) : 0);
const valueText = $derived(current ? scrubValueText(clock, hoursAgo) : 'No data');

// One live-region message for the whole strip: the scrub time when ready, otherwise the state.
const liveMessage = $derived(
  store.status === 'ready'
    ? valueText
    : store.status === 'loading'
      ? 'Loading history'
      : store.status === 'no-provider'
        ? 'Time travel needs a history provider on the server'
        : store.status === 'empty'
          ? 'No recorded history yet'
          : store.status === 'failed'
            ? 'Could not load history'
            : '',
);
</script>

{#if store.active}
  <aside class="bottom-strip bottom-strip--accent" aria-label="Time travel">
    <div class="head">
      <span class="title">Time travel</span>
      {#if store.status === 'ready'}
        <span class="note num" aria-hidden="true">{clock} ({hoursAgo}h ago)</span>
      {/if}
      <div class="actions">
        {#if store.status === 'ready'}
          <button type="button" class="ack" onclick={() => void store.reload()}>Now</button>
        {/if}
        <button type="button" class="ack" onclick={onExit}>Exit</button>
      </div>
    </div>

    {#if store.status === 'loading'}
      <div class="row"><span class="muted-note">Loading history...</span></div>
    {:else if store.status === 'no-provider'}
      <div class="row">
        <span class="muted-note">
          A history provider on the server (for example signalk-questdb) unlocks time travel.
        </span>
      </div>
    {:else if store.status === 'empty'}
      <div class="row"><span class="muted-note">No recorded history yet.</span></div>
    {:else if store.status === 'failed'}
      <div class="row">
        <span class="muted-note">Could not load history.</span>
        <button type="button" class="ack" onclick={() => void store.reload()}>Retry</button>
      </div>
    {:else}
      <div class="scrubber" role="group" aria-label="Scrub history">
        <button
          type="button"
          class="icon-btn step"
          aria-label="Earlier"
          onclick={() => store.setScrub(store.scrubMs - STEP_MS)}
        >
          <ChevronLeft size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          class="icon-btn step"
          aria-label="Later"
          onclick={() => store.setScrub(store.scrubMs + STEP_MS)}
        >
          <ChevronRight size={16} aria-hidden="true" />
        </button>
        <span class="track-wrap">
          <input
            class="track range"
            type="range"
            min={store.from}
            max={store.to}
            step={HISTORY_RESOLUTION_SECONDS * 1000}
            value={store.scrubMs}
            aria-label="History time"
            aria-valuetext={valueText}
            oninput={(e) => store.setScrub(e.currentTarget.valueAsNumber)}
          >
        </span>
      </div>
      <div class="row">
        <span class="metric"
          >Depth <b>{formatLengthOr(current?.depth ?? null, units.mode)}</b> {depthUnit}</span
        >
        <span class="metric">Wind <b>{formatKnotsOr(current?.windApparent ?? null)}</b> kn</span>
        <span class="metric"
          >Baro <b>{formatPressureOr(current?.pressure ?? null, units.mode)}</b> {baroUnit}</span
        >
        <span class="metric">SOG <b>{formatKnotsOr(current?.sog ?? null)}</b> kn</span>
      </div>
    {/if}

    <span class="visually-hidden" role="status">{liveMessage}</span>
  </aside>
{/if}
