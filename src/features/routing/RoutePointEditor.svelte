<script lang="ts">
import { tick, untrack } from 'svelte';
import { MAX_ROUTE_WAYPOINTS, type Route, type RouteWaypoint } from '$entities/route';
import type { LatLon } from '$shared/geo';
import { Disclosure, PositionFields } from '$shared/ui';
import { editRoutePoints, type RoutePointEdit, sameRoutePointPositions } from './route-point-edit';

interface Props {
  working: Route;
  onSetWaypoints: (waypoints: RouteWaypoint[]) => boolean;
  getChartCenter?: () => LatLon | undefined;
  disabled?: boolean;
}
const { working, onSetWaypoints, getChartCenter, disabled = false }: Props = $props();
let selected = $state<number | undefined>();
let pointPicker = $state<HTMLSelectElement>();
let position = $state<LatLon>(
  untrack(
    () => getChartCenter?.() ?? working.waypoints.at(-1)?.position ?? { latitude: 0, longitude: 0 },
  ),
);
let history = $state.raw<RouteWaypoint[][]>([]);
let lastWritten = $state.raw<RouteWaypoint[] | undefined>();
let message = $state('');
const atLimit = $derived(working.waypoints.length >= MAX_ROUTE_WAYPOINTS);
const selectedLatitude = $derived(
  selected === undefined ? undefined : working.waypoints[selected]?.position.latitude,
);
const selectedLongitude = $derived(
  selected === undefined ? undefined : working.waypoints[selected]?.position.longitude,
);

$effect(() => {
  if (selectedLatitude !== undefined && selectedLongitude !== undefined)
    position = { latitude: selectedLatitude, longitude: selectedLongitude };
});

$effect(() => {
  if (lastWritten && !sameRoutePointPositions(working.waypoints, lastWritten)) {
    history = [];
    lastWritten = undefined;
  }
  if (selected !== undefined && selected >= working.waypoints.length) selected = undefined;
});

function selectPoint(event: Event): void {
  const value = (event.currentTarget as HTMLSelectElement).value;
  selected = value === '' ? undefined : Number(value);
  const point = selected === undefined ? undefined : working.waypoints[selected];
  if (point) position = { ...point.position };
}

function apply(edit: RoutePointEdit): void {
  if (disabled) return;
  const before = working.waypoints.map((waypoint) => ({
    ...waypoint,
    position: { ...waypoint.position },
  }));
  const next = editRoutePoints(before, edit);
  if (!next || !onSetWaypoints(next)) {
    message = 'Point not changed. Check the coordinates and that the chart editor is ready.';
    return;
  }
  history = [...history.slice(-49), before];
  lastWritten = next;
  if (edit.kind === 'add') selected = next.length - 1;
  else if (edit.kind === 'insert') selected = edit.index + 1;
  else if (edit.kind === 'reorder') selected = edit.index + edit.direction;
  else if (edit.kind === 'delete')
    selected = next.length ? Math.min(edit.index, next.length - 1) : undefined;
  message =
    edit.kind === 'reorder'
      ? `${before[edit.index].name ?? `Point ${edit.index + 1}`} moved to position ${edit.index + edit.direction + 1} of ${next.length}.`
      : `${next.length} route ${next.length === 1 ? 'point' : 'points'}. ${edit.kind === 'delete' ? 'Point deleted.' : 'Point applied.'}`;
  if (edit.kind === 'reorder')
    void tick().then(() => {
      if (pointPicker?.isConnected) pointPicker.focus({ preventScroll: true });
    });
}

function addCenter(): void {
  const center = getChartCenter?.();
  if (!center) {
    message = 'Chart center is unavailable. Enter coordinates instead.';
    return;
  }
  position = center;
  apply({ kind: 'add', position: center });
}

function undo(): void {
  const previous = history.at(-1);
  if (disabled || !previous || !onSetWaypoints(previous)) return;
  history = history.slice(0, -1);
  lastWritten = previous;
  selected = undefined;
  message = 'Last point edit undone.';
}
</script>

<Disclosure label="Edit route points without dragging">
  <p class="muted-note">
    Enter decimal degrees, or pan the chart and add its center. Select a point to move, insert
    after, reorder, or delete it. These changes affect the draft only.
  </p>
  <label class="point-select">
    <span>Route point</span>
    <select
      class="select"
      bind:this={pointPicker}
      value={selected === undefined ? '' : String(selected)}
      onchange={selectPoint}
      {disabled}
    >
      <option value="">New point</option>
      {#each working.waypoints as waypoint, index (index)}
        <option value={String(index)}>
          Point {index + 1}{waypoint.name ? `: ${waypoint.name}` : ''}
        </option>
      {/each}
    </select>
  </label>
  <PositionFields {position} onChange={(next) => (position = next)} {disabled} />
  <div class="panel-controls">
    <button
      type="button"
      class="btn"
      disabled={disabled || atLimit}
      onclick={() => apply({ kind: 'add', position })}
    >
      Add point
    </button>
    {#if getChartCenter}
      <button type="button" class="btn" disabled={disabled || atLimit} onclick={addCenter}>
        Add at chart center
      </button>
    {/if}
    <button
      type="button"
      class="btn"
      disabled={disabled || selected === undefined}
      onclick={() => selected !== undefined && apply({ kind: 'move', index: selected, position })}
    >
      Move selected point
    </button>
    <button
      type="button"
      class="btn"
      disabled={disabled || atLimit || selected === undefined}
      onclick={() => selected !== undefined && apply({ kind: 'insert', index: selected, position })}
    >
      Insert after selected point
    </button>
    <button
      type="button"
      class="btn"
      disabled={disabled || selected === undefined || selected === 0}
      onclick={() => selected !== undefined && apply({ kind: 'reorder', index: selected, direction: -1 })}
    >
      Move point earlier
    </button>
    <button
      type="button"
      class="btn"
      disabled={disabled || selected === undefined || selected === working.waypoints.length - 1}
      onclick={() => selected !== undefined && apply({ kind: 'reorder', index: selected, direction: 1 })}
    >
      Move point later
    </button>
    <button
      type="button"
      class="btn"
      disabled={disabled || selected === undefined}
      onclick={() => selected !== undefined && apply({ kind: 'delete', index: selected })}
    >
      Delete selected point
    </button>
    <button type="button" class="btn" disabled={disabled || history.length === 0} onclick={undo}>
      Undo point edit
    </button>
  </div>
  <p class="muted-note" role="status">{message}</p>
</Disclosure>

<style>
.point-select {
  display: grid;
  gap: var(--space-1);
  min-inline-size: 0;
}
</style>
