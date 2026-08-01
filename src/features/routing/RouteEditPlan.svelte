<script lang="ts">
import { litLegIndices, type Route, type RouteHighlight, routeLegs } from '$entities/route';
import {
  formatBearingOr,
  formatDuration,
  formatDurationParts,
  formatNm,
  knotsToMetersPerSecond,
  metersPerSecondToKnots,
  PLACEHOLDER,
} from '$shared/lib';
import { etaSeconds } from '$shared/nav';
import { MAX_PLANNING_SPEED_KN, type PersistedValue } from '$shared/settings';
import { UnitField } from '$shared/ui';

interface Props {
  // The route currently under edit on the chart.
  working: Route;
  // Which leg or waypoint of the working route is cross-highlighted, so the matching rows light up.
  highlight: RouteHighlight | undefined;
  // Tap a leg row to highlight it on the chart, and pan the chart to it when it is off-screen.
  onHighlightLeg: (index: number) => void;
  // The planning speed in m/s, persisted, that turns leg distances into per-waypoint passage times.
  // SI in storage like every other measure; this panel is the only place it becomes knots.
  planningSpeed: PersistedValue<number>;
}

const { working, highlight, onHighlightLeg, planningSpeed }: Props = $props();

const planSpeedMps = $derived(
  Number.isFinite(planningSpeed.value)
    ? Math.min(knotsToMetersPerSecond(MAX_PLANNING_SPEED_KN), Math.max(0, planningSpeed.value))
    : 0,
);
// The field speaks knots; the store stays SI. Rounded to the field's own step so a value that
// round-trips through m/s does not render as 5.000000000000001.
const boundedPlanningSpeed = $derived(
  Math.round((metersPerSecondToKnots(planSpeedMps) ?? 0) * 100) / 100,
);
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
// The whole-passage time at the planning speed, shown alongside the total distance. Split into value
// and unit so a minutes reading lines its "min" up in the unit column under the distance's "nm".
const totalTime = $derived.by(() => {
  const seconds = etaSeconds(workingDistanceMeters, planSpeedMps);
  return seconds == null ? null : formatDurationParts(seconds);
});
</script>

<dl class="stat-grid">
  <dt>Waypoints</dt>
  <dd><span class="num">{wptCount}</span><span class="unit"></span></dd>
  <dt>Distance</dt>
  <dd>
    <span class="num">{workingDistanceNm}</span>
    <span class="unit">nm</span>
  </dd>
  <dt>Time</dt>
  <dd>
    <span class="num">{totalTime ? totalTime.value : PLACEHOLDER}</span>
    <span class="unit">{totalTime ? totalTime.unit : ''}</span>
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
{#if workingLegs.length > 0}
  <div class="leg-row leg-head" aria-hidden="true">
    <span class="leg-no caps-label">No.</span>
    <span class="caps-label">Dist</span>
    <span class="caps-label" title="Compass direction of the leg, in degrees true">Bearing</span>
    <span class="leg-time caps-label">Time</span>
  </div>
  <ol class="legs bare-list" aria-label="Legs">
    {#each workingLegs as leg (leg.fromIndex)}
      {@const seconds = etaSeconds(leg.cumulativeMeters, planSpeedMps)}
      <li>
        <button
          type="button"
          class="leg-row row-interactive"
          class:is-on={litLegs.has(leg.fromIndex)}
          aria-pressed={litLegs.has(leg.fromIndex)}
          aria-label={`Highlight leg ${leg.fromIndex + 1}`}
          onclick={() => onHighlightLeg(leg.fromIndex)}
        >
          <span class="leg-no num">{leg.fromIndex + 1}</span>
          <span class="leg-dist num">{formatNm(leg.distanceMeters)} nm</span>
          <span class="leg-brg num">{formatBearingOr(leg.bearingRad)}&deg;T</span>
          <span class="leg-time num">
            {seconds == null ? PLACEHOLDER : formatDuration(seconds)}
          </span>
        </button>
      </li>
    {/each}
  </ol>
{/if}

<style>
/* The leg-by-leg readout for the route under edit: a scrolling list of leg number, distance, bearing,
   and the cumulative passage time to reach that waypoint, mono and tabular so the columns line up. */
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
   the base owns), and only the leg grid and the lit leg's thick inline-start bar are scoped here. */
.leg-row {
  display: grid;
  grid-template-columns: var(--space-5) 1fr auto auto;
  gap: var(--space-2);
  align-items: center;
  padding: 0 var(--space-2);
  border-width: 1px;
  border-radius: var(--radius-sm);
  text-align: start;
}
.leg-row.is-on {
  border-inline-start-width: var(--active-bar-width);
}
/* The column header row above the legs: the same grid, no interactive chrome. The caps-label class
   on each header cell carries the muted color, so no per-cell override is needed here. */
.leg-head {
  border-width: 0;
}
.leg-no {
  color: var(--text-muted);
}
.leg-dist {
  color: var(--text);
}
.leg-brg {
  color: var(--text-muted);
}
.leg-time {
  color: var(--accent);
  text-align: end;
}
/* The route-edit working-plan stats use the global .stat-grid system in app.css. */
</style>
