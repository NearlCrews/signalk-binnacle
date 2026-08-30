import { type LngLatBoundsLike, lngLatBoundsToBbox4, wrapLongitude } from '$shared/geo';
import { lerp, nearestBy } from '$shared/lib';

export interface Bbox {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface WeatherSourceMetadata {
  coordinates: Array<{ latitude: number; longitude: number }>;
  times: number[];
}

interface MarineAlignmentMetadata {
  maxDisplacementM: number;
  maxTimeMismatchMs: number;
}

export function boundsToBbox(b: LngLatBoundsLike): Bbox {
  const [west, south, east, north] = lngLatBoundsToBbox4(b);
  return { west, south, east, north };
}

// A regular lat/lon forecast grid. Variable arrays are indexed [timeIndex][cellIndex], where
// cellIndex is row-major over (lat, lon). All values are SI.
export interface WeatherGrid {
  lats: number[];
  lons: number[];
  times: number[]; // epoch ms, ascending
  windU: number[][]; // m/s, eastward
  windV: number[][]; // m/s, northward
  // When the loader fetched this grid from the network (epoch ms), carried through the caches so
  // the panel can state the forecast's age honestly. Absent on grids persisted before this field.
  fetchedAt?: number;
  // Waves were requested but the marine endpoint failed, so the wave fields are missing from an
  // otherwise complete grid; the panel qualifies its stale note with this.
  partialWaves?: boolean;
  atmosphericSource?: WeatherSourceMetadata;
  marineSource?: WeatherSourceMetadata;
  marineAlignment?: MarineAlignmentMetadata;
  // Supplementary fields, present only when fetched; absent (undefined) for a wind-only grid or
  // over cells the provider omits. All SI: pressure in Pa, wave height in m, direction in radians,
  // period in s. Marine fields are NaN over land cells. Precipitation is the one deliberate
  // exception: Open-Meteo supplies the preceding hour's accumulation in millimeters, and the
  // display presents that hourly amount as mm/h.
  windGust?: number[][]; // m/s
  pressureMsl?: number[][]; // Pa
  precipitation?: number[][]; // mm per preceding hour, a deliberate non-SI exception (see above)
  precipitationInterval?: 'preceding-hour';
  precipitationInterpolation?: 'step';
  cloudCover?: number[][]; // 0..1 fraction
  waveHeight?: number[][]; // m
  waveDirection?: number[][]; // radians, direction the waves come from
  wavePeriod?: number[][]; // s
  windWaveHeight?: number[][]; // m
  windWaveDirection?: number[][]; // radians, direction the wind waves come from
  windWavePeriod?: number[][]; // s
  windWavePeakPeriod?: number[][]; // s
  swellWaveHeight?: number[][]; // m
  swellWaveDirection?: number[][]; // radians, direction the swell comes from
  swellWavePeriod?: number[][]; // s
  swellWavePeakPeriod?: number[][]; // s
  oceanCurrentSpeed?: number[][]; // m/s
  oceanCurrentDirection?: number[][]; // radians, direction the current flows toward
  seaSurfaceTemperature?: number[][]; // K
  visibility?: number[][]; // m
  weatherCode?: number[][]; // WMO weather interpretation code; categorical, never interpolate
}

export interface RadarFrame {
  time: number; // epoch ms
  path: string;
}

export interface RadarData {
  host: string;
  frames: RadarFrame[]; // ascending by time
}

// The smallest axis span sampleGrid will build. A degenerate viewport (the map reporting equal
// north/south or east/west before it has a size) would collapse every grid row onto one latitude,
// which the wind and pressure overlays draw as a single horizontal line. Flooring the span keeps the
// axes spread; for any real viewport the span is far larger, so this changes nothing.
const MIN_SPAN_DEG = 0.02;

// Expand a [min, max] axis range around its center to at least MIN_SPAN_DEG, leaving real spans
// untouched so normal grids are bit-for-bit identical.
function spanned(min: number, max: number): [number, number] {
  if (max - min >= MIN_SPAN_DEG) return [min, max];
  const c = (min + max) / 2;
  return [c - MIN_SPAN_DEG / 2, c + MIN_SPAN_DEG / 2];
}

// Sample a bbox into a grid no larger than maxCells, keeping the axes roughly proportional to the
// bbox so neither is starved. Inclusive of both corners so the field covers the whole viewport.
export function sampleGrid(bbox: Bbox, maxCells: number): { lats: number[]; lons: number[] } {
  if (!Number.isFinite(maxCells) || maxCells < 4) {
    throw new RangeError('maxCells must be at least 4');
  }
  const [west, east] = spanned(bbox.west, bbox.east);
  const [south, north] = spanned(bbox.south, bbox.north);
  const aspect = (east - west) / (north - south);
  const cols = Math.max(
    2,
    Math.min(Math.floor(maxCells / 2), Math.round(Math.sqrt(maxCells * aspect))),
  );
  const rows = Math.max(2, Math.floor(maxCells / cols));
  return { lats: axis(south, north, rows), lons: axis(west, east, cols) };
}

// Canonicalize equivalent world copies to one unwrapped interval. Antimeridian crossings remain
// continuous, such as 170..-170 becoming 170..190, so regular grid axes stay ascending.
export function normalizeBbox(bbox: Bbox): Bbox {
  const south = Math.max(-90, Math.min(90, Math.min(bbox.south, bbox.north)));
  const north = Math.max(-90, Math.min(90, Math.max(bbox.south, bbox.north)));
  let west = bbox.west;
  let east = bbox.east;
  while (east < west) east += 360;
  if (east - west >= 360) return { west: -180, south, east: 180, north };
  const shift = wrapLongitude(west) - west;
  west += shift;
  east += shift;
  return { west, south, east, north };
}

// Distinct from $shared/geo's bboxContains, which compares in the unwrapped space MapLibre
// reports and leaves seam normalization to the request edge. This one normalizes both boxes itself
// (normalizeBbox), so the weather path is seam-safe on its own terms. Do not carry a rule from one
// to the other.
export function bboxContains(coverage: Bbox, viewport: Bbox): boolean {
  const outer = normalizeBbox(coverage);
  const inner = normalizeBbox(viewport);
  return (
    outer.south <= inner.south &&
    outer.north >= inner.north &&
    outer.west <= inner.west &&
    outer.east >= inner.east
  );
}

function axis(min: number, max: number, n: number): number[] {
  const step = (max - min) / (n - 1);
  return Array.from({ length: n }, (_, i) => min + i * step);
}

// Bilinearly sample one variable array at a lon/lat. Returns undefined when the point is outside the
// grid so the readout can show a blank instead of a wrong value.
export function bilinearAt(
  grid: WeatherGrid,
  values: number[],
  lon: number,
  lat: number,
): number | undefined {
  const cx = frac(grid.lons, lon);
  const cy = frac(grid.lats, lat);
  if (!cx || !cy) return undefined;
  const cols = grid.lons.length;
  const v00 = values[cy.i * cols + cx.i];
  const v10 = values[cy.i * cols + cx.i + 1];
  const v01 = values[(cy.i + 1) * cols + cx.i];
  const v11 = values[(cy.i + 1) * cols + cx.i + 1];
  const top = lerp(v00, v10, cx.f);
  const bot = lerp(v01, v11, cx.f);
  return lerp(top, bot, cy.f);
}

// Sample one variable at the grid cell nearest a lon/lat, for categorical fields (a WMO weather
// code) where blending neighboring codes would manufacture a code nobody forecast. Returns
// undefined outside the grid, like bilinearAt.
export function nearestAt(
  grid: WeatherGrid,
  values: number[],
  lon: number,
  lat: number,
): number | undefined {
  const cx = frac(grid.lons, lon);
  const cy = frac(grid.lats, lat);
  if (!cx || !cy) return undefined;
  const col = cx.f < 0.5 ? cx.i : cx.i + 1;
  const row = cy.f < 0.5 ? cy.i : cy.i + 1;
  return values[row * grid.lons.length + col];
}

// Find the interval [axis[i], axis[i+1]] bracketing v and the blend fraction within it. Assumes
// axis is sorted ascending and axis[0] <= v <= axis[last]; callers handle the out-of-range cases.
function bracket(axis: number[], v: number): { i: number; f: number } {
  let lo = 0;
  let hi = axis.length - 2;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (v <= axis[mid + 1]) hi = mid;
    else lo = mid + 1;
  }
  const span = axis[lo + 1] - axis[lo] || 1;
  return { i: lo, f: (v - axis[lo]) / span };
}

function frac(axisVals: number[], v: number): { i: number; f: number } | undefined {
  // bracket needs at least two points to form an interval; an empty or single-point axis would slip
  // past the range check (comparisons against undefined are false) and return a NaN fraction.
  if (axisVals.length < 2) return undefined;
  if (v < axisVals[0] || v > axisVals[axisVals.length - 1]) return undefined;
  return bracket(axisVals, v);
}

export interface TimeBracket {
  lo: number;
  hi: number;
  frac: number;
}

// The grid step nearest a target time, clamped into the series. Used to seed the time slider to
// now on load: Open-Meteo's hourly series starts at 00:00 of the current day, so the first step is
// up to a day in the past and must never be the default.
export function nearestGridTime(times: number[], targetMs: number): number | undefined {
  return nearestBy(times, (t) => t, targetMs);
}

// The two forecast step indices bracketing a selected time and the blend fraction, clamped to the
// ends so scrubbing before or past the forecast shows the nearest step.
export function timeBracket(grid: WeatherGrid, time: number): TimeBracket {
  const t = grid.times;
  if (t.length === 0 || time <= t[0]) return { lo: 0, hi: 0, frac: 0 };
  if (time >= t[t.length - 1]) return { lo: t.length - 1, hi: t.length - 1, frac: 0 };
  const { i, f } = bracket(t, time);
  return { lo: i, hi: i + 1, frac: f };
}
