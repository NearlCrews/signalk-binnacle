<script lang="ts">
import Navigation from '@lucide/svelte/icons/navigation';
import SquarePen from '@lucide/svelte/icons/square-pen';
import Trash2 from '@lucide/svelte/icons/trash-2';
import type { UnitsStore } from '$entities/units';
import type { OwnVessel } from '$entities/vessel';
import type { Waypoint } from '$entities/waypoint';
import { type LatLon, parseLatLonKey, quantizeLatLonKey } from '$shared/geo';
import { formatBearingOr, formatLatitude, formatLongitude, formatMetersOrNm } from '$shared/lib';
import {
  defaultNavSort,
  MAX_NAV_ROWS,
  type NavSortKey,
  type NavSortState,
  toggleSort,
} from '$shared/nav';
import type { AuthController } from '$shared/signalk';
import {
  ArmedRow,
  createPanelMinimize,
  InlineConfirm,
  NavSortControl,
  SavedList,
  SlideOver,
} from '$shared/ui';
import type { WaypointLoadState } from './waypoint-controller.svelte';
import { filterWaypointRows, sortWaypointRows, toWaypointRows } from './waypoint-rows';
import { MAX_WAYPOINTS } from './waypoints-client';

interface Props {
  auth: AuthController;
  waypoints: Waypoint[];
  vessel: OwnVessel;
  units: UnitsStore;
  loadState: WaypointLoadState;
  busy: boolean;
  routeBusy: boolean;
  onRetry: () => void;
  // Pan the chart to the waypoint without changing anything else.
  onLocate: (waypoint: Waypoint) => void;
  // Arm the Course API destination at this waypoint; the action renders only when provided.
  onGoTo?: (waypoint: Waypoint) => void;
  // Opens the edit dialog (name + icon) for this waypoint.
  onEdit: (waypoint: Waypoint) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
  onBack?: () => void;
}

const {
  auth,
  waypoints,
  vessel,
  units,
  loadState,
  busy,
  routeBusy,
  onRetry,
  onLocate,
  onGoTo,
  onEdit,
  onDelete,
  onClose,
  onBack,
}: Props = $props();

const writesDisabled = $derived(auth.writeBlocked || busy);
const navigationDisabled = $derived(writesDisabled || routeBusy);

// Deleting a waypoint is destructive, so it arms a confirm step rather than firing on a single
// tap where a mis-tap on a rolling deck would lose a saved mark.
const armedDelete = new ArmedRow((id) => {
  if (!writesDisabled) onDelete(id);
});

let confirmingNavigate = $state<Waypoint | undefined>();
let query = $state('');
let sortState = $state<NavSortState>(defaultNavSort(false));
let sortTouched = $state(false);
const minimize = createPanelMinimize();

// The own fix is quantized to about 110 m before it reaches the metric stage, so 1 Hz GPS jitter
// does not recompute the range and bearing of every mark on every tick; a glanceable list does
// not need finer. The key is a string, so the derived halts when the rounded cell is unchanged.
const ownCellKey = $derived(
  vessel.position && !vessel.positionStale ? quantizeLatLonKey(vessel.position) : '',
);
const vesselPosition = $derived<LatLon | undefined>(
  ownCellKey ? parseLatLonKey(ownCellKey) : undefined,
);
// The metrics stage stands alone: computing rhumb distance and bearing for thousands of marks is
// the expensive part, and it depends only on the collection and the fix, so a keystroke in the
// search box or a sort tap re-runs just the cheap filter and sort below.
const metricRows = $derived(toWaypointRows(waypoints, vesselPosition));
const allRows = $derived(
  sortWaypointRows(filterWaypointRows(metricRows, query), sortState.key, sortState.dir),
);
const rows = $derived(allRows.slice(0, MAX_NAV_ROWS));

const SORTS: { key: NavSortKey; label: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'distance', label: 'Distance' },
  { key: 'bearing', label: 'Bearing' },
];

// An empty card list means something different in each state: still reading, failed, filtered down
// to nothing, or genuinely nothing saved yet.
function emptyText(state: WaypointLoadState, hasWaypoints: boolean): string {
  if (state === 'loading') return 'Loading waypoints…';
  if (state === 'error') return 'Waypoints are unavailable.';
  if (hasWaypoints) return 'No waypoints match your search. Clear it to see all saved waypoints.';
  return 'No waypoints yet. Press and hold the chart to drop one.';
}

const emptyMessage = $derived(emptyText(loadState, waypoints.length > 0));

function chooseSort(key: NavSortKey): void {
  sortTouched = true;
  sortState = toggleSort(sortState, key);
}

function locate(waypoint: Waypoint): void {
  onLocate(waypoint);
  minimize.collapse();
}

function confirmNavigation(): void {
  const waypoint = confirmingNavigate;
  confirmingNavigate = undefined;
  if (!waypoint || navigationDisabled) return;
  onGoTo?.(waypoint);
}

// Before the navigator chooses a sort, follow GPS availability: nearest first as soon as a fresh fix
// arrives, and name first if the fix is absent or stale. An explicit sort choice is never overridden.
$effect(() => {
  if (sortTouched) return;
  const next = defaultNavSort(vesselPosition !== undefined);
  if (sortState.key !== next.key || sortState.dir !== next.dir) sortState = next;
});

// A search, a refresh, or the render cap can hide the card whose confirm is open. Close the confirm
// with its card, so clearing the search never brings back a confirm the navigator did not just arm.
$effect(() => {
  const armed = confirmingNavigate;
  if (armed && !rows.some((row) => row.id === armed.id)) confirmingNavigate = undefined;
  if (!rows.some((row) => armedDelete.isArmed(row.id))) armedDelete.cancel();
});
</script>

<SlideOver
  title="Waypoints"
  closeLabel="Close waypoints panel"
  bodyFlex
  {onClose}
  {onBack}
  {minimize}
>
  {#if auth.writeBlocked}
    <p class="muted-note" role="status">
      A write token is needed to add, edit, or delete waypoints. Request a read/write token to
      continue.
    </p>
  {/if}

  <p class="muted-note">
    Press and hold, right-click, or use Shift+F10 on the chart to drop a waypoint.
  </p>

  {#if loadState === 'error'}
    <p class="alert-note" role="alert">
      {waypoints.length > 0
        ? 'Could not refresh waypoints. Showing the last loaded waypoints.'
        : 'Could not load waypoints. Check the connection, then retry.'}
    </p>
    <button type="button" class="btn btn-ghost" onclick={onRetry}>Retry waypoints</button>
  {:else if loadState === 'loading' && waypoints.length > 0}
    <p class="muted-note" role="status">Refreshing waypoints…</p>
  {/if}

  {#if waypoints.length > 0 && vesselPosition === undefined}
    <p class="muted-note" role="status">
      Distance and bearing need a fresh GPS fix. Waypoints are sorted by name until one arrives.
    </p>
  {/if}

  <!-- No marks means nothing to search or order, so the controls stay out of the empty locker. -->
  {#if waypoints.length > 0}
    <input
      class="input search-input"
      type="search"
      placeholder="Search name or description"
      aria-label="Search waypoints by name or description"
      bind:value={query}
    >
    <NavSortControl
      sorts={SORTS}
      state={sortState}
      onChoose={chooseSort}
      ariaLabel="Sort waypoints by"
    />
  {/if}

  <SavedList heading="Saved waypoints" items={rows} empty={emptyMessage} key={(row) => row.id}>
    {#snippet card(row)}
      {@const waypoint = row.waypoint}
      <div class="card-head">
        <button
          type="button"
          class="name"
          title="Show this waypoint on the chart"
          onclick={() => locate(waypoint)}
        >
          {waypoint.name}
        </button>
      </div>
      <dl class="card-stats">
        <dt class="caps-label">Position</dt>
        <dd>
          <span class="num">
            {formatLatitude(waypoint.position.latitude)}
            {formatLongitude(waypoint.position.longitude)}
          </span>
        </dd>
        <dt class="caps-label">Distance</dt>
        <dd>
          <span class="num">{formatMetersOrNm(row.distanceMeters, units.mode)}</span>
        </dd>
        <dt class="caps-label">Bearing</dt>
        <dd title="Bearing in degrees true">
          <span class="num">
            {row.bearingRad === undefined ? '--' : `${formatBearingOr(row.bearingRad)}°T`}
          </span>
        </dd>
      </dl>
      {#if waypoint.description}
        <p class="description">{waypoint.description}</p>
      {/if}
      {#if confirmingNavigate?.id === waypoint.id}
        <InlineConfirm
          question={`Start navigation to ${waypoint.name}? Check the destination before relying on it.`}
          confirmLabel="Start navigation"
          onConfirm={confirmNavigation}
          onCancel={() => (confirmingNavigate = undefined)}
        />
      {:else if armedDelete.isArmed(waypoint.id)}
        <InlineConfirm
          question="Delete this waypoint?"
          onConfirm={() => armedDelete.confirm(waypoint.id)}
          onCancel={() => armedDelete.cancel()}
        />
      {:else}
        <div class="actions">
          {#if onGoTo}
            <button
              type="button"
              class="icon-btn"
              aria-label="Navigate to waypoint"
              title="Start navigating to this waypoint"
              onclick={() => (confirmingNavigate = waypoint)}
              disabled={navigationDisabled}
            >
              <Navigation size={18} aria-hidden="true" />
            </button>
          {/if}
          <button
            type="button"
            class="icon-btn"
            aria-label="Edit waypoint"
            title="Edit"
            onclick={() => onEdit(waypoint)}
            disabled={writesDisabled}
          >
            <SquarePen size={18} aria-hidden="true" />
          </button>
          <button
            type="button"
            class="icon-btn icon-btn--danger"
            aria-label="Delete waypoint"
            title="Delete"
            onclick={() => armedDelete.arm(waypoint.id)}
            disabled={writesDisabled}
          >
            <Trash2 size={18} aria-hidden="true" />
          </button>
        </div>
      {/if}
    {/snippet}
  </SavedList>

  {#if allRows.length > MAX_NAV_ROWS}
    <p class="muted-note" role="status">
      Showing the first {MAX_NAV_ROWS} of {allRows.length} matches. Search to narrow the results.
    </p>
  {/if}
  {#if waypoints.length === MAX_WAYPOINTS}
    <p class="muted-note" role="status">
      The panel accepts at most {MAX_WAYPOINTS.toLocaleString('en')} waypoints from the server. More
      may exist; delete unused marks to make room.
    </p>
  {/if}
</SlideOver>

<style>
/* The card list, wrapper, stats, and actions come from the shared SavedList plus the global .saved
   system in app.css, and the search field and sort header from the global .search-input and .nav-sort
   classes; only the optional description line is Waypoints-specific. */
.description {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--text-muted);
  overflow-wrap: anywhere;
}
/* The tappable name is the locate action; the box, button reset, and the hover-to-accent
   interactivity come from the global .saved button.name rule. */
</style>
