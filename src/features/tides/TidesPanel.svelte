<script lang="ts">
import RefreshCw from '@lucide/svelte/icons/refresh-cw';
import { onDestroy, untrack } from 'svelte';
import type {
  NearbyTideStation,
  TideStationKind,
  TideStationSelection,
  TidesStore,
} from '$entities/tides';
import { MAX_NEARBY_STATIONS } from '$entities/tides';
import type { UnitsStore } from '$entities/units';
import { Clock, formatBearingOr, formatClockTime, MINUTE_MS } from '$shared/lib';
import { createPanelMinimize, ShowOnChartToggle, SlideOver } from '$shared/ui';
import type { TidesController } from './tides-controller.svelte';
import {
  formatCurrentRate,
  formatStationDistance,
  formatTideHeight,
  formatTideHeightSecondary,
  nextCurrentEvent,
  nextFlowEvent,
  nowFraction,
  tideCurvePoints,
  tideSourceNote,
  upcomingEvents,
} from './tides-display';

interface Props {
  store: TidesStore;
  controller: TidesController;
  units: UnitsStore;
  // Whether the tide-station layer is shown on the chart; the toggle row only renders when the
  // host wires onToggleStations, so the panel works without the layer.
  stationsShown?: boolean;
  onToggleStations?: (shown: boolean) => void;
  onClose: () => void;
  onBack?: () => void;
}

const {
  store,
  controller,
  units,
  stationsShown = false,
  onToggleStations,
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
// at the last refresh (a stationary boat may not trigger a reload for hours).
const clock = new Clock(MINUTE_MS);
onDestroy(() => clock.dispose());

const upcoming = $derived(tide ? upcomingEvents(tide.events, clock.now) : []);
const nextHigh = $derived(upcoming.find((event) => event.kind === 'high'));
const nextLow = $derived(upcoming.find((event) => event.kind === 'low'));
const curve = $derived(tide ? tideCurvePoints(tide.events) : []);
const nowFrac = $derived(tide ? nowFraction(tide.events, clock.now) : undefined);
const nextCurrent = $derived(current ? nextCurrentEvent(current.events, clock.now) : undefined);
// When the soonest event is slack, the following flood or ebb maximum keeps the flow picture.
const followingFlow = $derived(
  current && nextCurrent?.kind === 'slack' ? nextFlowEvent(current.events, clock.now) : undefined,
);
const sourceNote = $derived(tideSourceNote(store.source, store.loadedTide));
const minimize = createPanelMinimize();
let observedSelectionRevision = untrack(() => store.selectionRevision);
$effect(() => {
  const revision = store.selectionRevision;
  if (revision !== observedSelectionRevision) {
    observedSelectionRevision = revision;
    minimize.expand();
  }
});

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

// Keep a manual off-catalog selection visible without exceeding the eight-row panel bound.
function choices(
  nearby: NearbyTideStation[],
  requested: TideStationSelection,
): NearbyTideStation[] {
  const candidates =
    requested.mode === 'automatic'
      ? nearby
      : [{ station: requested.station, distanceMeters: requested.distanceMeters }, ...nearby];
  const unique: NearbyTideStation[] = [];
  for (const candidate of candidates) {
    if (unique.some((existing) => existing.station.id === candidate.station.id)) continue;
    unique.push(candidate);
    if (unique.length >= MAX_NEARBY_STATIONS) break;
  }
  return unique;
}

const tideChoices = $derived(choices(store.nearbyTideStations, store.requestedTide));
const currentChoices = $derived(choices(store.nearbyCurrentStations, store.requestedCurrent));
// An empty candidate list only means "nothing nearby" once a search actually finished. Before one
// starts, while one runs, or after one fails, the list is empty for a reason that has nothing to do
// with the water, and claiming no stations exist there would be a false statement about coverage.
const stationsSearched = $derived(store.status === 'ready' || store.status === 'no-coverage');

function isSelected(selection: TideStationSelection, stationId?: string): boolean {
  if (stationId === undefined) return selection.mode === 'automatic';
  return selection.mode === 'manual' && selection.station.id === stationId;
}

function selectionFailure(kind: TideStationKind): string {
  const failure = store.failure(kind);
  if (!failure) return '';
  const loaded = store.reading(kind);
  const subject =
    failure.requested.mode === 'manual'
      ? failure.requested.station.name
      : `The automatic ${kind === 'tide' ? 'tide' : 'current'} station`;
  return loaded
    ? `${subject} did not load. Showing the last accepted reading from ${loaded.station.name}.`
    : `${subject} did not load. Check the connection and retry.`;
}

function select(kind: TideStationKind, candidate: NearbyTideStation): void {
  void controller.selectStation(kind, candidate.station);
}

// A smooth path through the day's high and low turning points: a quadratic that rounds each corner
// so the rise and fall read as a tide curve rather than a sawtooth.
function curvePath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return '';
  const px = (point: { x: number; y: number }) => point.x * CURVE_W;
  const py = (point: { x: number; y: number }) =>
    (1 - point.y) * (CURVE_H - 2 * CURVE_PADDING) + CURVE_PADDING;
  let d = `M ${px(points[0]).toFixed(1)} ${py(points[0]).toFixed(1)}`;
  for (let i = 1; i < points.length; i++) {
    const previous = points[i - 1];
    const currentPoint = points[i];
    const middleX = (px(previous) + px(currentPoint)) / 2;
    const middleY = (py(previous) + py(currentPoint)) / 2;
    d += ` Q ${px(previous).toFixed(1)} ${py(previous).toFixed(1)} ${middleX.toFixed(1)} ${middleY.toFixed(1)}`;
  }
  const last = points[points.length - 1];
  d += ` L ${px(last).toFixed(1)} ${py(last).toFixed(1)}`;
  return d;
}
</script>

<SlideOver
  title="Tides and currents"
  closeLabel="Close tides panel"
  {onClose}
  {onBack}
  bodyFlex
  {minimize}
>
  <p class="muted-note">
    Automatic mode finds nearby stations. Manual choices use NOAA CO-OPS and stay selected while you
    pan.
  </p>
  <p class="muted-note">
    Distances are straight-line from the chart center and do not guarantee that a station represents
    local water movement.
  </p>

  {#if onToggleStations}
    <ShowOnChartToggle
      visible={stationsShown}
      label="Show stations on chart"
      description="Filled tide markers and hollow current markers you can tap for predictions."
      onToggle={onToggleStations}
    />
  {/if}

  <section class="panel-section selection" aria-label="Station selection">
    <div class="section-head">
      <h3 class="caps-label">Station selection</h3>
      <button
        type="button"
        class="btn btn-ghost nearest"
        onclick={() => void controller.useNearestStations()}
      >
        Use nearest stations
      </button>
    </div>

    <div class="station-group" role="group" aria-labelledby="tide-stations-heading">
      <h4 class="caps-label" id="tide-stations-heading">Tide stations</h4>
      <button
        type="button"
        class="nav-row"
        aria-current={isSelected(store.requestedTide) ? 'true' : undefined}
        onclick={() => void controller.useAutomatic('tide')}
      >
        <span class="nav-name">Automatic, nearest available</span>
        <span class="nav-metrics">Prefers signalk-tides when available</span>
      </button>
      {#each tideChoices as candidate (`tide:${candidate.station.id}`)}
        <button
          type="button"
          class="nav-row"
          aria-current={isSelected(store.requestedTide, candidate.station.id) ? 'true' : undefined}
          onclick={() => select('tide', candidate)}
        >
          <span class="nav-name">{candidate.station.name}</span>
          <span class="nav-metrics">
            {formatStationDistance(candidate.distanceMeters, units.mode)}
            straight-line
          </span>
        </button>
      {/each}
      {#if tideChoices.length === 0 && stationsSearched}
        <p class="muted-note">No NOAA tide stations are within 100 km of the chart center.</p>
      {/if}
    </div>

    <div class="station-group" role="group" aria-labelledby="current-stations-heading">
      <h4 class="caps-label" id="current-stations-heading">Current stations</h4>
      <button
        type="button"
        class="nav-row"
        aria-current={isSelected(store.requestedCurrent) ? 'true' : undefined}
        onclick={() => void controller.useAutomatic('current')}
      >
        <span class="nav-name">Automatic, nearest available</span>
        <span class="nav-metrics">Searches nearby NOAA CO-OPS stations</span>
      </button>
      {#each currentChoices as candidate (`current:${candidate.station.id}`)}
        <button
          type="button"
          class="nav-row"
          aria-current={isSelected(store.requestedCurrent, candidate.station.id) ? 'true' : undefined}
          onclick={() => select('current', candidate)}
        >
          <span class="nav-name">{candidate.station.name}</span>
          <span class="nav-metrics">
            {formatStationDistance(candidate.distanceMeters, units.mode)}
            straight-line
          </span>
        </button>
      {/each}
      {#if currentChoices.length === 0 && stationsSearched}
        <p class="muted-note">No NOAA current stations are within 60 km of the chart center.</p>
      {/if}
    </div>
  </section>

  {#if !tide && store.status === 'loading'}
    <p class="muted-note" role="status">Finding tide and current stations…</p>
  {:else if store.status === 'no-coverage'}
    <p class="muted-note" role="status">
      No tide station nearby. NOAA tide predictions cover US waters only.
    </p>
  {:else if tide}
    <section class="panel-section reading" aria-label="Tide prediction">
      <h3 class="caps-label">Tide prediction</h3>
      <div class="station">
        <span class="name" title={tide.station.name}>{tide.station.name}</span>
        <span class="dist caps-label">{stationDistanceText} away</span>
      </div>

      {#if tide.events.length === 0}
        <p class="muted-note" role="status">No predictions in this window.</p>
      {:else}
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
              <span class="unit">
                {formatTideHeightSecondary(nextHigh.heightMeters, units.mode)}
              </span>
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
              <span class="unit">
                {formatTideHeightSecondary(nextLow.heightMeters, units.mode)}
              </span>
            {:else}
              <span class="num">--</span><span class="unit"></span>
            {/if}
          </dd>
        </dl>
      {/if}

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
    </section>

    <section class="panel-section current" aria-label="Tidal current prediction">
      <h3 class="caps-label">Tidal current</h3>
      {#if current}
        <div class="station">
          <span class="name" title={current.station.name}>{current.station.name}</span>
          <span class="dist caps-label">{currentStationDistanceText} away</span>
        </div>
        {#if current.events.length === 0}
          <p class="muted-note" role="status">No predictions in this window.</p>
        {:else}
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
            {#if followingFlow}
              <dt>{`Then ${followingFlow.kind === 'ebb' ? 'ebb' : 'flood'}`}</dt>
              <dd>
                <span class="num"
                  >{formatClockTime(followingFlow.timeMs)},
                  {formatCurrentRate(
                    followingFlow.velocityMps,
                  )}{followingFlow.directionRad !== undefined
                    ? `, ${formatBearingOr(followingFlow.directionRad, 0)}°`
                    : ''}</span
                >
                <span class="unit"></span>
              </dd>
            {/if}
          </dl>
        {/if}
        <p class="footnote">Ebb flows out toward the sea, and flood flows in from it.</p>
      {:else}
        <p class="muted-note">No tidal-current prediction is available for the selected mode.</p>
      {/if}
    </section>

    {#if selectionFailure('tide') || selectionFailure('current')}
      <div class="refresh-note" role="alert">
        <div>
          {#if selectionFailure('tide')}
            <p class="alert-note">{selectionFailure('tide')}</p>
          {/if}
          {#if selectionFailure('current')}
            <p class="alert-note">{selectionFailure('current')}</p>
          {/if}
        </div>
        <button type="button" class="btn" onclick={() => void controller.retry()}>
          <RefreshCw size={16} aria-hidden="true" />
          Retry
        </button>
      </div>
    {:else if store.status === 'loading'}
      <p class="muted-note" role="status">Refreshing selected tide and current stations…</p>
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
      <div>
        {#if selectionFailure('tide')}
          <p class="alert-note">{selectionFailure('tide')}</p>
        {:else}
          <p class="alert-note">Could not load tide predictions. Check the connection.</p>
        {/if}
        {#if selectionFailure('current')}
          <p class="alert-note">{selectionFailure('current')}</p>
        {/if}
      </div>
      <button type="button" class="btn" onclick={() => void controller.retry()}>
        <RefreshCw size={16} aria-hidden="true" />
        Retry
      </button>
    </div>
  {:else}
    <p class="muted-note" role="status">Pan to a US coast to see tide predictions.</p>
  {/if}
</SlideOver>

<style>
.selection,
.station-group,
.reading,
.current {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.section-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}
.section-head > .caps-label {
  margin: 0;
}
.nearest {
  min-block-size: var(--control-size);
}
.station-group {
  padding-block-start: var(--space-1);
}
.station-group + .station-group,
.reading,
.current {
  padding-block-start: var(--space-2);
  border-block-start: 1px solid var(--border);
}
.station-group > .caps-label,
.reading > .caps-label,
.current > .caps-label {
  margin: 0;
}
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
.refresh-note {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}
.refresh-note > div {
  display: flex;
  flex: 1 1 14rem;
  flex-direction: column;
  gap: var(--space-1);
}
.refresh-note p {
  margin: 0;
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
