import {
  type Bbox,
  sampleGrid,
  type WeatherGrid,
  type WeatherSourceMetadata,
} from '$entities/weather';
import { DEG_TO_RAD, PA_PER_HPA, withTimeout } from '$shared/lib';

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const MARINE_URL = 'https://marine-api.open-meteo.com/v1/marine';
// Open-Meteo accepts many locations per request; keep batches well under its cap.
const MAX_LOCS_PER_REQUEST = 200;
// Longer than the shared default: a 200-location batch is a real server-side workload, but a
// half-open boat link must still not hang the loader for the browser's minutes-long default.
const FETCH_TIMEOUT_MS = 15_000;

export interface ForecastOptions {
  maxCells: number;
  forecastDays: number;
}

interface OmLoc {
  latitude?: number;
  longitude?: number;
  hourly?: {
    time?: number[];
    wind_speed_10m?: Array<number | null>;
    wind_direction_10m?: Array<number | null>;
    wind_gusts_10m?: Array<number | null>;
    pressure_msl?: Array<number | null>;
    precipitation?: Array<number | null>;
    cloud_cover?: Array<number | null>;
  };
}

export interface MarineFields {
  source: WeatherSourceMetadata;
  waveHeight: number[][];
  waveDirection: number[][];
  wavePeriod: number[][];
  windWaveHeight: number[][];
  windWaveDirection: number[][];
  windWavePeriod: number[][];
  windWavePeakPeriod: number[][];
  swellWaveHeight: number[][];
  swellWaveDirection: number[][];
  swellWavePeriod: number[][];
  swellWavePeakPeriod: number[][];
  oceanCurrentSpeed: number[][];
  oceanCurrentDirection: number[][];
  seaSurfaceTemperature: number[][];
}

interface MarineLoc {
  latitude?: number;
  longitude?: number;
  hourly?: {
    time?: number[];
    wave_height?: Array<number | null>;
    wave_direction?: Array<number | null>;
    wave_period?: Array<number | null>;
    wind_wave_height?: Array<number | null>;
    wind_wave_direction?: Array<number | null>;
    wind_wave_period?: Array<number | null>;
    wind_wave_peak_period?: Array<number | null>;
    swell_wave_height?: Array<number | null>;
    swell_wave_direction?: Array<number | null>;
    swell_wave_period?: Array<number | null>;
    swell_wave_peak_period?: Array<number | null>;
    ocean_current_velocity?: Array<number | null>;
    ocean_current_direction?: Array<number | null>;
    sea_surface_temperature?: Array<number | null>;
  };
}

interface GridLocations<T> {
  locs: T[];
  lats: number[];
  lons: number[];
}

// Fetch one Open-Meteo endpoint for a bbox sampled to a grid, batched under the per-request location
// cap. Returns the per-location records plus the grid axes, or undefined on any failure so callers
// leave the last grid in place and retry.
async function fetchGridLocations<T>(
  baseUrl: string,
  hourly: string,
  extra: Record<string, string>,
  bbox: Bbox,
  opts: ForecastOptions,
  fetchFn: typeof fetch,
  signal?: AbortSignal,
): Promise<GridLocations<T> | undefined> {
  const { lats, lons } = sampleGrid(bbox, opts.maxCells);
  const points: Array<{ lat: number; lon: number }> = [];
  for (const lat of lats) for (const lon of lons) points.push({ lat, lon });

  try {
    const chunks = chunk(points, MAX_LOCS_PER_REQUEST);
    const responses = await Promise.all(
      chunks.map((c) => fetchFn(buildUrl(baseUrl, c, hourly, extra, opts), requestInit(signal))),
    );
    const locs: T[] = [];
    for (const r of responses) {
      if (!r.ok) return undefined;
      const body = (await r.json()) as T | T[];
      for (const l of Array.isArray(body) ? body : [body]) locs.push(l);
    }
    return { locs, lats, lons };
  } catch (error) {
    if (signal?.aborted) throw error;
    return undefined;
  }
}

function requestInit(signal?: AbortSignal): RequestInit {
  const timed = withTimeout({ credentials: 'omit' }, FETCH_TIMEOUT_MS);
  if (!signal) return timed;
  const timeoutSignal = timed.signal;
  return {
    credentials: 'omit',
    signal:
      timeoutSignal && typeof AbortSignal.any === 'function'
        ? AbortSignal.any([signal, timeoutSignal])
        : signal,
  };
}

function buildUrl(
  baseUrl: string,
  points: Array<{ lat: number; lon: number }>,
  hourly: string,
  extra: Record<string, string>,
  opts: ForecastOptions,
): string {
  const params = new URLSearchParams({
    latitude: points.map((p) => p.lat.toFixed(4)).join(','),
    longitude: points.map((p) => providerLongitude(p.lon).toFixed(4)).join(','),
    hourly,
    forecast_days: String(opts.forecastDays),
    timeformat: 'unixtime',
    // cell_selection is per-endpoint: the atmospheric forecast wants the default land cell (the
    // caller omits it), and only the marine request passes cell_selection=sea. Forcing sea on the
    // forecast picked wrong or missing cells over inland and freshwater areas like the Great Lakes.
    ...extra,
  });
  return `${baseUrl}?${params}`;
}

function providerLongitude(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function grid2d(steps: number, cells: number, fill = Number.NaN): number[][] {
  return Array.from({ length: steps }, () => new Array(cells).fill(fill));
}

// Fetch an Open-Meteo gridded forecast for the bbox. Wind is converted to u/v on parse, where the
// meteorological direction (where the wind comes from) is reversed to the vector; pressure is hPa on
// the wire, stored Pa. Returns undefined on any failure.
export async function fetchForecast(
  bbox: Bbox,
  opts: ForecastOptions,
  fetchFn: typeof fetch = globalThis.fetch.bind(globalThis),
  signal?: AbortSignal,
): Promise<WeatherGrid | undefined> {
  const result = await fetchGridLocations<OmLoc>(
    FORECAST_URL,
    // Gusts ride along: gust versus sustained is the reefing decision, so the free grid must carry
    // it for the readouts even when no provider is configured.
    'wind_speed_10m,wind_direction_10m,wind_gusts_10m,pressure_msl,precipitation,cloud_cover',
    { wind_speed_unit: 'ms' },
    bbox,
    opts,
    fetchFn,
    signal,
  );
  return result ? parse(result.locs, result.lats, result.lons) : undefined;
}

function parse(locs: OmLoc[], lats: number[], lons: number[]): WeatherGrid | undefined {
  const first = locs[0]?.hourly;
  if (!first?.time || first.time.length === 0) return undefined;
  const times = first.time.map((t) => Number(t) * 1000);
  const steps = times.length;
  const cells = lats.length * lons.length;
  if (locs.length !== cells) return undefined;
  const windU = grid2d(steps, cells);
  const windV = grid2d(steps, cells);
  const windGust = grid2d(steps, cells);
  const pressureMsl = grid2d(steps, cells);
  const precipitation = grid2d(steps, cells);
  const cloudCover = grid2d(steps, cells);
  for (let c = 0; c < cells; c += 1) {
    const h = locs[c]?.hourly;
    const spd = h?.wind_speed_10m ?? [];
    const dir = h?.wind_direction_10m ?? [];
    const gust = h?.wind_gusts_10m ?? [];
    const pres = h?.pressure_msl ?? [];
    const precip = h?.precipitation ?? [];
    const cloud = h?.cloud_cover ?? [];
    for (let t = 0; t < steps; t += 1) {
      const s = finite(spd[t]);
      const direction = finite(dir[t]);
      if (s !== undefined && direction !== undefined) {
        const d = direction * DEG_TO_RAD;
        windU[t][c] = -s * Math.sin(d);
        windV[t][c] = -s * Math.cos(d);
      }
      const g = finite(gust[t]);
      if (g !== undefined) windGust[t][c] = g;
      const hpa = finite(pres[t]);
      if (hpa !== undefined) pressureMsl[t][c] = hpa * PA_PER_HPA;
      const mm = finite(precip[t]);
      if (mm !== undefined) precipitation[t][c] = mm;
      const cc = finite(cloud[t]);
      if (cc !== undefined) cloudCover[t][c] = cc / 100;
    }
  }
  return {
    lats,
    lons,
    times,
    windU,
    windV,
    windGust,
    pressureMsl,
    precipitation,
    precipitationInterval: 'preceding-hour',
    precipitationInterpolation: 'step',
    cloudCover,
    atmosphericSource: sourceMetadata(locs, times),
  };
}

function finite(value: number | null | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function sourceMetadata(
  locs: Array<{ latitude?: number; longitude?: number }>,
  times: number[],
): WeatherSourceMetadata {
  return {
    coordinates: locs.map((loc) => ({
      latitude: finite(loc.latitude) ?? Number.NaN,
      longitude: finite(loc.longitude) ?? Number.NaN,
    })),
    times,
  };
}

// Fetch Open-Meteo marine wave data for the same sampled grid as the forecast. Best-effort: returns
// undefined on any failure so waves degrade without affecting wind or pressure. Direction is
// converted from degrees to radians on parse; height stays in meters, period in seconds (SI).
export async function fetchMarine(
  bbox: Bbox,
  opts: ForecastOptions,
  fetchFn: typeof fetch = globalThis.fetch.bind(globalThis),
  signal?: AbortSignal,
): Promise<MarineFields | undefined> {
  const result = await fetchGridLocations<MarineLoc>(
    MARINE_URL,
    'wave_height,wave_direction,wave_period,wind_wave_height,wind_wave_direction,wind_wave_period,wind_wave_peak_period,swell_wave_height,swell_wave_direction,swell_wave_period,swell_wave_peak_period,ocean_current_velocity,ocean_current_direction,sea_surface_temperature',
    // Marine data exists only at sea cells; the forecast above keeps the default land selection.
    { cell_selection: 'sea', velocity_unit: 'ms', temperature_unit: 'kelvin' },
    bbox,
    opts,
    fetchFn,
    signal,
  );
  return result ? parseMarine(result.locs, result.lats.length * result.lons.length) : undefined;
}

function parseMarine(locs: MarineLoc[], cells: number): MarineFields | undefined {
  const first = locs[0]?.hourly;
  if (!first?.time || first.time.length === 0) return undefined;
  if (locs.length !== cells) return undefined;
  const steps = first.time.length;
  const waveHeight = grid2d(steps, cells);
  const waveDirection = grid2d(steps, cells);
  const wavePeriod = grid2d(steps, cells);
  const windWaveHeight = grid2d(steps, cells);
  const windWaveDirection = grid2d(steps, cells);
  const windWavePeriod = grid2d(steps, cells);
  const windWavePeakPeriod = grid2d(steps, cells);
  const swellWaveHeight = grid2d(steps, cells);
  const swellWaveDirection = grid2d(steps, cells);
  const swellWavePeriod = grid2d(steps, cells);
  const swellWavePeakPeriod = grid2d(steps, cells);
  const oceanCurrentSpeed = grid2d(steps, cells);
  const oceanCurrentDirection = grid2d(steps, cells);
  const seaSurfaceTemperature = grid2d(steps, cells);
  for (let c = 0; c < cells; c += 1) {
    const h = locs[c]?.hourly;
    const scalarFields: Array<[number[][], Array<number | null>]> = [
      [waveHeight, h?.wave_height ?? []],
      [wavePeriod, h?.wave_period ?? []],
      [windWaveHeight, h?.wind_wave_height ?? []],
      [windWavePeriod, h?.wind_wave_period ?? []],
      [windWavePeakPeriod, h?.wind_wave_peak_period ?? []],
      [swellWaveHeight, h?.swell_wave_height ?? []],
      [swellWavePeriod, h?.swell_wave_period ?? []],
      [swellWavePeakPeriod, h?.swell_wave_peak_period ?? []],
      [oceanCurrentSpeed, h?.ocean_current_velocity ?? []],
      [seaSurfaceTemperature, h?.sea_surface_temperature ?? []],
    ];
    const directionFields: Array<[number[][], Array<number | null>]> = [
      [waveDirection, h?.wave_direction ?? []],
      [windWaveDirection, h?.wind_wave_direction ?? []],
      [swellWaveDirection, h?.swell_wave_direction ?? []],
      [oceanCurrentDirection, h?.ocean_current_direction ?? []],
    ];
    for (let t = 0; t < steps; t += 1) {
      for (const [target, values] of scalarFields) target[t][c] = finite(values[t]) ?? Number.NaN;
      for (const [target, values] of directionFields) {
        const d = finite(values[t]);
        target[t][c] = d === undefined ? Number.NaN : d * DEG_TO_RAD;
      }
    }
  }
  return {
    source: sourceMetadata(
      locs,
      first.time.map((time) => time * 1000),
    ),
    waveHeight,
    waveDirection,
    wavePeriod,
    windWaveHeight,
    windWaveDirection,
    windWavePeriod,
    windWavePeakPeriod,
    swellWaveHeight,
    swellWaveDirection,
    swellWavePeriod,
    swellWavePeakPeriod,
    oceanCurrentSpeed,
    oceanCurrentDirection,
    seaSurfaceTemperature,
  };
}

// The marine fetch uses the same sampled grid and forecast horizon, so the cell and step indices
// align positionally with the wind and pressure arrays. The residual assumption is that the marine
// endpoint's cell_selection=sea snapping does not reorder cells relative to the atmospheric request,
// which holds because both pass the same ordered points.
export function mergeMarine(grid: WeatherGrid, marine: MarineFields): WeatherGrid {
  // The wave arrays are indexed by the base grid's time bracket, so a marine response with a
  // different step count than the atmospheric grid would index out of range. Skip the merge on a
  // step-count mismatch (the field builders then fall back to no wave layer), mirroring the
  // cell-count guard in parseMarine.
  if (marine.waveHeight.length !== grid.windU.length) return grid;
  const maxTimeMismatchMs = maxTimeMismatch(grid.times, marine.source.times);
  const maxDisplacementM = maxSourceDisplacement(grid.atmosphericSource, marine.source);
  const qualified = {
    ...grid,
    marineSource: marine.source,
    marineAlignment: { maxDisplacementM, maxTimeMismatchMs },
  };
  if (maxTimeMismatchMs !== 0 || maxDisplacementM > 100_000) return qualified;
  return {
    ...qualified,
    waveHeight: marine.waveHeight,
    waveDirection: marine.waveDirection,
    wavePeriod: marine.wavePeriod,
    windWaveHeight: marine.windWaveHeight,
    windWaveDirection: marine.windWaveDirection,
    windWavePeriod: marine.windWavePeriod,
    windWavePeakPeriod: marine.windWavePeakPeriod,
    swellWaveHeight: marine.swellWaveHeight,
    swellWaveDirection: marine.swellWaveDirection,
    swellWavePeriod: marine.swellWavePeriod,
    swellWavePeakPeriod: marine.swellWavePeakPeriod,
    oceanCurrentSpeed: marine.oceanCurrentSpeed,
    oceanCurrentDirection: marine.oceanCurrentDirection,
    seaSurfaceTemperature: marine.seaSurfaceTemperature,
  };
}

function maxTimeMismatch(a: number[], b: number[]): number {
  if (a.length !== b.length) return Number.POSITIVE_INFINITY;
  return a.reduce((max, time, index) => Math.max(max, Math.abs(time - b[index])), 0);
}

function maxSourceDisplacement(
  atmospheric: WeatherSourceMetadata | undefined,
  marine: WeatherSourceMetadata,
): number {
  if (!atmospheric || atmospheric.coordinates.length !== marine.coordinates.length) {
    return Number.POSITIVE_INFINITY;
  }
  return atmospheric.coordinates.reduce(
    (max, point, index) => Math.max(max, distanceMeters(point, marine.coordinates[index])),
    0,
  );
}

function distanceMeters(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  if (![a.latitude, a.longitude, b.latitude, b.longitude].every(Number.isFinite)) {
    return Number.POSITIVE_INFINITY;
  }
  const dLat = (b.latitude - a.latitude) * DEG_TO_RAD;
  const longitudeDelta = ((b.longitude - a.longitude + 540) % 360) - 180;
  const dLon = longitudeDelta * DEG_TO_RAD;
  const lat1 = a.latitude * DEG_TO_RAD;
  const lat2 = b.latitude * DEG_TO_RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
