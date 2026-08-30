import {
  bilinearAt,
  nearestAt,
  type TimeBracket,
  timeBracket,
  type WeatherGrid,
} from '$entities/weather';
import {
  formatFixed,
  formatPressureOr,
  formatSpeedOr,
  HOUR_MS,
  lerp,
  lerpAngle,
  PA_PER_HPA,
  precipRateUnit,
  pressureUnit,
  resolveUnits,
  type UnitsSelection,
} from '$shared/lib';
import { GRID_SOURCE_LABEL } from './fills';
import type { PointConditions } from './signalk-weather';

// Wind speed as a whole number in the preference's speed unit (no decimals), the shared readout
// format for the conditions block and the forecast rows.
export function formatWholeSpeed(speedMs: number | undefined, units: UnitsSelection): string {
  return formatSpeedOr(speedMs, units, 0);
}

// The tooltip on every true-bearing readout (wind and wave direction), defined once so the conditions
// block and the forecast rows cannot describe the same convention differently.
export const DEGREES_TRUE_TITLE = 'Degrees true, measured clockwise from true north';

// The smallest precipitation worth showing in a readout: a trace below this rounds to nothing.
// 0.1 reads as mm/h for the free grid's rate and as mm for a provider's accumulation volume; the
// same tenth-of-a-millimeter floor is a sensible trace cutoff for both, so one constant gates both.
export const RAIN_VISIBLE_MM_H = 0.1;

// The unit label beside a precipitation value: the rate unit for the free grid's mm/h, the bare
// amount unit for a provider's accumulation volume. Defined once so the tap readout and the
// conditions panel cannot label the same value differently.
export function precipUnitLabel(isRate: boolean | undefined, units: UnitsSelection): string {
  if (isRate) return precipRateUnit(units);
  return resolveUnits(units).precip === 'in/h' ? 'in' : 'mm';
}

// The source name for a conditions row. 'provider' and 'mixed' are internal tokens and must never
// reach the panel as written, so the conditions block and the forecast rows resolve them here and
// cannot name the same source differently.
export function provenanceLabel(
  provenance: PointConditions['provenance'],
  providerLabel: string | undefined,
): string {
  if (provenance === 'mixed' && providerLabel) return `${providerLabel} + ${GRID_SOURCE_LABEL}`;
  if (provenance === 'provider') return providerLabel ?? GRID_SOURCE_LABEL;
  return GRID_SOURCE_LABEL;
}

// The magnitude of a pressure change with its unit, shared by the grid tendency text and the
// measured-aboard tendency so one delta cannot format two ways. A change needs finer precision
// than a spot reading, so the hectopascal-family units take one decimal here where formatPressureOr
// would round to whole; inHg and psi already carry decimals at their conventional precision.
export function pressureDeltaText(deltaPa: number, units: UnitsSelection): string {
  const unit = pressureUnit(units);
  const value =
    unit === 'hPa' || unit === 'mbar'
      ? formatFixed(Math.abs(deltaPa) / PA_PER_HPA, 1)
      : formatPressureOr(Math.abs(deltaPa), units);
  return `${value} ${unit}`;
}

export interface WeatherReadout {
  speedMs: number;
  fromRad: number; // meteorological direction the wind comes from, radians, 0..2pi
  gustMs?: number; // present only when the grid carries gusts
  pressurePa?: number; // present only when the grid carries pressure
  waveHeightM?: number; // present only when the grid carries waves
  wavePeriodS?: number;
  waveFromRad?: number; // direction the waves come from, radians, 0..2pi
  windWaveHeightM?: number;
  windWavePeriodS?: number;
  windWaveFromRad?: number;
  swellHeightM?: number;
  swellPeriodS?: number;
  swellFromRad?: number;
  currentSpeedMs?: number;
  currentDirectionRad?: number; // direction the current flows toward
  waterTempK?: number;
  precipitationMm?: number; // present only when the source carries precipitation
  // Whether precipitationMm is a rate (mm/h, the free grid) or an accumulation volume (mm, the
  // provider), carried in the data so every display labels it the same way.
  precipIsRate?: boolean;
  cloudCoverFraction?: number; // 0..1, present only when the grid carries cloud cover
  visibilityM?: number; // present only when the grid carries visibility
  weatherCode?: number; // WMO weather interpretation code, categorical, nearest-cell sampled
}

// One readout-to-conditions mapper shared by the current block and the forecast rows, so a field
// added to one (as gusts just were) cannot be forgotten in the other.
export function conditionsFromReadout(r: WeatherReadout, timeMs: number): PointConditions {
  return {
    timeMs,
    windMs: r.speedMs,
    fromRad: r.fromRad,
    gustMs: r.gustMs,
    pressurePa: r.pressurePa,
    cloudFraction: r.cloudCoverFraction,
    waveHeightM: r.waveHeightM,
    wavePeriodS: r.wavePeriodS,
    waveFromRad: r.waveFromRad,
    windWaveHeightM: r.windWaveHeightM,
    windWavePeriodS: r.windWavePeriodS,
    windWaveFromRad: r.windWaveFromRad,
    swellHeightM: r.swellHeightM,
    swellPeriodS: r.swellPeriodS,
    swellFromRad: r.swellFromRad,
    currentSpeedMs: r.currentSpeedMs,
    currentDirectionRad: r.currentDirectionRad,
    waterTempK: r.waterTempK,
    precipitationMm: r.precipitationMm,
    precipIsRate: r.precipIsRate,
    visibilityM: r.visibilityM,
    weatherCode: r.weatherCode,
  };
}

// Wind speed, from-direction, and (when present) the other fields at a lon/lat for one forecast
// step. Values are SI; the display converts at its edge.
export function readoutAt(
  grid: WeatherGrid,
  lon: number,
  lat: number,
  timeIndex: number,
): WeatherReadout | undefined {
  return readoutAtBracket(grid, lon, lat, { lo: timeIndex, hi: timeIndex, frac: 0 });
}

// The readout at a time BRACKET, blending the two bracketing steps by the fraction, exactly as the
// drawn overlays do. Sampling only the lower step made the tapped number disagree with the picture
// under the finger by up to a full forecast step.
export function readoutAtBracket(
  grid: WeatherGrid,
  lon: number,
  lat: number,
  bracket: TimeBracket,
): WeatherReadout | undefined {
  const { lo, hi, frac } = bracket;
  const uLo = bilinearAt(grid, grid.windU[lo], lon, lat);
  const vLo = bilinearAt(grid, grid.windV[lo], lon, lat);
  if (uLo === undefined || vLo === undefined) return undefined;
  const u = lerpTo(uLo, bilinearAt(grid, grid.windU[hi], lon, lat), frac);
  const v = lerpTo(vLo, bilinearAt(grid, grid.windV[hi], lon, lat), frac);
  const speedMs = Math.hypot(u, v);
  const fromRad = (Math.atan2(-u, -v) + 2 * Math.PI) % (2 * Math.PI);
  const scalar = (field: number[][] | undefined): number | undefined =>
    lerpOr(fieldAt(grid, field, lo, lon, lat), fieldAt(grid, field, hi, lon, lat), frac);
  return {
    speedMs,
    fromRad,
    gustMs: scalar(grid.windGust),
    pressurePa: scalar(grid.pressureMsl),
    waveHeightM: scalar(grid.waveHeight),
    wavePeriodS: scalar(grid.wavePeriod),
    waveFromRad: circularOr(
      fieldAt(grid, grid.waveDirection, lo, lon, lat),
      fieldAt(grid, grid.waveDirection, hi, lon, lat),
      frac,
    ),
    windWaveHeightM: scalar(grid.windWaveHeight),
    windWavePeriodS: scalar(grid.windWavePeakPeriod ?? grid.windWavePeriod),
    windWaveFromRad: circularOr(
      fieldAt(grid, grid.windWaveDirection, lo, lon, lat),
      fieldAt(grid, grid.windWaveDirection, hi, lon, lat),
      frac,
    ),
    swellHeightM: scalar(grid.swellWaveHeight),
    swellPeriodS: scalar(grid.swellWavePeakPeriod ?? grid.swellWavePeriod),
    swellFromRad: circularOr(
      fieldAt(grid, grid.swellWaveDirection, lo, lon, lat),
      fieldAt(grid, grid.swellWaveDirection, hi, lon, lat),
      frac,
    ),
    currentSpeedMs: scalar(grid.oceanCurrentSpeed),
    currentDirectionRad: circularOr(
      fieldAt(grid, grid.oceanCurrentDirection, lo, lon, lat),
      fieldAt(grid, grid.oceanCurrentDirection, hi, lon, lat),
      frac,
    ),
    waterTempK: scalar(grid.seaSurfaceTemperature),
    // Step precipitation reads the lower bracket only, mirroring precip-field.ts's precipFieldRgba.
    precipitationMm:
      grid.precipitationInterpolation === 'step'
        ? fieldAt(grid, grid.precipitation, lo, lon, lat)
        : scalar(grid.precipitation),
    precipIsRate: true,
    cloudCoverFraction: scalar(grid.cloudCover),
    visibilityM: scalar(grid.visibility),
    // Categorical: nearest cell at the lower step, since blending codes across cells or steps
    // would manufacture a forecast nobody issued.
    weatherCode: nanToUndef(
      grid.weatherCode?.[lo]?.length ? nearestAt(grid, grid.weatherCode[lo], lon, lat) : undefined,
    ),
  };
}

// The trailing 3-hour barometric change at a point (Pa, negative falling): the tendency a sailor
// decides by, where a spot reading decides nothing. Undefined when the series does not reach a
// full 3 hours back from the requested time, so a short window is never passed off as the trend.
export const PRESSURE_TREND_WINDOW_MS = 3 * HOUR_MS;
export function pressureTrendPa(
  grid: WeatherGrid,
  lon: number,
  lat: number,
  timeMs: number,
): number | undefined {
  const earlier = timeMs - PRESSURE_TREND_WINDOW_MS;
  if (grid.times.length === 0 || earlier < grid.times[0]) return undefined;
  const nowPa = pressureAtBracket(grid, lon, lat, timeBracket(grid, timeMs));
  const thenPa = pressureAtBracket(grid, lon, lat, timeBracket(grid, earlier));
  if (nowPa === undefined || thenPa === undefined) return undefined;
  return nowPa - thenPa;
}

// Pressure-only sampling: the tendency recomputes on every scrub tick, and a full readout would
// sample the grid eight fields wide to read one.
function pressureAtBracket(
  grid: WeatherGrid,
  lon: number,
  lat: number,
  bracket: TimeBracket,
): number | undefined {
  return lerpOr(
    fieldAt(grid, grid.pressureMsl, bracket.lo, lon, lat),
    fieldAt(grid, grid.pressureMsl, bracket.hi, lon, lat),
    bracket.frac,
  );
}

function fieldAt(
  grid: WeatherGrid,
  field: number[][] | undefined,
  timeIndex: number,
  lon: number,
  lat: number,
): number | undefined {
  const step = field?.[timeIndex];
  return step?.length ? nanToUndef(bilinearAt(grid, step, lon, lat)) : undefined;
}

// Blend toward the high step only when it sampled; the wind components must never go NaN.
function lerpTo(a: number, b: number | undefined, f: number): number {
  return b === undefined || Number.isNaN(b) ? a : lerp(a, b, f);
}

function lerpOr(a: number | undefined, b: number | undefined, f: number): number | undefined {
  if (a !== undefined && b !== undefined) return lerp(a, b, f);
  return a ?? b;
}

// Angles blend through the shorter arc, never across the 0/360 seam. Unlike the shared lerpAngle,
// a readout keeps whichever side is present when the other step did not sample, so a chip shows the
// one real direction rather than nothing.
function circularOr(a: number | undefined, b: number | undefined, f: number): number | undefined {
  if (a !== undefined && b !== undefined) return lerpAngle(a, b, f);
  return a ?? b;
}

// Marine fields are NaN over land; collapse those to undefined so the display shows nothing rather
// than "NaN" and the chip can guard with a plain presence check.
function nanToUndef(v: number | undefined): number | undefined {
  return v === undefined || Number.isNaN(v) ? undefined : v;
}
