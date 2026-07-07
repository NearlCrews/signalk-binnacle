<script lang="ts">
import { untrack } from 'svelte';
import { categoryLabel, poiInlineIconSvg } from '$entities/poi-icons';
import type { UnitsStore } from '$entities/units';
import type { OwnVessel } from '$entities/vessel';
import { formatBearingOr, formatMetersOrNm } from '$shared/lib';
import { SlideOver } from '$shared/ui';
import {
  defaultSort,
  filterRows,
  type Poi,
  type PoiSort,
  type SortDir,
  sortRows,
  toRows,
} from './poi-search-rows';

interface Props {
  pois: readonly Poi[];
  vessel: OwnVessel;
  units: UnitsStore;
  // Choose a result: rings its marker on the chart and opens its detail. Never moves the map.
  onSelect: (poi: Poi) => void;
  // Preview a result on the chart while the pointer or keyboard focus is on its row, and clear with
  // undefined on leave. Drives the transient chart ring.
  onHover: (poi: Poi | undefined) => void;
  onClose: () => void;
  onBack?: () => void;
}

const { pois, vessel, units, onSelect, onHover, onClose, onBack }: Props = $props();

let query = $state('');
// Seeded once at mount: sorts by distance when the vessel has a fix, by name otherwise.
// untrack so the initializer reads vessel.position without creating a reactive dependency;
// the sort is intentionally a one-time seed, not a live-tracking derived.
let sortState = $state<{ key: PoiSort; dir: SortDir }>(
  untrack(() => defaultSort(vessel.position !== undefined)),
);

const rows = $derived(
  sortRows(filterRows(toRows(pois, vessel.position), query), sortState.key, sortState.dir),
);

const subtitle = $derived(
  rows.length === pois.length
    ? `${pois.length} in view`
    : `${rows.length} of ${pois.length} in view`,
);

const SORTS: { key: PoiSort; label: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'type', label: 'Category' },
  { key: 'distance', label: 'Distance' },
  { key: 'bearing', label: 'Bearing' },
];

// Same key flips the direction; a new key starts ascending.
function toggleSort(key: PoiSort): void {
  sortState =
    sortState.key === key
      ? { key, dir: sortState.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: 'asc' };
}
</script>

<SlideOver
  title="Find places"
  {subtitle}
  {onClose}
  {onBack}
  closeLabel="Close find places"
  bodyFlex
>
  <p class="muted-note">
    Harbors, anchorages, marinas, and other marked places in view on the chart.
  </p>
  <input
    class="input search-input"
    type="search"
    placeholder="Search places by name"
    aria-label="Search places by name"
    bind:value={query}
  >
  <div class="nav-sort">
    <span class="caps-label">Sort by</span>
    <div class="segmented" role="group" aria-label="Sort places by">
      {#each SORTS as option (option.key)}
        <button
          type="button"
          class="btn"
          class:is-on={sortState.key === option.key}
          aria-pressed={sortState.key === option.key}
          onclick={() => toggleSort(option.key)}
        >
          {option.label}
          {#if sortState.key === option.key}
            <span aria-hidden="true">{sortState.dir === 'asc' ? '▲' : '▼'}</span>
            <span class="visually-hidden">
              {sortState.dir === 'asc' ? 'ascending' : 'descending'}
            </span>
          {/if}
        </button>
      {/each}
    </div>
  </div>
  {#if rows.length === 0}
    <p class="muted-note" role="status">
      {pois.length === 0
        ? 'No places in view. Pan or zoom the chart to find some.'
        : 'No places match your search. Clear it to see all in view.'}
    </p>
  {:else}
    <ul class="nav-list bare-list" aria-label="Places in view">
      {#each rows as row (row.poi.id)}
        <li>
          <button
            type="button"
            class="nav-row"
            title="Open the detail for {row.poi.name}"
            onclick={() => onSelect(row.poi)}
            onmouseenter={() => onHover(row.poi)}
            onmouseleave={() => onHover(undefined)}
            onfocus={() => onHover(row.poi)}
            onblur={() => onHover(undefined)}
          >
            <span class="poi-head">
              <span class="poi-cat" title={categoryLabel(row.poi.category)}>
                <!-- The category SVG is a static literal from a fixed enum, never external input. -->
                {@html poiInlineIconSvg(row.poi.category)}
                <span class="visually-hidden">{categoryLabel(row.poi.category)}</span>
              </span>
              <span class="nav-name">{row.poi.name}</span>
            </span>
            <span class="nav-metrics">
              <span class="nav-metric">
                Distance <b class="num">{formatMetersOrNm(row.distanceMeters, units.mode)}</b>
              </span>
              <span class="nav-metric" title="Bearing in degrees true">
                Bearing <b class="num">{formatBearingOr(row.bearingRad)}</b>&deg;T
              </span>
            </span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</SlideOver>

<style>
/* The sort header, the result rows, and the readout line come from the shared .nav-* family in
   cards.css, shared with the AIS targets panel; only the panel section and the leading category icon
   are local. */
/* Composes the shared .input primitive; only the full-panel width is local. */
.search-input {
  inline-size: 100%;
}
.poi-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.poi-cat {
  flex-shrink: 0;
  display: inline-flex;
}
.poi-cat + .nav-name {
  flex: 1;
}
</style>
