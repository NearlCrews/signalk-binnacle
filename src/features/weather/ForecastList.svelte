<script lang="ts">
import type { UnitsStore } from '$entities/units';
import type { WeatherGrid } from '$entities/weather';
import {
  formatBearingOr,
  formatDayClock,
  formatLengthOr,
  formatMonthDay,
  formatPrecipRateOr,
  formatPressureOr,
  lengthUnit,
  metersOrNmParts,
  pressureUnit,
  speedUnit,
} from '$shared/lib';
import { Disclosure } from '$shared/ui';
import {
  type DayOutlook,
  dailyOutlook,
  gridOutlookSamples,
  outlookDayName,
  startOfLocalDay,
} from './daily-outlook';
import type { PointConditions } from './signalk-weather';
import {
  DEGREES_TRUE_TITLE,
  formatWholeSpeed,
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
  // The full-horizon grid and the vessel position ([lat, lon], the panel's parsed fix) feed the
  // day-grouped "Coming days" outlook past the hourly rows; without them the list stays
  // hourly-only.
  grid?: WeatherGrid;
  gridPosition?: [number, number];
}

const { forecast, horizonH, units, providerLabel, grid, gridPosition }: Props = $props();

const precip = (v: number | undefined) => formatPrecipRateOr(v, units.profile);
const speed = (v: number | undefined) => formatWholeSpeed(v, units.profile);
const isDangerCue = (cue: string) => cue === 'Storm-force wind';

// The local day the hourly rows end on, kept as a number so scrubbing within a day never
// re-samples the grid for the outlook below.
const afterDayMs = $derived(
  forecast.length > 0 ? startOfLocalDay(forecast[forecast.length - 1].timeMs) : undefined,
);
const outlook = $derived.by<DayOutlook[]>(() =>
  grid && gridPosition && afterDayMs !== undefined
    ? dailyOutlook(gridOutlookSamples(grid, gridPosition, afterDayMs), afterDayMs)
    : [],
);
const hasRiskCues = $derived(
  forecast.some((step) => (step.riskCues?.length ?? 0) > 0) ||
    outlook.some((day) => day.worstRiskCue !== undefined),
);

// The fields any hourly step carries: every row sets each of them in the same place, with a dash
// where a step lacks it, so the values line up down the list instead of shifting with each row.
const fields = $derived({
  pressure: forecast.some((step) => step.pressurePa !== undefined),
  waves: forecast.some((step) => step.waveHeightM !== undefined),
  windWaves: forecast.some((step) => step.windWaveHeightM !== undefined),
  swell: forecast.some((step) => step.swellHeightM !== undefined),
  current: forecast.some((step) => step.currentSpeedMs !== undefined),
  visibility: forecast.some((step) => step.visibilityM !== undefined),
  precip: forecast.some(
    (step) => step.precipitationMm !== undefined && step.precipitationMm >= RAIN_VISIBLE_MM_H,
  ),
});

function stepLabel(timeMs: number): string {
  return formatDayClock(timeMs, { minute: false });
}

function windRangeText(day: DayOutlook): string {
  const low = speed(day.windMinMs);
  const high = speed(day.windMaxMs);
  return low === high ? high : `${low}-${high}`;
}
</script>

{#snippet waveSpan(
  label: string,
  heightM: number | undefined,
)}
  <span
    >{label} <b class="num">{formatLengthOr(heightM, units.profile)}</b>
    {heightM === undefined ? '' : lengthUnit(units.profile)}</span
  >
{/snippet}

<h3 class="caps-label forecast-head">Forecast · next {horizonH} h</h3>
<ul class="forecast bare-list">
  {#each forecast as step, index (`${step.timeMs}:${index}`)}
    <li>
      <span class="f-time">{stepLabel(step.timeMs)}</span>
      <span class="f-details">
        {#if step.windMs !== undefined}
          <span class="f-wind">
            <b class="num">{speed(step.windMs)}</b>
            {speedUnit(units.profile)}
            {#if step.fromRad !== undefined}
              from <span title={DEGREES_TRUE_TITLE}>{formatBearingOr(step.fromRad)}&deg;T</span>
            {/if}
            {#if step.gustMs !== undefined}
              · gust <b class="num">{speed(step.gustMs)}</b> {speedUnit(units.profile)}
            {/if}
          </span>
        {/if}
        {#if fields.pressure}
          <span
            ><b class="num">{formatPressureOr(step.pressurePa, units.profile)}</b>
            {step.pressurePa === undefined ? '' : pressureUnit(units.profile)}</span
          >
        {/if}
        {#if fields.waves}
          {@render waveSpan('Waves', step.waveHeightM)}
        {/if}
        {#if fields.windWaves}
          {@render waveSpan('Wind waves', step.windWaveHeightM)}
        {/if}
        {#if fields.swell}
          {@render waveSpan('Swell', step.swellHeightM)}
        {/if}
        {#if fields.current}
          <span
            >Current <b class="num">{speed(step.currentSpeedMs)}</b>
            {step.currentSpeedMs === undefined ? '' : speedUnit(units.profile)}</span
          >
        {/if}
        {#if fields.visibility}
          {@const visibility = metersOrNmParts(step.visibilityM, units.profile)}
          <span>Visibility <b class="num">{visibility.value}</b> {visibility.unit}</span>
        {/if}
        {#if fields.precip}
          {#if step.precipitationMm !== undefined && step.precipitationMm >= RAIN_VISIBLE_MM_H}
            <span>
              {step.precipitationType ?? 'Precipitation'}
              <b class="num">{precip(step.precipitationMm)}</b>
              {precipUnitLabel(step.precipIsRate, units.profile)}
            </span>
          {:else}
            <span>Precipitation <b class="num">--</b></span>
          {/if}
        {/if}
        {#if step.riskCues}
          <span class="f-cues">
            {#each step.riskCues as cue (cue)}
              <span class:sev-danger={isDangerCue(cue)} class:sev-warning={!isDangerCue(cue)}
                >{cue}</span
              >
            {/each}
          </span>
        {/if}
        {#if step.provenance}
          <span class="f-source">{provenanceLabel(step.provenance, providerLabel)}</span>
        {/if}
      </span>
    </li>
  {/each}
</ul>
{#if outlook.length > 0}
  <Disclosure label="Coming days">
    <ul class="forecast bare-list">
      {#each outlook as day (day.dayStartMs)}
        <li>
          <span class="f-time"
            >{outlookDayName(day.dayStartMs)} {formatMonthDay(day.dayStartMs)}</span
          >
          <span class="f-details">
            {#if day.windMaxMs !== undefined}
              <span class="f-wind">
                <b class="num">{windRangeText(day)}</b>
                {speedUnit(units.profile)}
                {#if day.dominantFromRad !== undefined}
                  from
                  <span title={DEGREES_TRUE_TITLE}
                    >{formatBearingOr(day.dominantFromRad)}&deg;T</span
                  >
                {/if}
                {#if day.gustMaxMs !== undefined}
                  · gust <b class="num">{speed(day.gustMaxMs)}</b> {speedUnit(units.profile)}
                {/if}
              </span>
            {/if}
            {#if day.precipTotalMm !== undefined && day.precipTotalMm >= RAIN_VISIBLE_MM_H}
              <span
                >Precipitation <b class="num">{precip(day.precipTotalMm)}</b>
                {precipUnitLabel(false, units.profile)}</span
              >
            {/if}
            {#if day.worstRiskCue}
              <span
                class:sev-danger={isDangerCue(day.worstRiskCue)}
                class:sev-warning={!isDangerCue(day.worstRiskCue)}
                >{day.worstRiskCue}</span
              >
            {/if}
          </span>
        </li>
      {/each}
    </ul>
  </Disclosure>
{/if}
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
/* The details are two equal columns: wind and its gust lead on their own line, every other field the
   forecast carries holds the same cell in every row, and risk cues and the source take their own
   lines, so a field never shifts from one row to the next. */
.f-details {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.1rem var(--space-2);
  flex: 1;
  min-inline-size: 0;
}
.f-details > span:not(.f-wind) {
  font-size: var(--text-xs);
}
.f-details > span:not(.f-wind, .sev-danger, .sev-warning) {
  color: var(--text-muted);
}
.f-wind,
.f-cues,
.f-source {
  grid-column: 1 / -1;
}
.f-cues {
  display: flex;
  flex-wrap: wrap;
  gap: 0 var(--space-2);
}
.f-source {
  justify-self: end;
}
.risk-note {
  margin: 0;
}
</style>
