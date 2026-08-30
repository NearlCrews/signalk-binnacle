<script lang="ts">
import { untrack } from 'svelte';
import type { AisTargets } from '$entities/ais';
import type { CollisionAssessment } from '$entities/collision';
import type { UnitsStore } from '$entities/units';
import type { OwnVessel } from '$entities/vessel';
import type { LatLon } from '$shared/geo';
import type { ReactiveClock } from '$shared/lib';
import {
  capitalize,
  formatBearingOr,
  formatMetersOrNm,
  formatNm,
  formatSpeedOr,
  formatTcpaMin,
  speedUnit,
} from '$shared/lib';
import type { ConnectionPhase } from '$shared/signalk';
import { SearchInput, SlideOver } from '$shared/ui';
import AisStreamNote from './AisStreamNote.svelte';
import AisTargetDetail from './AisTargetDetail.svelte';
import { type AisRiskFilter, type AisSort, buildAisRows, MAX_AIS_LIST_ROWS } from './ais-rows';

interface Props {
  aisTargets: AisTargets;
  vessel: OwnVessel;
  // The app-wide 1 Hz clock, which paces how often the rows are rebuilt.
  clock: ReactiveClock;
  collision: CollisionAssessment;
  units: UnitsStore;
  connectionPhase: ConnectionPhase;
  selectedId?: string;
  onSelect: (id: string | undefined) => void;
  // Fly the chart to a tapped target.
  onLocate: (position: LatLon) => void;
  onClose: () => void;
  onBack?: () => void;
}

const {
  aisTargets,
  vessel,
  clock,
  collision,
  units,
  connectionPhase,
  selectedId,
  onSelect,
  onLocate,
  onClose,
  onBack,
}: Props = $props();

let sort = $state<AisSort>('range');
let query = $state('');
let riskFilter = $state<AisRiskFilter>('all');

const SORTS: { id: AisSort; label: string }[] = [
  { id: 'range', label: 'Distance' },
  { id: 'cpa', label: 'CPA' },
  { id: 'name', label: 'Name' },
];
const RISK_FILTERS: { id: AisRiskFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'danger', label: 'Collision risks' },
  { id: 'warning', label: 'Getting close' },
];

const parsedOwn = $derived(vessel.coarsePosition);
// Traffic churn is coalesced to the shared 1 Hz floor rather than followed per worker flush. In a
// busy anchorage the store's version advances several times a second, and every advance would
// re-filter and re-sort hundreds of rows for a list a navigator glances at. The cadence comes from
// the app-wide clock, which already ticks at that interval, so this panel owns no timer of its own.
// The version is read inside untrack so only the tick drives it; the selected target below stays
// live, since one open detail row is cheap and should be current.
const targets = $derived.by(() => {
  void clock.now;
  return untrack(() => aisTargets.list());
});
const targetCount = $derived(targets.length);
const matchingRows = $derived(
  buildAisRows(
    targets,
    parsedOwn,
    collision.assessment.contacts,
    sort,
    query,
    riskFilter,
    collision.assessment.unassessed,
  ),
);
const rows = $derived(matchingRows.slice(0, MAX_AIS_LIST_ROWS));
const unassessedCount = $derived(collision.assessment.unassessed.length);
const selectedTarget = $derived(selectedId ? aisTargets.find(selectedId) : undefined);
const selectedRow = $derived(
  selectedTarget
    ? buildAisRows(
        [selectedTarget],
        parsedOwn,
        collision.assessment.contacts,
        sort,
        '',
        'all',
        collision.assessment.unassessed,
      )[0]
    : undefined,
);
const subtitle = $derived(
  query.trim() || riskFilter !== 'all'
    ? `${matchingRows.length} of ${targetCount} ${targetCount === 1 ? 'target' : 'targets'}`
    : `${targetCount} ${targetCount === 1 ? 'target' : 'targets'}`,
);

$effect(() => {
  if (selectedId && !selectedTarget) untrack(() => onSelect(undefined));
});
</script>

<SlideOver
  title="Nearby vessels (AIS)"
  {subtitle}
  closeLabel="Close nearby vessels"
  {onClose}
  onBack={selectedRow ? undefined : onBack}
  bodyFlex
>
  {#if selectedRow}
    <AisTargetDetail
      row={selectedRow}
      {units}
      {connectionPhase}
      onBack={() => onSelect(undefined)}
      {onLocate}
    />
  {:else}
    <AisStreamNote {connectionPhase} />
    <p class="muted-note">
      Other boats and navigation aids broadcasting over the automatic identification system (AIS).
      Search by name or Maritime Mobile Service Identity (MMSI), or tap a target on the chart.
    </p>
    {#if unassessedCount > 0}
      <p class="muted-note" role="status">
        Collision assessment is degraded: {unassessedCount}
        {unassessedCount === 1 ? 'target' : 'targets'}
        cannot be assessed because course or motion data is missing or stale. They are marked
        Unassessed below and never counted as clear.
      </p>
    {/if}
    {#if vessel.positionStale}
      <p class="muted-note" role="status">
        Own GPS fix is stale. Distance and bearing are unavailable, and the list is ordered by name
        until a fresh fix arrives.
      </p>
    {:else if !vessel.position}
      <p class="muted-note" role="status">
        Waiting for own GPS position. Distance and bearing are unavailable, and the list is ordered
        by name.
      </p>
    {/if}
    <SearchInput
      bind:value={query}
      placeholder="Search vessel name or MMSI"
      ariaLabel="Search nearby vessels by name or MMSI"
      clearLabel="Clear the vessel search"
    />
    <div class="nav-sort">
      <span class="caps-label">Risk filter</span>
      <div class="segmented" role="group" aria-label="Filter vessels by collision risk">
        {#each RISK_FILTERS as option (option.id)}
          <button
            type="button"
            class="btn"
            class:is-on={riskFilter === option.id}
            aria-pressed={riskFilter === option.id}
            onclick={() => (riskFilter = option.id)}
          >
            {option.label}
          </button>
        {/each}
      </div>
    </div>
    <div class="nav-sort">
      <span class="caps-label">Sort by</span>
      <div class="segmented" role="group" aria-label="Sort vessels by">
        {#each SORTS as option (option.id)}
          <button
            type="button"
            class="btn"
            class:is-on={sort === option.id}
            aria-pressed={sort === option.id}
            disabled={option.id === 'range' && !parsedOwn}
            onclick={() => (sort = option.id)}
          >
            {option.label}
          </button>
        {/each}
      </div>
    </div>
    {#if rows.length === 0}
      <p class="muted-note" role="status">
        {targetCount > 0
          ? 'No vessels match the current search and risk filter. Clear the search or choose All.'
          : connectionPhase === 'open'
            ? 'No AIS targets are available right now. This list fills as traffic is received.'
            : connectionPhase === 'connecting'
              ? 'Connecting to Signal K. AIS targets will appear when the stream opens.'
              : 'No AIS targets were received before the stream dropped.'}
      </p>
    {:else}
      <ul class="nav-list bare-list" aria-label="Nearby vessels">
        {#each rows as row (row.id)}
          <li>
            <button
              type="button"
              class="nav-row"
              title="Open the live detail for {row.label}"
              onclick={() => onSelect(row.id)}
            >
              <span class="nav-head">
                <span
                  class="nav-name"
                  class:sev-danger={row.severity === 'danger'}
                  class:sev-warning={row.severity === 'warning'}
                >
                  {row.label}
                </span>
                {#if row.severity === 'danger'}
                  <span class="caps-label sev-danger">Collision risk</span>
                {:else if row.severity === 'warning'}
                  <span class="caps-label sev-warning">Getting close</span>
                {:else if row.unassessedReason}
                  <span
                    class="caps-label sev-warning"
                    title={row.unassessedReason === 'course-unavailable'
                      ? 'CPA unavailable: the target course is missing or stale'
                      : 'CPA unavailable: no fresh motion data from this target'}
                  >
                    Unassessed
                  </span>
                {/if}
                {#if row.navigationState}
                  <span class="caps-label">{capitalize(row.navigationState)}</span>
                {/if}
              </span>
              <span class="nav-metrics">
                <span class="nav-metric">
                  Distance <b class="num">{formatMetersOrNm(row.rangeMeters, units.mode)}</b>
                </span>
                <span class="nav-metric" title="Bearing in degrees true"
                  >Bearing <b class="num">{formatBearingOr(row.bearingRad)}</b>&deg;T</span
                >
                <span class="nav-metric" title="Speed over ground"
                  >Speed <b class="num">{formatSpeedOr(row.sogMps, units.profile)}</b>
                  {speedUnit(units.profile)}</span
                >
                {#if row.headingRad !== undefined}
                  <span class="nav-metric" title="Heading, true"
                    >HDG <b class="num">{formatBearingOr(row.headingRad)}</b>&deg;T</span
                  >
                {/if}
                {#if row.cpaMeters !== undefined}
                  <span class="nav-metric" title="Closest point of approach"
                    >CPA <b class="num">{formatNm(row.cpaMeters)}</b> nm</span
                  >
                {/if}
                {#if row.tcpaSeconds !== undefined}
                  <span class="nav-metric" title="Time to closest point of approach"
                    >TCPA <b class="num">{formatTcpaMin(row.tcpaSeconds, 1)}</b> min</span
                  >
                {/if}
              </span>
            </button>
          </li>
        {/each}
      </ul>
      {#if matchingRows.length > MAX_AIS_LIST_ROWS}
        <p class="muted-note" role="status">
          Showing the first {MAX_AIS_LIST_ROWS} of {matchingRows.length} matches. Search or filter
          to narrow the results.
        </p>
      {/if}
    {/if}
  {/if}
</SlideOver>

<style>
/* The vessel name and its plain risk badge share a baseline row so the collision state is named in
   words next to the name, not conveyed by the name color alone. */
.nav-head {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
}
.nav-head .nav-name {
  flex: 1;
  min-inline-size: 0;
}
</style>
