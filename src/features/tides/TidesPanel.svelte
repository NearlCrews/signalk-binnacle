<script lang="ts">
import { RefreshCw } from '@lucide/svelte';
import { onDestroy } from 'svelte';
import type { TidesStore } from '$entities/tides';
import type { UnitsStore } from '$entities/units';
import { Clock, formatBearingOr, formatClockTime, MINUTE_MS } from '$shared/lib';
import { createPanelMinimize, ShowOnChartToggle, SlideOver } from '$shared/ui';
import {
  formatCurrentRate,
  formatStationDistance,
  formatTideHeight,
  formatTideHeightSecondary,
  nextCurrentEvent,
  nowFraction,
  tideCurvePoints,
  tideSourceNote,
  upcomingEvents,
} from './tides-display';

interface Props {
  store: TidesStore;
  units: UnitsStore;
  // Whether the tide-station layer is shown on the chart; the toggle row only renders when the
  // host wires onToggleStations, so the panel works without the layer.
  stationsShown?: boolean;
  onToggleStations?: (shown: boolean) => void;
  onRetry?: () => void;
  onClose: () => void;
  onBack?: () => void;
}

const {
  store,
  units,
  stationsShown = false,
  onToggleStations,
  onRetry,
  onClose,
  onBack,
}: Props = $props();

const tide = $derived(store.tide);
const current = $derived(store.current);
const stationDistanceText = $derived(
  tide ? formatStationDistance(tide.distanceMeters, units.mode) : '',
);
const currentStationDistanceText = $derived(
  current ? formatStationDistance(current.distanceMeters, units.mode) : '',
);
// A live clock so "next" events and the now-marker stay current while the panel is open, not frozen
// at the last refresh (a stationary boat may not trigger a reload for hours). Ticks once a minute,
// which is fine for tide and current events that turn over hours apart.
const clock = new Clock(MINUTE_MS);
onDestroy(() => clock.dispose());

// The upcoming high and low events, computed once, so next-high and next-low each scan the same
// sorted list rather than re-filtering and re-sorting the events twice per recompute.
const upcoming = $derived(tide ? upcomingEvents(tide.events, clock.now) : []);
const nextHigh = $derived(upcoming.find((e) => e.kind === 'high'));
const nextLow = $derived(upcoming.find((e) => e.kind === 'low'));
const curve = $derived(tide ? tideCurvePoints(tide.events) : []);
const nowFrac = $derived(tide ? nowFraction(tide.events, clock.now) : undefined);
const nextCurrent = $derived(current ? nextCurrentEvent(current.events, clock.now) : undefined);
const sourceNote = $derived(tideSourceNote(store.source));
const minimize = createPanelMinimize();
// The rate and set as one string, so no stray whitespace creeps in between the rate and the comma.
const currentRate = $derived.by(() => {
  if (!nextCurrent) return '';
  const dirSuffix =
    nextCurrent.directionRad !== undefined
      ? `, ${formatBearingOr(nextCurrent.directionRad, 0)}°`
      : '';
  return `${formatCurrentRate(nextCurrent.velocityMps)}${dirSuffix}`;
});

const CURVE_W = 240;
const CURVE_H = 60;
const CURVE_PADDING = 4;

// A smooth path through the day's high and low turning points: a quadratic that rounds each corner
// so the rise and fall read as a tide curve rather than a sawtooth.
function curvePath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return '';
  const px = (p: { x: number; y: number }) => p.x * CURVE_W;
  const py = (p: { x: number; y: number }) =>
    (1 - p.y) * (CURVE_H - 2 * CURVE_PADDING) + CURVE_PADDING;
  let d = `M ${px(points[0]).toFixed(1)} ${py(points[0]).toFixed(1)}`;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    const mx = (px(prev) + px(cur)) / 2;
    const my = (py(prev) + py(cur)) / 2;
    d += ` Q ${px(prev).toFixed(1)} ${py(prev).toFixed(1)} ${mx.toFixed(1)} ${my.toFixed(1)}`;
  }
  const last = points[points.length - 1];
  d += ` L ${px(last).toFixed(1)} ${py(last).toFixed(1)}`;
  return d;
}
</script>

<SlideOver title="Tides" closeLabel="Close tides panel" {onClose} {onBack} bodyFlex {minimize}>
  <p class="muted-note">Tide and current predictions for the nearest station.</p>
  {#if onToggleStations}
    <ShowOnChartToggle
      visible={stationsShown}
      label="Show stations on chart"
      description="Markers for nearby tide and current stations you can tap for predictions."
      onToggle={onToggleStations}
    />
  {/if}
  {#if !tide && store.status === 'loading'}
    <p class="muted-note" role="status">Finding nearby tide stations…</p>
  {:else if store.status === 'no-coverage'}
    <p class="muted-note" role="status">
      No tide station nearby. NOAA tide predictions cover US waters only.
    </p>
  {:else if tide}
    <div class="station">
      <span class="name" title={tide.station.name}>{tide.station.name}</span>
      <span class="dist caps-label">{stationDistanceText} away</span>
    </div>

    <dl class="stat-grid">
      <dt>Next high</dt>
      <dd>
        {#if nextHigh}
          <span class="num"
            >{formatClockTime(nextHigh.timeMs)},
            {formatTideHeight(
              nextHigh.heightMeters,
              units.mode,
            )}</span
          >
          <span class="unit">{formatTideHeightSecondary(nextHigh.heightMeters, units.mode)}</span>
        {:else}
          <span class="num">--</span><span class="unit"></span>
        {/if}
      </dd>
      <dt>Next low</dt>
      <dd>
        {#if nextLow}
          <span class="num"
            >{formatClockTime(nextLow.timeMs)},
            {formatTideHeight(
              nextLow.heightMeters,
              units.mode,
            )}</span
          >
          <span class="unit">{formatTideHeightSecondary(nextLow.heightMeters, units.mode)}</span>
        {:else}
          <span class="num">--</span><span class="unit"></span>
        {/if}
      </dd>
    </dl>

    {#if curve.length > 1}
      <!-- The curve restates the next-high and next-low numbers in the list above, so it is
           decorative for assistive technology. -->
      <svg class="curve" viewBox={`0 0 ${CURVE_W} ${CURVE_H}`} aria-hidden="true">
        <path class="curve-line" d={curvePath(curve)} fill="none" />
        {#if nowFrac !== undefined}
          <line class="now" x1={nowFrac * CURVE_W} y1="0" x2={nowFrac * CURVE_W} y2={CURVE_H} />
        {/if}
      </svg>
    {/if}

    {#if current}
      <div class="current">
        <span class="caps-label">Tidal current</span>
        <div class="station">
          <span class="name" title={current.station.name}>{current.station.name}</span>
          <span class="dist caps-label">{currentStationDistanceText} away</span>
        </div>
        <dl class="stat-grid">
          <dt>
            {nextCurrent
              ? `Next ${nextCurrent.kind === 'ebb' ? 'ebb' : nextCurrent.kind === 'flood' ? 'flood' : 'slack'}`
              : 'Next current'}
          </dt>
          <dd>
            {#if nextCurrent}
              <span class="num">{formatClockTime(nextCurrent.timeMs)}, {currentRate}</span>
              <span class="unit"></span>
            {:else}
              <span class="num">--</span><span class="unit"></span>
            {/if}
          </dd>
        </dl>
        <p class="footnote">Ebb flows out toward the sea, flood flows in from it.</p>
      </div>
    {/if}

    {#if store.status === 'error'}
      <div class="refresh-note" role="alert">
        <p class="alert-note">
          Showing the last update; the latest refresh did not reach the tide source.
        </p>
        {#if onRetry}
          <button type="button" class="btn" onclick={onRetry}>
            <RefreshCw size={16} aria-hidden="true" />
            Retry
          </button>
        {/if}
      </div>
    {:else if store.status === 'loading'}
      <p class="muted-note" role="status">Refreshing tide predictions…</p>
    {/if}

    {#if sourceNote}
      <p class="muted-note source-note">{sourceNote}</p>
    {/if}
    <p class="footnote">
      Heights are above mean lower low water (MLLW), the chart's zero. Times are in the device's
      local time.
    </p>
  {:else if store.status === 'error'}
    <div class="refresh-note" role="alert">
      <p class="alert-note">Could not load tide predictions. Check the connection.</p>
      {#if onRetry}
        <button type="button" class="btn" onclick={onRetry}>
          <RefreshCw size={16} aria-hidden="true" />
          Retry
        </button>
      {/if}
    </div>
  {:else}
    <p class="muted-note" role="status">Pan to a US coast to see tide predictions.</p>
  {/if}
</SlideOver>

<style>
.station {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-2);
}
.name {
  min-inline-size: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}
.dist {
  flex-shrink: 0;
  color: var(--text-muted);
}
.curve {
  inline-size: 100%;
  block-size: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface);
}
.curve-line {
  stroke: var(--accent);
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.now {
  stroke: var(--text-muted);
  stroke-width: 1;
  stroke-dasharray: 3 3;
}
.current {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding-block-start: var(--space-2);
  border-block-start: 1px solid var(--border);
}
.refresh-note {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}
.refresh-note > p {
  flex: 1 1 14rem;
}
/* The provenance note sits with the footnote, so it drops to the same fine-print scale. */
.source-note {
  font-size: var(--text-xs);
}
.footnote {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-xs);
}
</style>
