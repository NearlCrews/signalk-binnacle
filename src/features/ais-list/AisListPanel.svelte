<script lang="ts">
import { untrack } from 'svelte';
import type { AisTargets } from '$entities/ais';
import type { CollisionAssessment } from '$entities/collision';
import type { UnitsStore } from '$entities/units';
import type { OwnVessel } from '$entities/vessel';
import { type LatLon, parseLatLonKey, quantizeLatLonKey } from '$shared/geo';
import {
  capitalize,
  formatBearingOr,
  formatKnotsOr,
  formatMetersOrNm,
  formatNm,
  formatTcpaMin,
} from '$shared/lib';
import type { ConnectionPhase } from '$shared/signalk';
import { SlideOver } from '$shared/ui';
import AisTargetDetail from './AisTargetDetail.svelte';
import { type AisSort, buildAisRows, MAX_AIS_LIST_ROWS } from './ais-rows';

interface Props {
  aisTargets: AisTargets;
  vessel: OwnVessel;
  collision: CollisionAssessment;
  units: UnitsStore;
  connectionPhase: ConnectionPhase;
  // Fly the chart to a tapped target.
  onLocate: (position: LatLon) => void;
  onClose: () => void;
  onBack?: () => void;
}

const { aisTargets, vessel, collision, units, connectionPhase, onLocate, onClose, onBack }: Props =
  $props();

// The row is recomputed live from rows below on every rebuild, so the detail panel stays live
// while a target moves instead of freezing at the moment it was opened.
let selectedId = $state<string | undefined>();

let sort = $state<AisSort>('range');

const SORTS: { id: AisSort; label: string }[] = [
  { id: 'range', label: 'Distance' },
  { id: 'cpa', label: 'CPA' },
  { id: 'name', label: 'Name' },
];

// The own fix is quantized to about 110 m before it reaches buildAisRows, so a 1 Hz GPS jitter does
// not recompute the range and bearing of every target on every tick; the list does not need finer.
// The key is a string so the derived halts when the rounded cell is unchanged, then parsedOwn (and
// the rows below) only recompute when the cell, the traffic, the risks, or the sort actually change.
const ownCellKey = $derived(
  vessel.position && !vessel.positionStale ? quantizeLatLonKey(vessel.position) : '',
);
const parsedOwn = $derived<LatLon | undefined>(ownCellKey ? parseLatLonKey(ownCellKey) : undefined);
// list() reads aisVersion, so the rows re-derive as traffic moves; the own cell re-sorts by range.
const targetCount = $derived(aisTargets.list().length);
const rows = $derived(
  buildAisRows(aisTargets.list(), parsedOwn, collision.assessment.contacts, sort),
);
const selectedRow = $derived(rows.find((r) => r.id === selectedId));

$effect(() => {
  if (!parsedOwn && sort === 'range') untrack(() => (sort = 'name'));
});
</script>

<SlideOver
  title="Nearby vessels (AIS)"
  subtitle="{targetCount} {targetCount === 1 ? 'target' : 'targets'}"
  closeLabel="Close nearby vessels"
  {onClose}
  {onBack}
  bodyFlex
>
  <p class="muted-note">
    Other boats and navigation aids broadcasting their position over AIS. The nearest show first.
  </p>
  {#if vessel.positionStale}
    <p class="muted-note" role="status">
      Own GPS fix is stale. Distance and bearing are unavailable until a fresh fix arrives.
    </p>
  {:else if !vessel.position}
    <p class="muted-note" role="status">
      Waiting for own GPS position. Distance and bearing are unavailable.
    </p>
  {/if}
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
      {connectionPhase === 'open'
        ? 'No AIS targets are available right now. This list fills as traffic is received.'
        : connectionPhase === 'connecting'
          ? 'Connecting to Signal K. AIS targets will appear when the stream opens.'
          : 'Signal K is disconnected. AIS targets may be unavailable or stale.'}
    </p>
  {:else}
    {#if targetCount > MAX_AIS_LIST_ROWS}
      <p class="muted-note" role="status">
        Showing the first {MAX_AIS_LIST_ROWS} targets in the selected order.
      </p>
    {/if}
    <ul class="nav-list bare-list" aria-label="Nearby vessels">
      {#each rows as row (row.id)}
        <li>
          <button
            type="button"
            class="nav-row"
            title="{row.label} details"
            onclick={() => (selectedId = row.id)}
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
                >Speed <b class="num">{formatKnotsOr(row.sogMps)}</b> kn</span
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
  {/if}
</SlideOver>
{#if selectedRow}
  <AisTargetDetail row={selectedRow} {units} onClose={() => (selectedId = undefined)} {onLocate} />
{/if}

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
