<script lang="ts">
import type { UnitsStore } from '$entities/units';
import { formatBearingOr, formatDayClock, formatPrecipRateOr } from '$shared/lib';
import type { PointConditions } from './signalk-weather';
import {
  DEGREES_TRUE_TITLE,
  formatWholeKnots,
  precipUnitLabel,
  RAIN_VISIBLE_MM_H,
} from './weather-readout';

interface Props {
  forecast: PointConditions[];
  horizonH: number;
  units: UnitsStore;
}

const { forecast, horizonH, units }: Props = $props();

const precip = (v: number | undefined) => formatPrecipRateOr(v, units.mode);

function stepLabel(timeMs: number): string {
  return formatDayClock(timeMs, { minute: false });
}
</script>

<h4 class="caps-label forecast-head">Forecast · next {horizonH} h</h4>
<ul class="forecast bare-list">
  {#each forecast as step (step.timeMs)}
    <li>
      <span class="f-time">{stepLabel(step.timeMs)}</span>
      <span class="f-wind">
        <b class="num">{formatWholeKnots(step.windMs)}</b>
        kn from
        <span title={DEGREES_TRUE_TITLE}>{formatBearingOr(step.fromRad)}&deg;T</span>
      </span>
      {#if step.precipitationMm !== undefined && step.precipitationMm >= RAIN_VISIBLE_MM_H}
        <span class="f-rain">
          <b class="num">{precip(step.precipitationMm)}</b>
          {precipUnitLabel(step.precipIsRate, units.mode)}
        </span>
      {/if}
    </li>
  {/each}
</ul>

<style>
.forecast-head {
  margin: 0;
  padding-block-start: 0.4rem;
  border-block-start: 1px solid var(--border);
}
.forecast {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.forecast li {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  font-size: var(--text-sm);
}
.f-time {
  flex: 0 0 4.5rem;
  font-size: var(--text-xs);
  color: var(--text-muted);
}
.f-wind {
  flex: 1;
}
.f-rain {
  color: var(--text-muted);
  font-size: var(--text-xs);
}
</style>
