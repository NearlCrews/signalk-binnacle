import {
  bilinearAt,
  type TimeBracket,
  timeBracket,
  type WeatherGrid,
  type WeatherStatus,
} from '$entities/weather';
import {
  formatBearingOr,
  formatDuration,
  formatSpeedOr,
  HOUR_MS,
  speedUnit,
  type UnitsSelection,
} from '$shared/lib';

export function routeForecastContext(
  grid: WeatherGrid | undefined,
  status: WeatherStatus,
  nowMs: number,
): { text: string; degraded: boolean } {
  if (!grid)
    return {
      text:
        status === 'loading'
          ? 'Loading route wind forecast.'
          : 'Route wind forecast unavailable. Open Forecast to load or refresh it.',
      degraded: true,
    };
  const ageMs =
    grid.fetchedAt === undefined || !Number.isFinite(grid.fetchedAt) || grid.fetchedAt > nowMs
      ? undefined
      : nowMs - grid.fetchedAt;
  const age =
    ageMs === undefined ? 'Fetch age unknown.' : `Fetched ${formatDuration(ageMs / 1000)} ago.`;
  let state = '';
  if (status === 'error') state = ' Refresh failed; showing retained forecast.';
  else if (status === 'stale') state = ' Retained or partial forecast; not current.';
  else if (status === 'loading') state = ' Refreshing; showing retained forecast.';
  else if (ageMs !== undefined && ageMs >= HOUR_MS)
    state = ' Retained forecast is over an hour old.';
  else if (status === 'idle') state = ' Forecast refresh status unknown.';
  const partial = grid.partialWaves ? ' Wave data unavailable; wind model only.' : '';
  return {
    text: `Open-Meteo model forecast. ${age}${state}${partial}`,
    degraded:
      ageMs === undefined || ageMs >= HOUR_MS || status !== 'ready' || grid.partialWaves === true,
  };
}

export function routeWindUnavailableReason(grid: WeatherGrid, arrivalMs: number): string {
  if (
    !grid.times.length ||
    arrivalMs < grid.times[0] ||
    arrivalMs > grid.times[grid.times.length - 1]
  )
    return 'Planned arrival is outside the forecast period.';
  return 'Wind unavailable at this route point and planned arrival.';
}

// The forecast wind at one waypoint's planned arrival, SI like the grid it came from.
export interface RouteWindSample {
  speedMps: number;
  // The direction the wind comes from, radians clockwise from true north.
  directionFromRad: number;
  gustMps: number | undefined;
}

// One field sampled bilinearly in space and linearly across the bracketing forecast steps. Unlike
// the weather panel's readout, a missing half of the bracket yields nothing rather than the other
// half: a plan line must never show a value nobody forecast.
function sampleField(
  grid: WeatherGrid,
  field: number[][],
  lon: number,
  lat: number,
  bracket: TimeBracket,
): number | undefined {
  const lo = bilinearAt(grid, field[bracket.lo], lon, lat);
  if (lo === undefined || !Number.isFinite(lo)) return undefined;
  if (bracket.lo === bracket.hi) return lo;
  const hi = bilinearAt(grid, field[bracket.hi], lon, lat);
  if (hi === undefined || !Number.isFinite(hi)) return undefined;
  return lo + (hi - lo) * bracket.frac;
}

// The forecast wind at a position and planned-arrival time, or undefined whenever the grid does
// not cover that place or time. A wind-only sampler over the entities grid: the weather feature's
// richer readout is a sibling feature's internal, unreachable across the feature boundary.
export function routeWindAt(
  grid: WeatherGrid,
  latitude: number,
  longitude: number,
  arrivalMs: number,
): RouteWindSample | undefined {
  const times = grid.times;
  // timeBracket clamps to the series ends, which suits the scrubber but would silently pin an
  // arrival past the forecast horizon to the last step; an uncovered time samples nothing.
  if (times.length === 0 || arrivalMs < times[0] || arrivalMs > times[times.length - 1]) {
    return undefined;
  }
  const bracket = timeBracket(grid, arrivalMs);
  const u = sampleField(grid, grid.windU, longitude, latitude, bracket);
  const v = sampleField(grid, grid.windV, longitude, latitude, bracket);
  if (u === undefined || v === undefined) return undefined;
  return {
    speedMps: Math.hypot(u, v),
    directionFromRad: (Math.atan2(-u, -v) + 2 * Math.PI) % (2 * Math.PI),
    gustMps:
      grid.windGust === undefined
        ? undefined
        : sampleField(grid, grid.windGust, longitude, latitude, bracket),
  };
}

// The compact per-leg forecast line ("Wind 9.7 kn gust 19.4 from 240"); the template appends the
// degree marks. Display-edge conversion only, honoring the units preference's speed category.
export function windLineText(sample: RouteWindSample, units: UnitsSelection): string {
  const gust = sample.gustMps === undefined ? '' : ` gust ${formatSpeedOr(sample.gustMps, units)}`;
  return `Wind ${formatSpeedOr(sample.speedMps, units)} ${speedUnit(units)}${gust} from ${formatBearingOr(sample.directionFromRad)}`;
}
