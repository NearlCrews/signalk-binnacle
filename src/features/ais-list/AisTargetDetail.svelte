<script lang="ts">
import Crosshair from '@lucide/svelte/icons/crosshair';
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
import { SlideOver } from '$shared/ui';
import type { AisListRow } from './ais-rows';

interface Props {
  // The row is recomputed live as the target moves, so the panel reads current data for as long
  // as it stays open rather than a snapshot from the moment it was opened.
  row: AisListRow;
  units: UnitsStore;
  onClose: () => void;
  onLocate: (position: LatLon) => void;
}

const { row, units, onClose, onLocate }: Props = $props();
</script>

<SlideOver
  dock="right"
  title={row.label}
  subtitle={row.navigationState ? capitalize(row.navigationState) : undefined}
  ariaLabel="Details for {row.label}"
  closeLabel="Close target details"
  {onClose}
  bodyFlex
>
  <button type="button" class="btn btn-ghost locate" onclick={() => onLocate(row.position)}>
    <Crosshair size={16} aria-hidden="true" />
    Show on chart
  </button>
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
        <dt>AIS ship type</dt>
        <dd>{row.shipTypeId}</dd>
      </div>
    {/if}
    {#if row.cpaMeters !== undefined}
      <div class="item">
        <dt>CPA</dt>
        <dd>{formatNm(row.cpaMeters)} nm</dd>
      </div>
    {/if}
    {#if row.tcpaSeconds !== undefined}
      <div class="item">
        <dt>TCPA</dt>
        <dd>{formatTcpaMin(row.tcpaSeconds, 1)} min</dd>
      </div>
    {/if}
  </dl>
</SlideOver>

<style>
/* The locate action sits at the top of the body as a compact button, not stretched full width. */
.locate {
  align-self: flex-start;
}
</style>
