<script lang="ts">
import type { MeasureStore } from '$entities/measure';
import type { UnitsStore } from '$entities/units';
import { formatBearingOr, formatMetersOrNm } from '$shared/lib';
import { InlineConfirm, registerDismiss } from '$shared/ui';

interface Props {
  measure: MeasureStore;
  units: UnitsStore;
  onMoveSelectedToCenter?: () => void;
}

const { measure, units, onMoveSelectedToCenter }: Props = $props();
let clearArmed = $state(false);

const selectedNumber = $derived(
  measure.selectedIndex === undefined ? undefined : measure.selectedIndex + 1,
);
// What to do next, worst-constrained state first: an armed move, then a selection, then the point
// cap, then the ordinary tap-to-continue sequence. Written as ordered guards rather than a nested
// ternary so inserting a state cannot silently land on the wrong side of a branch.
function nextInstruction(): string {
  if (selectedNumber !== undefined) {
    return measure.moveArmed
      ? `Move point ${selectedNumber}: drag it or tap a new chart position. Escape cancels.`
      : `Point ${selectedNumber} selected. Choose Move point to reposition it.`;
  }
  if (measure.atLimit)
    return 'Point limit reached. Select, delete, undo, or clear a point to continue.';
  if (measure.isEmpty) return 'Tap the chart to set the start point';
  if (measure.vertices.length === 1) return 'Tap the chart to set the next point';
  return `${measure.vertices.length} points. Tap the chart to add another`;
}
const instruction = $derived(nextInstruction());

function selectPoint(event: Event): void {
  const value = (event.currentTarget as HTMLSelectElement).value;
  if (value === '') measure.select(undefined);
  else measure.selectIndex(Number(value));
}

function clearMeasure(): void {
  measure.clear();
  clearArmed = false;
}

// Escape peels deliberate move mode before it ends the whole transient measurement. Registering one
// live callback preserves the shared topmost-surface ordering without installing a second listener.
$effect(() => {
  if (!measure.active) return;
  return registerDismiss(() => {
    clearArmed = false;
    if (measure.moveArmed) measure.cancelMove();
    else measure.stop();
  });
});
</script>

{#if measure.active}
  <aside class="bottom-strip bottom-strip--accent measure-strip" aria-label="Measure">
    <div class="head">
      <span class="title">Measure</span>
      <span class="note" role="status">{instruction}</span>
      <div class="actions">
        <button
          type="button"
          class="ack"
          disabled={!measure.canUndo || measure.moveArmed}
          onclick={() => measure.undo()}
        >
          Undo
        </button>
        <button
          type="button"
          class="ack"
          disabled={measure.isEmpty || measure.moveArmed}
          onclick={() => (clearArmed = true)}
        >
          Clear
        </button>
        <button type="button" class="ack" onclick={() => measure.stop()}>Done</button>
      </div>
    </div>

    {#if clearArmed}
      <InlineConfirm
        question={`Clear all ${measure.vertices.length} measurement points?`}
        confirmLabel="Clear points"
        onConfirm={clearMeasure}
        onCancel={() => (clearArmed = false)}
      />
    {:else if !measure.isEmpty}
      <div class="edit-row">
        <label class="point-picker">
          <span>Selected point</span>
          <select class="input" value={measure.selectedIndex ?? ''} onchange={selectPoint}>
            <option value="">None</option>
            {#each measure.vertices as vertex, index (vertex.id)}
              <option value={index}>Point {index + 1} of {measure.vertices.length}</option>
            {/each}
          </select>
        </label>
        <div class="point-actions">
          <button
            type="button"
            class="ack"
            aria-label="Previous measurement point"
            disabled={measure.selectedIndex === undefined || measure.selectedIndex === 0}
            onclick={() => measure.selectPrevious()}
          >
            Previous
          </button>
          <button
            type="button"
            class="ack"
            aria-label="Next measurement point"
            disabled={measure.selectedIndex === undefined ||
              measure.selectedIndex === measure.vertices.length - 1}
            onclick={() => measure.selectNext()}
          >
            Next
          </button>
          <button
            type="button"
            class="ack"
            disabled={measure.selectedId === undefined}
            aria-pressed={measure.moveArmed}
            onclick={() => (measure.moveArmed ? measure.cancelMove() : measure.armMove())}
          >
            {measure.moveArmed ? 'Cancel move' : 'Move point'}
          </button>
          {#if measure.moveArmed && onMoveSelectedToCenter}
            <button type="button" class="ack" onclick={onMoveSelectedToCenter}>
              Move to chart center
            </button>
          {/if}
          <button
            type="button"
            class="ack ack--danger"
            disabled={!measure.canDeleteSelected || measure.moveArmed}
            aria-label={selectedNumber === undefined
              ? 'Delete selected measurement point'
              : `Delete measurement point ${selectedNumber}`}
            onclick={() => measure.deleteSelected()}
          >
            Delete point
          </button>
        </div>
      </div>
    {/if}

    {#if selectedNumber !== undefined}
      <div class="row selected-readout" aria-live="polite">
        <span class="metric">Point <b>{selectedNumber} of {measure.vertices.length}</b></span>
        {#if measure.selectedIncomingLeg}
          <span class="metric">
            Previous
            <b>{formatMetersOrNm(measure.selectedIncomingLeg.distanceMeters, units.mode)}</b>
            <b>{formatBearingOr(measure.selectedIncomingLeg.bearingRad)}</b>&deg;T
          </span>
        {/if}
        {#if measure.selectedOutgoingLeg}
          <span class="metric">
            Next <b>{formatMetersOrNm(measure.selectedOutgoingLeg.distanceMeters, units.mode)}</b>
            <b>{formatBearingOr(measure.selectedOutgoingLeg.bearingRad)}</b>&deg;T
          </span>
        {/if}
        {#if measure.legs.length > 1}
          <span class="metric">
            Total <b>{formatMetersOrNm(measure.totalMeters, units.mode)}</b>
          </span>
        {/if}
      </div>
    {:else if measure.lastLeg}
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

<style>
.measure-strip {
  inline-size: min(48rem, calc(100% - 1.5rem));
}
.edit-row {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  gap: var(--space-2);
  margin-block-end: var(--space-2);
}
.point-picker {
  display: grid;
  gap: var(--space-1);
  min-inline-size: min(13rem, 100%);
  color: var(--text-muted);
  font-size: var(--text-sm);
}
.point-picker .input {
  min-inline-size: 0;
  font-size: var(--text-md);
}
.point-actions {
  display: flex;
  flex: 1 1 22rem;
  flex-wrap: wrap;
  gap: var(--space-2);
}
.point-actions .ack {
  margin-inline-start: 0;
}
.point-actions .ack--danger {
  color: var(--alarm);
  border-color: var(--alarm);
}
.point-actions .ack--danger:hover:not(:disabled) {
  background: var(--alarm-tint);
}
.selected-readout {
  border-block-start: 1px solid var(--border);
  padding-block-start: var(--space-2);
}
@media (max-width: 30rem) {
  .point-picker,
  .point-actions {
    inline-size: 100%;
  }
  .point-actions .ack {
    flex: 1 1 auto;
  }
}
</style>
