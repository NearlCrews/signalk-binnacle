<script lang="ts">
import type { AisTargets } from '$entities/ais';
import type { CollisionAssessment } from '$entities/collision';
import type { UnitsStore } from '$entities/units';
import type { OwnVessel } from '$entities/vessel';
import { type LatLon, parseLatLonKey, quantizeLatLonKey } from '$shared/geo';
import {
  formatBearingOr,
  formatKnotsOr,
  formatMetersOrNm,
  formatNm,
  formatTcpaMin,
} from '$shared/lib';
import { SlideOver } from '$shared/ui';
import { type AisSort, buildAisRows } from './ais-rows';

interface Props {
  aisTargets: AisTargets;
  vessel: OwnVessel;
  collision: CollisionAssessment;
  units: UnitsStore;
  // Fly the chart to a tapped target.
  onLocate: (position: LatLon) => void;
  onClose: () => void;
  onBack?: () => void;
}

const { aisTargets, vessel, collision, units, onLocate, onClose, onBack }: Props = $props();

let sort = $state<AisSort>('range');

const SORTS: { id: AisSort; label: string }[] = [
  { id: 'range', label: 'Distance' },
  { id: 'cpa', label: 'Closest' },
  { id: 'name', label: 'Name' },
];

// The own fix is quantized to about 110 m before it reaches buildAisRows, so a 1 Hz GPS jitter does
// not recompute the range and bearing of every target on every tick; the list does not need finer.
// The key is a string so the derived halts when the rounded cell is unchanged, then parsedOwn (and
// the rows below) only recompute when the cell, the traffic, the risks, or the sort actually change.
const ownCellKey = $derived(vessel.position ? quantizeLatLonKey(vessel.position) : '');
const parsedOwn = $derived<LatLon | undefined>(
  ownCellKey
    ? (() => {
        const { lat, lon } = parseLatLonKey(ownCellKey);
        return { latitude: lat, longitude: lon };
      })()
    : undefined,
);
// list() reads aisVersion, so the rows re-derive as traffic moves; the own cell re-sorts by range.
const rows = $derived(
  buildAisRows(aisTargets.list(), parsedOwn, collision.assessment.contacts, sort),
);
</script>

<SlideOver
  title="Nearby vessels (AIS)"
  subtitle="{rows.length} nearby"
  closeLabel="Close nearby vessels"
  {onClose}
  {onBack}
  bodyFlex
>
  <p class="muted-note">
    Other boats and navigation aids broadcasting their position over AIS. The nearest show first.
  </p>
  <div class="nav-sort">
    <span class="caps-label">Sort by</span>
    <div class="segmented" role="group" aria-label="Sort vessels by">
      {#each SORTS as option (option.id)}
        <button
          type="button"
          class="btn"
          class:is-on={sort === option.id}
          aria-pressed={sort === option.id}
          onclick={() => (sort = option.id)}
        >
          {option.label}
        </button>
      {/each}
    </div>
  </div>
  {#if rows.length === 0}
    <p class="muted-note" role="status">
      No vessels are broadcasting nearby right now. This list fills as AIS traffic comes into range.
    </p>
  {:else}
    <ul class="nav-list bare-list" aria-label="Nearby vessels">
      {#each rows as row (row.id)}
        <li>
          <button
            type="button"
            class="nav-row"
            title="Show {row.label} on the chart"
            onclick={() => onLocate(row.position)}
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
              {#if row.cpaMeters !== undefined}
                <span class="nav-metric" title="Closest point of approach"
                  >Closest <b class="num">{formatNm(row.cpaMeters)}</b> nm</span
                >
              {/if}
              {#if row.tcpaSeconds !== undefined}
                <span class="nav-metric" title="Time to closest point of approach"
                  >Time to closest <b class="num">{formatTcpaMin(row.tcpaSeconds, 1)}</b> min</span
                >
              {/if}
            </span>
          </button>
        </li>
      {/each}
    </ul>
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
