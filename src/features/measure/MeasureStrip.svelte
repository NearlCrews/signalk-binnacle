<script lang="ts">
import type { MeasureStore } from '$entities/measure';
import type { UnitsStore } from '$entities/units';
import { formatBearingOr, formatMetersOrNm } from '$shared/lib';
import { registerDismiss } from '$shared/ui';

interface Props {
  measure: MeasureStore;
  units: UnitsStore;
}

const { measure, units }: Props = $props();

const instruction = $derived(
  measure.atLimit
    ? 'Point limit reached. Undo or clear points to continue.'
    : measure.isEmpty
      ? 'Tap the chart to set the start point'
      : measure.points.length === 1
        ? 'Tap the chart to set the next point'
        : `${measure.points.length} points. Tap the chart to add another`,
);

// An active measurement is a dismissable like the slide-overs and the app menu, so it joins the
// shared Escape stack: one Escape ends only the topmost surface, with no listener-order games.
$effect(() => {
  if (measure.active) return registerDismiss(() => measure.stop());
});
</script>

{#if measure.active}
  <aside class="bottom-strip bottom-strip--accent" aria-label="Measure">
    <div class="head">
      <span class="title">Measure</span>
      <span class="note" role="status">{instruction}</span>
      <div class="actions">
        <button type="button" class="ack" disabled={measure.isEmpty} onclick={() => measure.undo()}>
          Undo
        </button>
        <button
          type="button"
          class="ack"
          disabled={measure.isEmpty}
          onclick={() => measure.clear()}
        >
          Clear
        </button>
        <button type="button" class="ack" onclick={() => measure.stop()}>Done</button>
      </div>
    </div>
    {#if measure.lastLeg}
      <div class="row" aria-live="polite">
        <span class="metric">
          Leg <b>{formatMetersOrNm(measure.lastLeg.distanceMeters, units.mode)}</b>
        </span>
        <span class="metric"
          >Bearing <b>{formatBearingOr(measure.lastLeg.bearingRad)}</b>&deg;T</span
        >
        {#if measure.legs.length > 1}
          <span class="metric">
            Total <b>{formatMetersOrNm(measure.totalMeters, units.mode)}</b>
          </span>
        {/if}
      </div>
    {/if}
  </aside>
{/if}
