<script lang="ts">
import { litLegIndices, type Route, type RouteHighlight, routeLegs } from '$entities/route';
import type { WeatherGrid } from '$entities/weather';
import {
  formatBearingOr,
  formatClockTime,
  formatDuration,
  formatDurationParts,
  formatMonthDay,
  formatNm,
  knotsToMetersPerSecond,
  metersPerSecondToKnots,
  PLACEHOLDER,
  type UnitsSelection,
} from '$shared/lib';
import { crossesLocalMidnight, etaSeconds, isAfterDark, plannedArrivalMs } from '$shared/nav';
import { MAX_PLANNING_SPEED_KN, type PersistedValue } from '$shared/settings';
import { UnitField } from '$shared/ui';
import { routeWindAt, windLineText } from './route-weather';

interface Props {
  // The route currently under edit on the chart.
  working: Route;
  // Which leg or waypoint of the working route is cross-highlighted, so the matching rows light up.
  highlight: RouteHighlight | undefined;
  // Tap a leg row to highlight it on the chart, and pan the chart to it when it is off-screen.
  // Absent for the read-only plan a saved card shows, where the rows are a table, not controls.
  onHighlightLeg?: (index: number) => void;
  // The planning speed in m/s, persisted, that turns leg distances into per-waypoint passage times.
  // SI in storage like every other measure; this panel is the only place it becomes knots.
  planningSpeed: PersistedValue<number>;
  // The loaded forecast grid, when the weather layer has ever fetched one. Absent (weather never
  // opened, or offline with no cache) leaves the plan exactly as it was without wind lines.
  weatherGrid?: WeatherGrid | undefined;
  // The per-category display units, for the wind line's speed. Defaults to the metric profile,
  // whose speed category is knots.
  units?: UnitsSelection;
}

const {
  working,
  highlight,
  onHighlightLeg,
  planningSpeed,
  weatherGrid = undefined,
  units = 'metric',
}: Props = $props();

// The persisted value is already bounded by its codec on both read and write, so this only guards
// against a non-finite reaching the arithmetic below.
const planSpeedMps = $derived(Number.isFinite(planningSpeed.value) ? planningSpeed.value : 0);
// The field speaks knots; the store stays SI. Rounded to two decimals so a value that round-trips
// through m/s does not render as 5.000000000000001.
const boundedPlanningSpeed = $derived(
  Math.round((metersPerSecondToKnots(planSpeedMps) ?? 0) * 100) / 100,
);

// The editable departure. Component state seeded to now on each mount, deliberately never
// persisted: a stale date silently carried between unrelated plans would skew every arrival.
function toLocalInputValue(epochMs: number): string {
  const at = new Date(epochMs);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
}
let departureLocal = $state(toLocalInputValue(Date.now()));
const departureMs = $derived.by(() => {
  const parsed = new Date(departureLocal).getTime();
  return Number.isFinite(parsed) ? parsed : undefined;
});

// Each leg's distance, bearing, and the cumulative distance to reach that leg's end waypoint, so the
// plan reads as a leg table the way a navigator lays out a passage, updating live as waypoints are
// dragged or inserted. The per-leg passage times are layered on at render so this geometry walk does
// not re-run when only the planning speed changes.
const workingLegs = $derived.by(() => {
  let cumulativeMeters = 0;
  return routeLegs(working.waypoints).map((leg) => {
    cumulativeMeters += leg.distanceMeters;
    return { ...leg, cumulativeMeters };
  });
});
// The leg rows lit by the current cross-highlight (a leg lights itself; a waypoint lights the legs it
// joins). Keyed off the waypoint count, not the working object, so a same-length drag move does not
// rebuild the Set; a Set so each row checks its lit state in O(1).
const wptCount = $derived(working.waypoints.length);
const litLegs = $derived(new Set(litLegIndices(highlight, wptCount)));
// The whole-route distance is the last leg's cumulative, so the total and the table cannot drift.
const workingDistanceMeters = $derived(workingLegs.at(-1)?.cumulativeMeters ?? 0);
const workingDistanceNm = $derived(formatNm(workingDistanceMeters));
// The whole-passage duration at the planning speed. Named a duration, never bare "Time".
const totalDuration = $derived.by(() => {
  const seconds = etaSeconds(workingDistanceMeters, planSpeedMps);
  return seconds === undefined ? null : formatDurationParts(seconds);
});

// A planned local-clock arrival, with the date named whenever it crosses local midnight so an
// overnight arrival cannot read earlier than the departure. Planned only: the live route ETA on
// the nav strip is a different, separately labeled number.
function arrivalText(cumulativeMeters: number): string {
  if (departureMs === undefined) return PLACEHOLDER;
  const at = plannedArrivalMs(departureMs, cumulativeMeters, planSpeedMps);
  if (at === undefined) return PLACEHOLDER;
  const clock = formatClockTime(at);
  if (!crossesLocalMidnight(departureMs, at)) return clock;
  return `${clock} ${formatMonthDay(at)}`;
}

function endpointName(fromIndex: number): string {
  return working.waypoints[fromIndex + 1]?.name ?? `Point ${fromIndex + 2}`;
}

// Per-leg planning cues at the leg's end waypoint: the after-dark flag from local solar math
// (offline, no provider), and the forecast wind at the planned arrival when the grid covers that
// place and time. Derived once per (geometry, departure, planning speed, grid identity, units)
// rather than recomputed inside each row's render.
interface LegForecast {
  afterDark: boolean;
  windLine: string | undefined;
}
const legForecasts: LegForecast[] = $derived.by(() =>
  workingLegs.map((leg) => {
    const wpt = working.waypoints[leg.fromIndex + 1];
    const at =
      departureMs === undefined
        ? undefined
        : plannedArrivalMs(departureMs, leg.cumulativeMeters, planSpeedMps);
    if (wpt === undefined || at === undefined) return { afterDark: false, windLine: undefined };
    const { latitude, longitude } = wpt.position;
    const wind =
      weatherGrid === undefined ? undefined : routeWindAt(weatherGrid, latitude, longitude, at);
    return {
      afterDark: isAfterDark(at, latitude, longitude),
      windLine: wind === undefined ? undefined : windLineText(wind, units),
    };
  }),
);
const hasWindLines = $derived(legForecasts.some((cue) => cue.windLine !== undefined));
</script>

<dl class="stat-grid">
  <dt>Waypoints</dt>
  <dd><span class="num">{wptCount}</span><span class="unit"></span></dd>
  <dt>Distance</dt>
  <dd>
    <span class="num">{workingDistanceNm}</span>
    <span class="unit">nm</span>
  </dd>
  <dt>Passage duration</dt>
  <dd>
    <span class="num">{totalDuration ? totalDuration.value : PLACEHOLDER}</span>
    <span class="unit">{totalDuration ? totalDuration.unit : ''}</span>
  </dd>
  <dt>Planned arrival</dt>
  <dd>
    <span class="num">{arrivalText(workingDistanceMeters)}</span>
    <span class="unit"></span>
  </dd>
</dl>
<UnitField
  label="Planning speed"
  unit="kn"
  value={boundedPlanningSpeed}
  min={0}
  max={MAX_PLANNING_SPEED_KN}
  step={0.5}
  inputWidth="4rem"
  ariaLabel="Planning speed in knots, used to estimate the time to each point"
  onCommit={(speed) =>
    planningSpeed.set(
      knotsToMetersPerSecond(
        Number.isFinite(speed) ? Math.min(MAX_PLANNING_SPEED_KN, Math.max(0, speed)) : 0,
      ),
    )}
/>
<label class="departure">
  <span class="caps-label">Departure</span>
  <input
    type="datetime-local"
    bind:value={departureLocal}
    aria-label="Planned departure date and time, used for the arrival clock times"
  >
</label>
{#snippet legBody(leg: (typeof workingLegs)[number])}
  {@const seconds = etaSeconds(leg.cumulativeMeters, planSpeedMps)}
  {@const forecast = legForecasts[leg.fromIndex]}
  <span class="leg-line">
    <span class="leg-no num">{leg.fromIndex + 1}</span>
    <span class="leg-name">{endpointName(leg.fromIndex)}</span>
    <span
      class="leg-arrive num"
      title="Planned local arrival at this point, from the departure and planning speed"
      >{arrivalText(leg.cumulativeMeters)}</span
    >
  </span>
  <span class="leg-line leg-line--metrics">
    <span class="num">{formatNm(leg.distanceMeters)} nm</span>
    <span class="num">{formatBearingOr(leg.bearingRad)}&deg;T</span>
    <span class="num leg-elapsed" title="Cumulative elapsed time to reach this point">
      Elapsed {seconds === undefined ? PLACEHOLDER : formatDuration(seconds)}
    </span>
  </span>
  {#if forecast !== undefined && (forecast.afterDark || forecast.windLine !== undefined)}
    <span class="leg-line leg-line--metrics">
      {#if forecast.afterDark}
        <span
          class="caps-label sev-warning"
          title="The planned arrival at this point is after dark: past evening or before morning civil twilight"
          >After dark</span
        >
      {/if}
      {#if forecast.windLine !== undefined}
        <span class="num" title="Forecast wind at this point's planned arrival time, degrees true"
          >{forecast.windLine}&deg;T</span
        >
      {/if}
    </span>
  {/if}
{/snippet}
{#if workingLegs.length > 0}
  <ol class="legs bare-list" aria-label="Legs">
    {#each workingLegs as leg (leg.fromIndex)}
      <li>
        <!-- One row body, two hosts: a button while the chart edit can act on a tap, and a plain
             row for the read-only plan a saved card shows, where nothing is highlightable. -->
        {#if onHighlightLeg}
          <button
            type="button"
            class="leg-row row-interactive"
            class:is-on={litLegs.has(leg.fromIndex)}
            aria-pressed={litLegs.has(leg.fromIndex)}
            aria-label={`Highlight leg ${leg.fromIndex + 1} to ${endpointName(leg.fromIndex)}`}
            onclick={() => onHighlightLeg(leg.fromIndex)}
          >
            {@render legBody(leg)}
          </button>
        {:else}
          <div class="leg-row">{@render legBody(leg)}</div>
        {/if}
      </li>
    {/each}
  </ol>
  {#if hasWindLines}
    <p class="muted-note muted-note--xs">
      Wind lines are the forecast at each planned arrival time, advisory only.
    </p>
  {/if}
{/if}

<style>
/* The leg-by-leg readout for the route under edit: two-line rows (endpoint name and arrival, then
   distance, bearing, and cumulative elapsed), mono and tabular so the columns read as a table
   while still wrapping cleanly at 320 pixels. */
.legs {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  max-block-size: 18rem;
  overflow-y: auto;
  font-size: var(--text-sm);
}
/* The row chrome, hover tint, and lit accent fill and border come from the shared .row-interactive
   base in overlays.css; the 1px border-width reserves space for the lit accent border (whose color
   the base owns). */
.leg-row {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  padding: var(--space-1) var(--space-2);
  border-width: 1px;
  border-radius: var(--radius-sm);
  text-align: start;
}
.leg-row.is-on {
  border-inline-start-width: var(--active-bar-width);
}
.leg-line {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  inline-size: 100%;
}
.leg-no {
  color: var(--text-muted);
  min-inline-size: var(--space-4);
}
.leg-name {
  flex: 1;
  min-inline-size: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}
.leg-arrive {
  color: var(--accent);
}
.leg-line--metrics {
  color: var(--text-muted);
  flex-wrap: wrap;
  padding-inline-start: calc(var(--space-4) + var(--space-2));
}
.leg-elapsed {
  margin-inline-start: auto;
}
.departure {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.departure input {
  min-block-size: var(--control-size);
}
/* The route-edit working-plan stats use the global .stat-grid system in app.css. */
</style>
