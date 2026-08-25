import type { WeatherGrid } from '$entities/weather';
import {
  formatFixed,
  formatPressureOr,
  HOUR_MS,
  knotsToMetersPerSecond,
  nearestBySorted,
  PA_PER_HPA,
  pressureUnit,
  type UnitsMode,
} from '$shared/lib';
import type { PointConditions } from './signalk-weather';
import {
  conditionsFromReadout,
  PRESSURE_TREND_WINDOW_MS,
  pressureTrendPa,
  readoutAt,
} from './weather-readout';

const FORECAST_STEPS = 6;
const FREE_STEP_MS = 6 * HOUR_MS;
const COMPATIBLE_VALID_TIME_MS = 3 * HOUR_MS;
const PRESSURE_TREND_WINDOW_H = PRESSURE_TREND_WINDOW_MS / HOUR_MS;
const GALE_MS = knotsToMetersPerSecond(34);
const STORM_MS = knotsToMetersPerSecond(48);
const DENSE_FOG_VISIBILITY_M = 1000;
const RAPID_PRESSURE_FALL_PA_3H = -600;
const ROUGH_SEA_HEIGHT_M = 2.5;
const STRONG_CURRENT_MS = 1.5;

function withGridProvenance(point: PointConditions): PointConditions {
  return { ...point, provenance: 'Open-Meteo' };
}

function freeForecast(
  grid: WeatherGrid | undefined,
  lat: number,
  lon: number,
  selectedTime: number,
): PointConditions[] {
  if (!grid) return [];
  const out: PointConditions[] = [];
  let lastMs = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < grid.times.length && out.length < FORECAST_STEPS; i++) {
    const timeMs = grid.times[i];
    if (timeMs < selectedTime || timeMs - lastMs < FREE_STEP_MS) continue;
    const readout = readoutAt(grid, lon, lat, i);
    if (!readout) continue;
    out.push(withGridProvenance(conditionsFromReadout(readout, timeMs)));
    lastMs = timeMs;
  }
  return out;
}

function freeAtTime(
  grid: WeatherGrid | undefined,
  position: [number, number] | undefined,
  targetMs: number,
): PointConditions | undefined {
  if (!grid || !position || grid.times.length === 0) return undefined;
  // grid.times is ascending (the grid builder guarantees it), so the nearest step is a binary
  // search rather than a scan of every forecast step.
  const stepIndices = grid.times.map((_, index) => index);
  const bestIndex = nearestBySorted(stepIndices, (index) => grid.times[index], targetMs);
  if (bestIndex === undefined) return undefined;
  if (Math.abs(grid.times[bestIndex] - targetMs) > COMPATIBLE_VALID_TIME_MS) return undefined;
  const [lat, lon] = position;
  const readout = readoutAt(grid, lon, lat, bestIndex);
  return readout
    ? withGridProvenance(conditionsFromReadout(readout, grid.times[bestIndex]))
    : undefined;
}

const NON_DATA_KEYS = new Set(['timeMs', 'provenance', 'riskCues']);

function hasData(point: PointConditions | undefined): boolean {
  if (!point) return false;
  return Object.entries(point).some(
    ([key, value]) => !NON_DATA_KEYS.has(key) && value !== undefined,
  );
}

// The provider wins per field, not per object. Valid-time compatibility prevents a stale provider
// pressure from being grafted onto an unrelated grid forecast.
export function mergeConditions(
  free: PointConditions | undefined,
  provider: PointConditions | undefined,
): PointConditions | undefined {
  if (!provider) return free;
  if (!free || Math.abs(provider.timeMs - free.timeMs) > COMPATIBLE_VALID_TIME_MS) return provider;
  const providerHasData = hasData(provider);
  const freeContributed = Object.entries(free).some(
    ([key, value]) =>
      !NON_DATA_KEYS.has(key) &&
      value !== undefined &&
      provider[key as keyof PointConditions] === undefined,
  );
  return {
    ...free,
    ...Object.fromEntries(Object.entries(provider).filter(([, value]) => value !== undefined)),
    timeMs: provider.timeMs,
    provenance:
      providerHasData && freeContributed ? 'mixed' : providerHasData ? 'provider' : 'Open-Meteo',
  };
}

export function forecastRiskCues(rows: PointConditions[]): PointConditions[] {
  return rows.map((row, index) => {
    const cues: string[] = [];
    const strongestWind = Math.max(row.windMs ?? 0, row.gustMs ?? 0);
    if (strongestWind >= STORM_MS) cues.push('Storm-force wind');
    else if (strongestWind >= GALE_MS) cues.push('Gale-force wind');
    if (row.visibilityM !== undefined && row.visibilityM <= DENSE_FOG_VISIBILITY_M) {
      cues.push('Dense fog');
    }
    if (row.waveHeightM !== undefined && row.waveHeightM >= ROUGH_SEA_HEIGHT_M) {
      cues.push('Rough seas');
    }
    if (row.currentSpeedMs !== undefined && row.currentSpeedMs >= STRONG_CURRENT_MS) {
      cues.push('Strong current');
    }
    const previous = rows[index - 1];
    if (previous?.pressurePa !== undefined && row.pressurePa !== undefined) {
      const elapsed = row.timeMs - previous.timeMs;
      if (elapsed > 0) {
        const fallPa3h =
          ((row.pressurePa - previous.pressurePa) * PRESSURE_TREND_WINDOW_MS) / elapsed;
        if (fallPa3h <= RAPID_PRESSURE_FALL_PA_3H) cues.push('Rapid pressure fall');
      }
    }
    return cues.length > 0 ? { ...row, riskCues: cues } : row;
  });
}

export function pickForecast(
  grid: WeatherGrid | undefined,
  parsedSeries: PointConditions[] | undefined,
  parsedPos: [number, number] | undefined,
  selectedTime: number,
  targetMs: number,
  hasProvider: boolean,
): { rows: PointConditions[]; horizonH: number } {
  const rows = forecastRiskCues(
    pickRows(grid, parsedSeries, parsedPos, selectedTime, targetMs, hasProvider),
  );
  const horizonH =
    rows.length > 0
      ? Math.max(1, Math.round((rows[rows.length - 1].timeMs - targetMs) / HOUR_MS))
      : 0;
  return { rows, horizonH };
}

function pickRows(
  grid: WeatherGrid | undefined,
  parsedSeries: PointConditions[] | undefined,
  parsedPos: [number, number] | undefined,
  selectedTime: number,
  targetMs: number,
  hasProvider: boolean,
): PointConditions[] {
  if (hasProvider && parsedSeries) {
    const seenTimes = new Set<number>();
    const providerRows = parsedSeries
      .filter((conditions) => !Number.isNaN(conditions.timeMs) && conditions.timeMs >= targetMs)
      .sort((a, b) => a.timeMs - b.timeMs)
      .filter((conditions) => {
        if (seenTimes.has(conditions.timeMs)) return false;
        seenTimes.add(conditions.timeMs);
        return true;
      })
      .slice(0, FORECAST_STEPS)
      .map((provider) => mergeConditions(freeAtTime(grid, parsedPos, provider.timeMs), provider))
      .filter((row): row is PointConditions => !!row);
    if (providerRows.length > 0) return providerRows;
  }
  if (!parsedPos) return [];
  const [lat, lon] = parsedPos;
  return freeForecast(grid, lat, lon, selectedTime);
}

export function tendencyText(
  grid: WeatherGrid | undefined,
  parsedPos: [number, number] | undefined,
  targetMs: number,
  mode: UnitsMode,
): string | undefined {
  if (!parsedPos || !grid) return undefined;
  const [lat, lon] = parsedPos;
  const deltaPa = pressureTrendPa(grid, lon, lat, targetMs);
  if (deltaPa === undefined) return undefined;
  const deltaHpa = deltaPa / PA_PER_HPA;
  if (Math.abs(deltaHpa) < 0.5) return 'steady';
  const word = deltaHpa > 0 ? 'rising' : 'falling';
  const value =
    mode === 'imperial'
      ? formatPressureOr(Math.abs(deltaPa), 'imperial')
      : formatFixed(Math.abs(deltaHpa), 1);
  return `${word} ${value} ${pressureUnit(mode)}/${PRESSURE_TREND_WINDOW_H} h`;
}
