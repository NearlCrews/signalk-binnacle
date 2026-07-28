<script lang="ts">
import { onDestroy } from 'svelte';
import type { PoiViewState } from '$entities/poi';
import { categoryLabel, poiInlineIconSvg } from '$entities/poi-icons';
import type { UnitsStore } from '$entities/units';
import type { OwnVessel } from '$entities/vessel';
import { formatBearingOr, formatMetersOrNm } from '$shared/lib';
import { MAX_NAV_ROWS, type NavSortState, toggleSort } from '$shared/nav';
import { createPanelMinimize, NavSortControl, ShowOnChartToggle, SlideOver } from '$shared/ui';
import {
  defaultSort,
  filterRows,
  type Poi,
  type PoiSort,
  sortRows,
  toRows,
} from './poi-search-rows';

interface Props {
  pois: readonly Poi[];
  vessel: OwnVessel;
  units: UnitsStore;
  viewState: PoiViewState;
  selectedId?: string;
  placesShown: boolean;
  onTogglePlaces: (shown: boolean) => void;
  // Choose a result: rings its marker on the chart and opens its detail. Never moves the map.
  onSelect: (poi: Poi) => void;
  // Preview a result on the chart while the pointer or keyboard focus is on its row, and clear with
  // undefined on leave. Drives the transient chart ring.
  onHover: (poi: Poi | undefined) => void;
  onClose: () => void;
  onBack?: () => void;
}

const {
  pois,
  vessel,
  units,
  viewState,
  selectedId,
  placesShown,
  onTogglePlaces,
  onSelect,
  onHover,
  onClose,
  onBack,
}: Props = $props();

let query = $state('');
let sortState = $state<NavSortState<PoiSort>>(defaultSort(false));
let sortTouched = $state(false);
let previewedId = $state<string | undefined>();
const minimize = createPanelMinimize();
const vesselPosition = $derived(vessel.positionStale ? undefined : vessel.position);

const allRows = $derived(
  sortRows(filterRows(toRows(pois, vesselPosition), query), sortState.key, sortState.dir),
);
const rows = $derived(allRows.slice(0, MAX_NAV_ROWS));

const subtitle = $derived(
  allRows.length === pois.length
    ? `${pois.length} in view`
    : `${allRows.length} of ${pois.length} in view`,
);

const SORTS: { key: PoiSort; label: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'type', label: 'Category' },
  { key: 'distance', label: 'Distance' },
  { key: 'bearing', label: 'Bearing' },
];

function chooseSort(key: PoiSort): void {
  sortTouched = true;
  sortState = toggleSort(sortState, key);
}

function preview(poi: Poi | undefined): void {
  previewedId = poi?.id;
  onHover(poi);
}

// Before the navigator chooses a sort, follow GPS availability: nearest-first as soon as a fresh fix
// arrives, and name-first if the fix is absent or stale. An explicit sort choice is never overridden.
$effect(() => {
  if (sortTouched) return;
  const next = defaultSort(vesselPosition !== undefined);
  if (sortState.key !== next.key || sortState.dir !== next.dir) sortState = next;
});

// Clear a chart preview if filtering, panning, or provider refresh removes that row.
$effect(() => {
  if (previewedId && !rows.some((row) => row.poi.id === previewedId)) preview(undefined);
});

onDestroy(() => onHover(undefined));
</script>

<SlideOver
  title="Find places"
  {subtitle}
  {onClose}
  {onBack}
  closeLabel="Close find places"
  bodyFlex
  {minimize}
>
  <p class="muted-note">
    Harbors, anchorages, marinas, services, and hazards in the current chart view.
  </p>
  <ShowOnChartToggle
    visible={placesShown}
    label="Show places on chart"
    description="Markers for places in the current chart view"
    onToggle={onTogglePlaces}
  />
  {#if viewState.phase === 'error' && pois.length > 0}
    <p class="alert-note" role="alert">
      Places could not refresh. Showing the last results for this area.
    </p>
  {:else if viewState.phase === 'loading' && pois.length > 0}
    <p class="muted-note" role="status">Refreshing places for this chart view…</p>
  {:else if viewState.phase === 'ready' && viewState.offline && pois.length > 0}
    <p class="muted-note" role="status">
      Offline: showing cached places. Recent provider changes may be missing.
    </p>
  {/if}
  {#if pois.length > 0 && vesselPosition === undefined}
    <p class="muted-note" role="status">
      Distance and bearing need a fresh GPS fix. Results are sorted by name until one arrives.
    </p>
  {/if}
  <input
    class="input search-input"
    type="search"
    placeholder="Search name, category, or source"
    aria-label="Search places by name, category, or source"
    bind:value={query}
  >
  <NavSortControl
    sorts={SORTS}
    state={sortState}
    onChoose={chooseSort}
    ariaLabel="Sort places by"
  />
  {#if rows.length === 0}
    {#if pois.length > 0}
      <p class="muted-note" role="status">
        No places match your search. Clear it to see all places in view.
      </p>
    {:else if viewState.phase === 'ready' && viewState.offline}
      <p class="muted-note" role="status">
        No places are available from cache for this view. Reconnect, then pan or zoom to load them.
      </p>
    {:else if viewState.phase === 'zoomed-out'}
      <p class="muted-note" role="status">
        Zoom in to level 9 or closer to load places for this chart area.
      </p>
    {:else if viewState.phase === 'hidden'}
      <p class="muted-note" role="status">
        Places are hidden. Use Show places on chart above to turn the layer on.
      </p>
    {:else if viewState.phase === 'error'}
      <p class="alert-note" role="alert">
        Places could not load. Check the connection and that a notes provider is enabled, then pan
        or zoom to retry.
      </p>
    {:else if viewState.phase === 'loading' || viewState.phase === 'idle'}
      <p class="muted-note" role="status">Loading places for this chart view…</p>
    {:else}
      <p class="muted-note" role="status">
        No places were returned for this view. Pan or zoom in, or check that a notes provider is
        enabled.
      </p>
    {/if}
  {:else}
    <ul class="nav-list bare-list" aria-label="Places in view">
      {#each rows as row (row.poi.id)}
        <li>
          <button
            type="button"
            class="nav-row"
            aria-current={selectedId === row.poi.id ? 'true' : undefined}
            title="Open the detail for {row.poi.name}"
            onclick={() => onSelect(row.poi)}
            onmouseenter={() => preview(row.poi)}
            onmouseleave={() => preview(undefined)}
            onfocus={() => preview(row.poi)}
            onblur={() => preview(undefined)}
          >
            <span class="poi-head">
              <span class="poi-cat" title={categoryLabel(row.poi.category)}>
                <!-- The category SVG is a static literal from a fixed enum, never external input. -->
                <!-- eslint-disable-next-line svelte/no-at-html-tags -- fixed local icon markup -->
                {@html poiInlineIconSvg(row.poi.category)}
                <span class="visually-hidden">{categoryLabel(row.poi.category)}</span>
              </span>
              <span class="poi-title">
                <span class="nav-name">{row.poi.name}</span>
                <span class="poi-source">
                  {categoryLabel(row.poi.category)}{row.poi.source ? ` · ${row.poi.source}` : ''}
                </span>
              </span>
            </span>
            <span class="nav-metrics">
              <span class="nav-metric">
                Distance <b class="num">{formatMetersOrNm(row.distanceMeters, units.mode)}</b>
              </span>
              <span class="nav-metric" title="Bearing in degrees true">
                Bearing
                <b class="num">
                  {row.bearingRad === undefined ? '--' : `${formatBearingOr(row.bearingRad)}°T`}
                </b>
              </span>
            </span>
          </button>
        </li>
      {/each}
    </ul>
    {#if allRows.length > MAX_NAV_ROWS}
      <p class="muted-note" role="status">
        Showing the first {MAX_NAV_ROWS} of {allRows.length} matches. Search or zoom in to narrow
        the results.
      </p>
    {/if}
  {/if}
</SlideOver>

<style>
/* The search field, the sort header, the result rows, the selected-row accent, and the readout line
   come from the global .search-input and shared .nav-* family in cards.css. Only the leading category
   icon is local. */
.poi-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.poi-cat {
  flex-shrink: 0;
  display: inline-flex;
}
.poi-title {
  min-inline-size: 0;
  display: flex;
  flex: 1;
  flex-direction: column;
}
.poi-source {
  overflow: hidden;
  color: var(--text-muted);
  font-size: var(--text-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
