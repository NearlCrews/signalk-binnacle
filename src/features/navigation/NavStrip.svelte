<script lang="ts">
import SkipBack from '@lucide/svelte/icons/skip-back';
import SkipForward from '@lucide/svelte/icons/skip-forward';
import { onDestroy } from 'svelte';
import type { CourseGuidance } from '$entities/course';
import {
  formatBearingOr,
  formatClockTime,
  formatDuration,
  formatKnotsOr,
  formatNmOr,
  nauticalMilesToMeters,
  PLACEHOLDER,
} from '$shared/lib';
import { steerSide } from '$shared/nav';
import { ConfirmArm } from '$shared/ui';
import type { RouteProgress } from './route-progress';

interface Props {
  guidance: CourseGuidance;
  // Whole-route distance and time to go across the legs still ahead, shown as a passage arrival
  // readout when a multi-leg route is active. Undefined for a single leg, where the per-leg numbers
  // already say it.
  routeProgress?: RouteProgress;
  onStop: () => void;
  // Skip the active waypoint forward (1) or back (-1) along the route.
  onSkip?: (delta: number) => void;
}

const { guidance, routeProgress, onStop, onSkip }: Props = $props();

// Stop ends navigation for the whole boat, and it sits beside the waypoint-skip pair, so it arms a
// confirm step instead of firing on a single tap; the arm times out back to plain Stop on its own.
const stopArm = new ConfirmArm();
onDestroy(() => stopArm.disarm());

function tapStop(): void {
  if (stopArm.tap()) onStop();
}

// The side to steer toward to return to the track. The cross-track sign convention lives in
// steerSide; absent or zero error yields null (no marker). Shared by the L/R marker and the CDI needle.
const side = $derived(steerSide(guidance.crossTrackErrorMeters ?? Number.NaN));

const steer = $derived.by<'L' | 'R' | null>(() => {
  if (side === null) return null;
  return side === 'port' ? 'L' : 'R';
});

// A course-deviation-indicator needle: fly toward the needle, like an aviation CDI. Full-scale
// deflection at 0.2 nm off track, pegged beyond. The needle sits on the steer-to side, so a glance
// reads both the side and how far off without reading the number, and it flags caution when pegged.
const CDI_FULL_SCALE_M = nauticalMilesToMeters(0.2);
const cdi = $derived.by<{ pos: number; pegged: boolean } | null>(() => {
  const xte = guidance.crossTrackErrorMeters;
  if (xte == null) return null;
  if (side === null) return { pos: 0, pegged: false };
  const mag = Math.min(1, Math.abs(xte) / CDI_FULL_SCALE_M);
  return { pos: side === 'starboard' ? mag : -mag, pegged: mag >= 1 };
});

// Each readout shows the placeholder when its value is absent, never a misleading zero.
const dtw = $derived(formatNmOr(guidance.distanceToNextMeters));
const btw = $derived(formatBearingOr(guidance.bearingToNextRad));
const xte = $derived(
  formatNmOr(
    guidance.crossTrackErrorMeters == null ? undefined : Math.abs(guidance.crossTrackErrorMeters),
  ),
);
// Skip is only possible within the route's extent: no previous at the first point, no next at the
// last. The control reflects what the route allows, so a tap at an end is disabled rather than firing
// a best-effort request the server will reject.
const canSkipBack = $derived(guidance.canRetreatRoute);
const canSkipForward = $derived(guidance.canAdvanceRoute);

const vmg = $derived(formatKnotsOr(guidance.velocityMadeGoodMps));
const ttg = $derived(
  guidance.timeToGoSeconds != null ? formatDuration(guidance.timeToGoSeconds) : PLACEHOLDER,
);
// Whole-route distance still to run, and the arrival clock time (now plus the route time-to-go),
// recomputed each render so the clock stays current as the strip ticks. formatNmOr already shows
// the placeholder for an absent value, so routeDtg needs no guard of its own (the template only
// renders it inside the routeProgress block anyway).
const routeDtg = $derived(formatNmOr(routeProgress?.distanceToGoMeters));
const eta = $derived.by(() => {
  if (!routeProgress) return PLACEHOLDER;
  // The server's estimatedTimeOfArrival (calcValues) is the NEXT-point ETA, not the route end, so
  // it only equals the route arrival on the final leg. On earlier legs the honest route ETA is the
  // local clock estimate from the whole-route time-to-go. Guard against an unparseable string and
  // fall back the same way.
  const iso = guidance.isLastPoint ? guidance.estimatedTimeOfArrivalIso : undefined;
  if (iso) {
    const at = new Date(iso).getTime();
    if (!Number.isNaN(at)) return formatClockTime(at);
  }
  const ttgSeconds = routeProgress.timeToGoSeconds;
  if (ttgSeconds == null || !Number.isFinite(ttgSeconds)) return PLACEHOLDER;
  return formatClockTime(Date.now() + ttgSeconds * 1000);
});
</script>

{#if guidance.active}
  <!-- No aria-live on the strip itself: the metrics tick about once a second, and a live region here
       would re-read the whole readout line every tick. Only the destination name is a live region, so
       a screen reader hears the leg change when a waypoint advances, not the numbers churning. -->
  <aside class="bottom-strip bottom-strip--accent" aria-label="Active route">
    <div class="head">
      <span class="title">To</span>
      <span class="name" aria-live="polite">{guidance.nextPointName ?? PLACEHOLDER}</span>
      {#if guidance.source === 'computed'}
        <span class="note">computing locally</span>
      {/if}
      {#if onSkip}
        <div class="skip-group">
          <button
            type="button"
            class="icon-btn icon-btn--accent skip"
            aria-label="Previous waypoint"
            title="Previous waypoint"
            disabled={!canSkipBack}
            onclick={() => onSkip(-1)}
          >
            <SkipBack size={15} aria-hidden="true" />
          </button>
          <button
            type="button"
            class="icon-btn icon-btn--accent skip"
            aria-label="Next waypoint"
            title="Next waypoint"
            disabled={!canSkipForward}
            onclick={() => onSkip(1)}
          >
            <SkipForward size={15} aria-hidden="true" />
          </button>
        </div>
      {/if}
      <!-- The visible text is the whole label: it swaps to the confirm question when armed, and a
           fixed aria-label would keep announcing the unarmed name. -->
      <button type="button" class="ack" onclick={tapStop}>
        {stopArm.armed ? 'Confirm stop?' : 'Stop'}
      </button>
    </div>
    <div class="row">
      <span class="metric" title="Distance to waypoint">DTW <b>{dtw}</b> nm</span>
      <span class="metric" title="Bearing to waypoint, degrees true">BTW <b>{btw}</b>&deg;T</span>
      <span class="metric" title="Cross-track error: how far off the leg you are">
        XTE
        {#if cdi}
          <span class="cdi" aria-hidden="true">
            <span class="cdi-center"></span>
            <span
              class="cdi-needle"
              class:pegged={cdi.pegged}
              style="inset-inline-start: calc(50% + {cdi.pos * 45}%)"
            ></span>
          </span>
        {/if}
        {#if steer}
          <span class="steer">{steer}</span>
        {/if}
        <b>{xte}</b>
        nm
      </span>
      <span class="metric" title="Velocity made good toward the waypoint">VMG <b>{vmg}</b> kn</span>
      <span
        class="metric"
        title={guidance.timeToGoBasis === 'vmg'
          ? 'Time to go at the current velocity made good toward the waypoint; unavailable when not making progress'
          : 'Time to go to the waypoint, from the server course provider'}
      >
        TTG <b>{ttg}</b>
        {#if guidance.timeToGoBasis === 'vmg'}
          <span class="note">VMG</span>
        {/if}
      </span>
      {#if routeProgress}
        <span class="metric" title="Route distance still to run across the legs ahead">
          RTE <b>{routeDtg}</b> nm
        </span>
        <span
          class="metric"
          title="Estimated arrival: the active leg's time to go plus the planning speed for the legs ahead. Not a weather-, current-, or tack-aware passage estimate."
        >
          ETA <b>{eta}</b>
          {#if routeProgress.basis}
            <span class="note">{routeProgress.basis === 'vmg-plan' ? 'VMG+plan' : 'plan'}</span>
          {/if}
        </span>
      {/if}
    </div>
  </aside>
{/if}

<style>
/* The shared .bottom-strip .name owns the flex, weight, and ellipsis; the destination name adds
   only min-inline-size so it is what shrinks, while the "computing locally" note keeps its width. */
.name {
  min-inline-size: 0;
}
.note {
  flex-shrink: 0;
  white-space: nowrap;
}
.steer {
  font-family: var(--font-mono);
  font-weight: 600;
  color: var(--accent);
}
/* The compact CDI track: a horizontal scale with a center mark and a needle that deflects to the
   steer-to side, proportional to the cross-track error up to full scale. */
.cdi {
  position: relative;
  display: inline-block;
  inline-size: 3.5rem;
  block-size: var(--space-3);
  margin-inline: var(--space-1);
  vertical-align: middle;
  border-block: 1px solid var(--border);
}
.cdi-center {
  position: absolute;
  inset-block: 0;
  inset-inline-start: 50%;
  inline-size: 1px;
  background: var(--text-muted);
}
.cdi-needle {
  position: absolute;
  inset-block: -1px;
  inline-size: 2px;
  margin-inline-start: -1px;
  background: var(--accent);
}
.cdi-needle.pegged {
  background: var(--warning);
}
/* The waypoint-skip pair keeps a guaranteed gutter before the Stop control, so the destructive Stop
   does not sit flush against the skip buttons where a mis-tap on a rolling deck could end navigation
   while reaching for "next waypoint". */
.skip-group {
  display: inline-flex;
  flex-shrink: 0;
  gap: var(--space-1);
  margin-inline-end: var(--space-3);
}
/* Waypoint-skip buttons in the strip head: bordered variant of .icon-btn--accent, with a compact
   padding and the global --disabled-opacity token when disabled. */
.skip {
  flex-shrink: 0;
  padding: 0.2rem;
  border: 1px solid var(--border);
  transition: border-color var(--transition-fast);
}
.skip:hover:not(:disabled) {
  border-color: var(--accent);
  background: var(--accent-tint);
}
</style>
