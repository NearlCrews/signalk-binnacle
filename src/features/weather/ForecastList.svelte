<script lang="ts">
import type { UnitsStore } from '$entities/units';
import {
  formatBearingOr,
  formatDayClock,
  formatLengthOr,
  formatMetersOrNm,
  formatPrecipRateOr,
  formatPressureOr,
  lengthUnit,
  pressureUnit,
} from '$shared/lib';
import type { PointConditions } from './signalk-weather';
import {
  DEGREES_TRUE_TITLE,
  formatWholeKnots,
  precipUnitLabel,
  provenanceLabel,
  RAIN_VISIBLE_MM_H,
} from './weather-readout';

interface Props {
  forecast: PointConditions[];
  horizonH: number;
  units: UnitsStore;
  // The weather provider's display name, when one is configured, so a row's source reads as the
  // provider rather than the internal provenance token.
  providerLabel?: string;
}

const { forecast, horizonH, units, providerLabel }: Props = $props();

const precip = (v: number | undefined) => formatPrecipRateOr(v, units.mode);
const hasRiskCues = $derived(forecast.some((step) => (step.riskCues?.length ?? 0) > 0));

function stepLabel(timeMs: number): string {
  return formatDayClock(timeMs, { minute: false });
}
</script>

{#snippet waveSpan(label: string, heightM: number | undefined)}
  {#if heightM !== undefined}
    <span
      >{label} <b class="num">{formatLengthOr(heightM, units.mode)}</b>
      {lengthUnit(units.mode)}</span
    >
  {/if}
{/snippet}

<h3 class="caps-label forecast-head">Forecast · next {horizonH} h</h3>
<ul class="forecast bare-list">
  {#each forecast as step, index (`${step.timeMs}:${index}`)}
    <li>
      <span class="f-time">{stepLabel(step.timeMs)}</span>
      <span class="f-details">
        {#if step.windMs !== undefined}
          <span class="f-wind">
            <b class="num">{formatWholeKnots(step.windMs)}</b>
            kn
            {#if step.fromRad !== undefined}
              from <span title={DEGREES_TRUE_TITLE}>{formatBearingOr(step.fromRad)}&deg;T</span>
            {/if}
            {#if step.gustMs !== undefined}
              · gust <b class="num">{formatWholeKnots(step.gustMs)}</b> kn
            {/if}
          </span>
        {/if}
        {#if step.pressurePa !== undefined}
          <span
            ><b class="num">{formatPressureOr(step.pressurePa, units.mode)}</b>
            {pressureUnit(units.mode)}</span
          >
        {/if}
        {@render waveSpan('Waves', step.waveHeightM)}
        {@render waveSpan('Wind waves', step.windWaveHeightM)}
        {@render waveSpan('Swell', step.swellHeightM)}
        {#if step.currentSpeedMs !== undefined}
          <span>Current <b class="num">{formatWholeKnots(step.currentSpeedMs)}</b> kn</span>
        {/if}
        {#if step.visibilityM !== undefined}
          <span
            >Visibility <b class="num">{formatMetersOrNm(step.visibilityM, units.mode)}</b></span
          >
        {/if}
        {#if step.precipitationMm !== undefined && step.precipitationMm >= RAIN_VISIBLE_MM_H}
          <span>
            {step.precipitationType ?? 'Precipitation'}
            <b class="num">{precip(step.precipitationMm)}</b>
            {precipUnitLabel(step.precipIsRate, units.mode)}
          </span>
        {/if}
        {#if step.riskCues}
          {#each step.riskCues as cue (cue)}
            <span
              class:sev-danger={cue === 'Storm-force wind'}
              class:sev-warning={cue !== 'Storm-force wind'}
              >{cue}</span
            >
          {/each}
        {/if}
        {#if step.provenance}
          <span class="f-source">{provenanceLabel(step.provenance, providerLabel)}</span>
        {/if}
      </span>
    </li>
  {/each}
</ul>
{#if hasRiskCues}
  <p class="muted-note risk-note">Model risk cues are guidance, not official warnings.</p>
{/if}

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
  align-items: start;
  gap: var(--space-2);
  font-size: var(--text-sm);
}
.f-time {
  flex: 0 0 4.5rem;
  font-size: var(--text-xs);
  color: var(--text-muted);
}
.f-details {
  display: flex;
  flex-wrap: wrap;
  gap: 0.1rem var(--space-2);
  flex: 1;
}
.f-details > span:not(.f-wind) {
  color: var(--text-muted);
  font-size: var(--text-xs);
}
.f-wind {
  flex-basis: 100%;
}
.f-source {
  margin-inline-start: auto;
}
.risk-note {
  margin: 0;
}
</style>
