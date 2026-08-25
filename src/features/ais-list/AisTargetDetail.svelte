<script lang="ts">
import Crosshair from '@lucide/svelte/icons/crosshair';
import { aisShipTypeLabel } from '$entities/ais';
import type { UnitsStore } from '$entities/units';
import type { LatLon } from '$shared/geo';
import {
  capitalize,
  formatBearingOr,
  formatKnotsOr,
  formatLatitude,
  formatLongitude,
  formatMetersOrNm,
  formatNm,
  formatTcpaMin,
} from '$shared/lib';
import type { ConnectionPhase } from '$shared/signalk';
import { SubViewHeader } from '$shared/ui';
import AisStreamNote from './AisStreamNote.svelte';
import type { AisListRow } from './ais-rows';

interface Props {
  // The row is recomputed live as the target moves, so the panel reads current data for as long
  // as it stays open rather than a snapshot from the moment it was opened.
  row: AisListRow;
  units: UnitsStore;
  connectionPhase: ConnectionPhase;
  onBack: () => void;
  onLocate: (position: LatLon) => void;
}

const { row, units, connectionPhase, onBack, onLocate }: Props = $props();
</script>

<SubViewHeader title={row.label} backLabel="Back to nearby vessels" {onBack} />
<AisStreamNote {connectionPhase} />
{#if row.navigationState}
  <p class="caps-label">{capitalize(row.navigationState)}</p>
{/if}
<!-- Safety state the server raised, not a response to anything the navigator did here, so it is
  announced as an alert to match the alarm styling a sighted navigator sees. -->
{#if row.severity === 'danger'}
  <p class="alert-note alert-note--filled" role="alert">
    Collision risk. Review the closest pass and time to closest values below.
  </p>
{:else if row.severity === 'warning'}
  <p class="alert-note" role="alert">
    Getting close. Continue monitoring this target and the surrounding traffic.
  </p>
{/if}
<section class="panel-section" aria-label="Target actions">
  <button type="button" class="btn btn-ghost locate" onclick={() => onLocate(row.position)}>
    <Crosshair size={16} aria-hidden="true" />
    Show on chart
  </button>
</section>
<section class="panel-section" aria-label="Live target details">
  <h3 class="caps-label">Live target details</h3>
  <dl class="detail-list">
    <div class="item">
      <dt>Identifier</dt>
      <dd>{row.identifier}</dd>
    </div>
    <div class="item">
      <dt>Position</dt>
      <dd>
        {formatLatitude(row.position.latitude)}
        {formatLongitude(row.position.longitude)}
      </dd>
    </div>
    <div class="item">
      <dt>Distance</dt>
      <dd>{formatMetersOrNm(row.rangeMeters, units.mode)}</dd>
    </div>
    <div class="item">
      <dt>Bearing</dt>
      <dd>{formatBearingOr(row.bearingRad)}&deg;T</dd>
    </div>
    <div class="item">
      <dt>Speed</dt>
      <dd>{formatKnotsOr(row.sogMps)} kn</dd>
    </div>
    {#if row.cogRad !== undefined}
      <div class="item">
        <dt>Course</dt>
        <dd>{formatBearingOr(row.cogRad)}&deg;T</dd>
      </div>
    {/if}
    {#if row.headingRad !== undefined}
      <div class="item">
        <dt>Heading</dt>
        <dd>{formatBearingOr(row.headingRad)}&deg;T</dd>
      </div>
    {/if}
    {#if row.shipTypeId !== undefined}
      <div class="item">
        <dt>Ship type</dt>
        <dd>{aisShipTypeLabel(row.shipTypeId)} ({row.shipTypeId})</dd>
      </div>
    {/if}
    {#if row.cpaMeters !== undefined}
      <div class="item">
        <dt>Closest pass (CPA)</dt>
        <dd>{formatNm(row.cpaMeters)} nm</dd>
      </div>
    {/if}
    {#if row.tcpaSeconds !== undefined}
      <div class="item">
        <dt>Time to closest (TCPA)</dt>
        <dd>{formatTcpaMin(row.tcpaSeconds, 1)} min</dd>
      </div>
    {/if}
  </dl>
  {#if row.unassessedReason}
    <p class="alert-note" role="status">
      {row.unassessedReason === 'course-unavailable'
        ? 'CPA is unavailable because the target course is missing or stale. This vessel may be moving and cannot be assessed for collision; assessment resumes automatically when its course returns.'
        : 'CPA is unavailable because no fresh motion data has arrived from this target. It cannot be assessed for collision; assessment resumes automatically when motion data returns.'}
    </p>
  {/if}
</section>

<style>
/* The locate action sits at the top of the body as a compact button, not stretched full width. */
.locate {
  align-self: flex-start;
}
</style>
