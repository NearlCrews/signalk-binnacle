<script lang="ts">
import Crosshair from '@lucide/svelte/icons/crosshair';
import { aisShipTypeLabel } from '$entities/ais';
import type { UnitsStore } from '$entities/units';
import type { LatLon } from '$shared/geo';
import {
  capitalize,
  formatBearingOr,
  formatClockTime,
  formatLatitude,
  formatLengthOr,
  formatLongitude,
  formatMetersOrNm,
  formatMonthDay,
  formatNm,
  formatSpeedOr,
  formatTcpaMin,
  lengthUnit,
  speedUnit,
} from '$shared/lib';
import type { ConnectionPhase } from '$shared/signalk';
import { SubViewHeader } from '$shared/ui';
import AisStreamNote from './AisStreamNote.svelte';
import { type AisListRow, aisKindLabel } from './ais-rows';

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

const kindTag = $derived(aisKindLabel(row.kind));
</script>

<SubViewHeader title={row.label} backLabel="Back to nearby vessels" {onBack} />
<AisStreamNote {connectionPhase} />
{#if kindTag}
  <p class="caps-label">{kindTag}{row.virtual ? ' (virtual)' : ''}</p>
{/if}
{#if row.navigationState}
  <p class="caps-label">{capitalize(row.navigationState)}</p>
{/if}
{#if row.offPosition}
  <!-- A floating aid reporting itself off station is a hazard cue, announced with the same urgency
    as the collision banners below. -->
  <p class="alert-note" role="alert">
    Off position. This floating aid reports it is off its charted position, so do not rely on it
    marking the charted spot.
  </p>
{:else if row.virtual}
  <p class="muted-note">
    Virtual aid: broadcast only, with no physical structure at this position.
  </p>
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
    {#if row.aisClass}
      <div class="item">
        <dt>AIS class</dt>
        <dd>{row.aisClass}</dd>
      </div>
    {/if}
    {#if row.atonType}
      <div class="item">
        <dt>Aid type</dt>
        <dd>{row.atonType}</dd>
      </div>
    {/if}
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
    {#if row.kind !== 'aton'}
      <div class="item">
        <dt>Speed</dt>
        <dd>{formatSpeedOr(row.sogMps, units.profile)} {speedUnit(units.profile)}</dd>
      </div>
    {/if}
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
    {#if row.lengthMeters !== undefined}
      <div class="item">
        <dt>Size</dt>
        <dd>
          {formatLengthOr(row.lengthMeters, units.profile, 0)}
          {#if row.beamMeters !== undefined}
            by {formatLengthOr(row.beamMeters, units.profile, 0)}
          {/if}
          {lengthUnit(units.profile)}
        </dd>
      </div>
    {/if}
    {#if row.destination}
      <div class="item">
        <dt>Destination</dt>
        <dd>{row.destination}</dd>
      </div>
    {/if}
    {#if row.destinationEtaMs !== undefined}
      <div class="item">
        <dt>Reported ETA</dt>
        <dd>{formatMonthDay(row.destinationEtaMs)}, {formatClockTime(row.destinationEtaMs)}</dd>
      </div>
    {/if}
    {#if row.cpaMeters !== undefined}
      <div class="item">
        <dt>Closest pass (CPA)</dt>
        <dd>{formatNm(row.cpaMeters)} nm</dd>
      </div>
    {/if}
    {#if row.receding}
      <div class="item">
        <dt>Time to closest (TCPA)</dt>
        <dd>past closest approach</dd>
      </div>
    {:else if row.tcpaSeconds !== undefined}
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
        : row.unassessedReason === 'own-fix-lost'
          ? 'CPA is unavailable because this boat has no fresh GPS fix, so no target can be assessed for collision. Assessment resumes automatically when the fix returns.'
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
