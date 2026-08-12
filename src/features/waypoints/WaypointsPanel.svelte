<script lang="ts">
import Navigation from '@lucide/svelte/icons/navigation';
import SquarePen from '@lucide/svelte/icons/square-pen';
import Trash2 from '@lucide/svelte/icons/trash-2';
import type { UnitsStore } from '$entities/units';
import type { OwnVessel } from '$entities/vessel';
import type { Waypoint } from '$entities/waypoint';
import { formatBearingOr, formatLatitude, formatLongitude, formatMetersOrNm } from '$shared/lib';
import {
  defaultNavSort,
  MAX_NAV_ROWS,
  type NavSortKey,
  type NavSortState,
  toggleSort,
} from '$shared/nav';
import { type AuthController, resourcesProviderNote } from '$shared/signalk';
import {
  ArmedRow,
  createPanelMinimize,
  InlineConfirm,
  NavSortControl,
  SavedList,
  SearchInput,
  SlideOver,
  WriteAccessNote,
} from '$shared/ui';
import type { WaypointLoadState, WaypointsProvisioning } from './waypoint-controller.svelte';
import { filterWaypointRows, sortWaypointRows, toWaypointRows } from './waypoint-rows';
import { MAX_WAYPOINTS } from './waypoints-client';

interface Props {
  auth: AuthController;
  waypoints: Waypoint[];
  vessel: OwnVessel;
  units: UnitsStore;
  loadState: WaypointLoadState;
  // Whether the server has a waypoints provider at all, which is why a load can fail on a server
  // that is otherwise reachable and authorized.
  provisioning?: WaypointsProvisioning;
  busy: boolean;
  routeBusy: boolean;
  // The mark last tapped on the chart, so its card reads as the current one. Undefined when the
  // selection is cleared or its card is filtered out of the list.
  selectedId?: string;
  onRetry: () => void;
  // Pan the chart to the waypoint without changing anything else.
  onLocate: (waypoint: Waypoint) => void;
  // Arm the Course API destination at this waypoint; the action renders only when provided.
  onGoTo?: (waypoint: Waypoint) => void;
  // A waypoint just saved with "Save and navigate": open its navigation confirm once. The
  // destination is still named in that confirm, so the waypoints contract holds.
  armNavigateId?: string;
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
  provisioning = 'unknown',
  busy,
  routeBusy,
  selectedId,
  onRetry,
  onLocate,
  onGoTo,
  armNavigateId,
  onEdit,
  onDelete,
  onClose,
  onBack,
}: Props = $props();

const writesDisabled = $derived(auth.writeBlocked || busy);
const storageMissing = $derived(provisioning === 'unprovisioned');
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

const vesselPosition = $derived(vessel.coarsePosition);
// The metrics stage stands alone: computing rhumb distance and bearing for thousands of marks is
// the expensive part, and it depends only on the collection and the fix, so a keystroke in the
// search box or a sort tap re-runs just the cheap filter and sort below.
const metricRows = $derived(toWaypointRows(waypoints, vesselPosition));
const allRows = $derived(
  sortWaypointRows(filterWaypointRows(metricRows, query), sortState.key, sortState.dir),
);
const rows = $derived(allRows.slice(0, MAX_NAV_ROWS));

// A chart-selected waypoint must be visible even when the current search filters it out or the
// row cap cuts it off: pin it first, leaving the navigator's query and sort untouched so backing
// out restores the prior context.
const selectedRow = $derived(
  selectedId ? metricRows.find((row) => row.id === selectedId) : undefined,
);
const selectedPinned = $derived(
  selectedRow !== undefined && !rows.some((row) => row.id === selectedRow.id),
);
const displayRows = $derived(selectedPinned && selectedRow ? [selectedRow, ...rows] : rows);

// A chart selection also reveals a minimized panel: the tap asked to see the waypoint's details.
let lastSelectedId: string | undefined;
$effect(() => {
  if (selectedId && selectedId !== lastSelectedId) minimize.expand();
  lastSelectedId = selectedId;
});

// Arm the navigation confirm for a mark saved with "Save and navigate". Change-keyed rather than
// read once at mount: the panel does not remount when it was already open, and the arm must wait
// for the row to be renderable, or the confirm guard below cancels it on the same tick.
let lastArmedId: string | undefined;
$effect(() => {
  const id = armNavigateId;
  if (!id || id === lastArmedId) return;
  const row = displayRows.find((candidate) => candidate.id === id);
  if (!row) return;
  lastArmedId = id;
  const waypoint = waypoints.find((candidate) => candidate.id === id);
  if (waypoint) confirmingNavigate = waypoint;
});

const SORTS: { key: NavSortKey; label: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'distance', label: 'Distance' },
  { key: 'bearing', label: 'Bearing' },
];

// An empty card list means something different in each state: still reading, failed, filtered down
// to nothing, or genuinely nothing saved yet.
function emptyText(
  state: WaypointLoadState,
  hasWaypoints: boolean,
  missingStorage: boolean,
): string {
  if (state === 'loading') return 'Loading waypoints…';
  if (missingStorage) return 'Waypoints are unavailable until this server has waypoint storage.';
  if (state === 'error') return 'Waypoints are unavailable.';
  if (hasWaypoints) return 'No waypoints match your search. Clear it to see all saved waypoints.';
  return 'No waypoints yet. Press and hold the chart to drop one.';
}

const emptyMessage = $derived(emptyText(loadState, waypoints.length > 0, storageMissing));

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
  // The Locate idiom: once navigation starts, the chart and the new guidance strip are the point,
  // so the phone sheet stops covering both. Widths above phone ignore the collapse.
  minimize.collapse();
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
  // displayRows, not rows: a chart-selected or just-saved mark is pinned into view past the cap
  // and the current search, and its confirm must survive with it.
  if (armed && !displayRows.some((row) => row.id === armed.id)) confirmingNavigate = undefined;
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
    <WriteAccessNote
      message="This display has read-only access, so waypoints cannot be added, edited, or deleted. Request read and write access; the boat's Signal K admin approves it."
      requesting={auth.upgrading}
      onRequest={() => void auth.requestWriteAccess()}
      outcome={auth.upgradeOutcome}
    />
  {/if}

  <p class="muted-note">
    Press and hold, right-click, or use Shift+F10 on the chart to drop a waypoint.
  </p>

  {#if storageMissing}
    <!-- A stock server ships the Resources Provider disabled, so the first open fails for a
         reason no connection copy could name. The probe distinguishes the two. -->
    <p class="alert-note" role="alert">
      {resourcesProviderNote(
        'This Signal K server has no waypoint storage, so waypoints cannot be saved to it.',
        'enable waypoints under Resources',
      )}
    </p>
    <button type="button" class="btn btn-ghost" onclick={onRetry}>Check again</button>
  {:else if loadState === 'error'}
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
    <SearchInput
      bind:value={query}
      placeholder="Search name or description"
      ariaLabel="Search waypoints by name or description"
      clearLabel="Clear the waypoint search"
    />
    <NavSortControl
      sorts={SORTS}
      state={sortState}
      onChoose={chooseSort}
      ariaLabel="Sort waypoints by"
    />
  {/if}

  {#if selectedPinned}
    <p class="muted-note" role="status">
      The chart-selected waypoint is shown first. It does not match the current search, which is
      unchanged below.
    </p>
  {/if}
  <SavedList
    heading="Saved waypoints"
    items={displayRows}
    empty={emptyMessage}
    key={(row) => row.id}
    isActive={(row) => row.id === selectedId}
  >
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
   system in app.css, the search field from the shared SearchInput primitive, and the sort header from
   the global .nav-sort class; only the optional description line is Waypoints-specific. */
.description {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--text-muted);
  overflow-wrap: anywhere;
}
/* The tappable name is the locate action; the box, button reset, and the hover-to-accent
   interactivity come from the global .saved button.name rule. */
</style>
