<script lang="ts">
import type { UnitsStore } from '$entities/units';
import {
  formatBearingOr,
  formatDayClock,
  formatFixed,
  formatLengthOr,
  formatMetersOrNm,
  formatPercent,
  formatPrecipRateOr,
  formatPressureOr,
  formatTemperatureOr,
  lengthUnit,
  pressureUnit,
  temperatureUnit,
} from '$shared/lib';
import type { PointConditions } from './signalk-weather';
import {
  DEGREES_TRUE_TITLE,
  formatWholeKnots,
  precipUnitLabel,
  RAIN_VISIBLE_MM_H,
} from './weather-readout';

interface Props {
  current: PointConditions;
  observed: boolean;
  stale?: boolean;
  cached?: boolean;
  observationAgeMs?: number;
  tendencyText?: string;
  units: UnitsStore;
}

const {
  current,
  observed,
  stale = false,
  cached = false,
  observationAgeMs,
  tendencyText,
  units,
}: Props = $props();

const pressure = (v: number | undefined) => formatPressureOr(v, units.mode);
const temp = (v: number | undefined) => formatTemperatureOr(v, units.mode);
const height = (v: number | undefined) => formatLengthOr(v, units.mode);
const precip = (v: number | undefined) => formatPrecipRateOr(v, units.mode);

// The current block's valid time carries the zone (the formatDayClock rationale).
const validLabel = (timeMs: number): string => formatDayClock(timeMs, { zone: true });

function ageLabel(ageMs: number | undefined): string | undefined {
  if (ageMs === undefined) return undefined;
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${minutes % 60} min ago`;
}
</script>

<p class="cond-when">
  {observed ? 'Observed' : 'Forecast'}
  · {validLabel(current.timeMs)}
  {#if observed && ageLabel(observationAgeMs)}
    · {ageLabel(observationAgeMs)}
  {/if}
  {#if stale}
    · stale
  {/if}
  {#if cached}
    · cached, refresh failed
  {/if}
</p>
<dl class="now">
  {#if current.windMs !== undefined}
    <div>
      <dt>Wind</dt>
      <dd>
        <b class="num">{formatWholeKnots(current.windMs)}</b>
        kn
        {#if current.fromRad !== undefined}
          from <span title={DEGREES_TRUE_TITLE}>{formatBearingOr(current.fromRad)}&deg;T</span>
        {/if}
      </dd>
    </div>
  {/if}
  {#if current.gustMs !== undefined}
    <div>
      <dt>Gust</dt>
      <dd><b class="num">{formatWholeKnots(current.gustMs)}</b> kn</dd>
    </div>
  {/if}
  {#if current.pressurePa !== undefined}
    <div>
      <dt>Pressure</dt>
      <dd>
        <b class="num">{pressure(current.pressurePa)}</b>
        {pressureUnit(units.mode)}
        {#if tendencyText}
          <span class="trend">{tendencyText}</span>
        {:else}
          <span class="trend">trend unavailable</span>
        {/if}
      </dd>
    </div>
  {/if}
  {#if current.airTempK !== undefined}
    <div>
      <dt>Air</dt>
      <dd><b class="num">{temp(current.airTempK)}</b>{temperatureUnit(units.mode)}</dd>
    </div>
  {/if}
  {#if current.feelsLikeK !== undefined}
    <div>
      <dt>Feels like</dt>
      <dd><b class="num">{temp(current.feelsLikeK)}</b>{temperatureUnit(units.mode)}</dd>
    </div>
  {/if}
  {#if current.dewPointK !== undefined}
    <div>
      <dt>Dew point</dt>
      <dd><b class="num">{temp(current.dewPointK)}</b>{temperatureUnit(units.mode)}</dd>
    </div>
  {/if}
  {#if current.humidityFraction !== undefined}
    <div>
      <dt>Humidity</dt>
      <dd><b class="num">{formatPercent(current.humidityFraction)}</b>%</dd>
    </div>
  {/if}
  {#if current.waterTempK !== undefined}
    <div>
      <dt>Water</dt>
      <dd><b class="num">{temp(current.waterTempK)}</b>{temperatureUnit(units.mode)}</dd>
    </div>
  {/if}
  {#if current.visibilityM !== undefined}
    <div>
      <dt>Visibility</dt>
      <dd><b class="num">{formatMetersOrNm(current.visibilityM, units.mode)}</b></dd>
    </div>
  {/if}
  {#if current.cloudFraction !== undefined}
    <div>
      <dt>Cloud</dt>
      <dd><b class="num">{formatPercent(current.cloudFraction)}</b>%</dd>
    </div>
  {/if}
  {#snippet waveBlock(label: string, heightM: number, periodS: number | undefined, fromRad: number | undefined)}
    <div>
      <dt>{label}</dt>
      <dd>
        <b class="num">{height(heightM)}</b>
        {lengthUnit(units.mode)}
        {#if periodS !== undefined}
          /
          <span title="Wave period: seconds between crests"
            ><b class="num">{formatFixed(periodS, 1)}</b>
            s</span
          >
        {/if}
        {#if fromRad !== undefined}
          from
          <span title={DEGREES_TRUE_TITLE}>{formatBearingOr(fromRad)}&deg;T</span>
        {/if}
      </dd>
    </div>
  {/snippet}
  {#if current.waveHeightM !== undefined}
    {@render waveBlock('Waves', current.waveHeightM, current.wavePeriodS, current.waveFromRad)}
  {/if}
  {#if current.windWaveHeightM !== undefined}
    {@render waveBlock('Wind waves', current.windWaveHeightM, current.windWavePeriodS, current.windWaveFromRad)}
  {/if}
  {#if current.swellHeightM !== undefined}
    {@render waveBlock('Swell', current.swellHeightM, current.swellPeriodS, current.swellFromRad)}
  {/if}
  {#if current.currentSpeedMs !== undefined}
    <div>
      <dt>Current</dt>
      <dd>
        <b class="num">{formatWholeKnots(current.currentSpeedMs)}</b>
        kn
        {#if current.currentDirectionRad !== undefined}
          toward
          <span title={DEGREES_TRUE_TITLE}
            >{formatBearingOr(current.currentDirectionRad)}&deg;T</span
          >
        {/if}
      </dd>
    </div>
  {/if}
  {#if current.precipitationMm !== undefined && current.precipitationMm >= RAIN_VISIBLE_MM_H}
    <div>
      <dt>{current.precipitationType ?? 'Precipitation'}</dt>
      <dd>
        <b class="num">{precip(current.precipitationMm)}</b>
        {precipUnitLabel(current.precipIsRate, units.mode)}
      </dd>
    </div>
  {/if}
  {#if current.uvIndex !== undefined}
    <div>
      <dt>UV index</dt>
      <dd><b class="num">{formatFixed(current.uvIndex, 1)}</b></dd>
    </div>
  {/if}
  {#if current.sunriseMs !== undefined}
    <div>
      <dt>Sunrise</dt>
      <dd><b class="num">{formatDayClock(current.sunriseMs)}</b></dd>
    </div>
  {/if}
  {#if current.sunsetMs !== undefined}
    <div>
      <dt>Sunset</dt>
      <dd><b class="num">{formatDayClock(current.sunsetMs)}</b></dd>
    </div>
  {/if}
</dl>

<style>
/* Whether the block is an observation or model output, and for when: forecast data styled as
   present conditions misleads. */
.cond-when {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--text-muted);
}
.now {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.3rem 0.6rem;
  margin: 0;
}
.now div {
  display: flex;
  flex-direction: column;
}
.now dt {
  font-size: var(--text-xs);
  color: var(--text-muted);
}
.now dd {
  margin: 0;
  font-size: var(--text-sm);
}
/* The current-conditions values are the panel's hero numbers, so they step up over their caps labels
   and the unit text, the instrument-readout gesture. */
.now b {
  font-size: var(--text-lg);
}
.trend {
  display: block;
  font-size: var(--text-xs);
  color: var(--text-muted);
}
</style>
