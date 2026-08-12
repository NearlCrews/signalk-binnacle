import { isLatLon } from '$shared/geo';
import { DAY_MS, HOUR_MS, lowerBound, MINUTE_MS, nearestBySorted } from '$shared/lib';
import { columnIndex, type HistoryValues, SK_PATHS } from '$shared/signalk';

export interface HistorySample {
  t: number;
  lon?: number;
  lat?: number;
  depth?: number | null;
  windApparent?: number | null;
  pressure?: number | null;
  sog?: number | null;
}

interface SampleOptions {
  fromMs?: number;
  toMs?: number;
  maxRows?: number;
}

export function toSamples(
  values: HistoryValues,
  {
    fromMs = Number.NEGATIVE_INFINITY,
    toMs = Number.POSITIVE_INFINITY,
    maxRows = 10_000,
  }: SampleOptions = {},
): HistorySample[] | undefined {
  if (!Number.isSafeInteger(maxRows) || maxRows <= 0 || values.rows.length > maxRows) {
    return undefined;
  }
  const col = (path: string) => columnIndex(values, path);
  const iPos = col(SK_PATHS.position);
  const iDepth = col(SK_PATHS.depthBelowTransducer);
  const iWind = col(SK_PATHS.windSpeedApparent);
  const iPressure = col(SK_PATHS.outsidePressure);
  const iSog = col(SK_PATHS.speedOverGround);
  const num = (row: readonly unknown[], i: number): number | null | undefined => {
    if (i < 0) return undefined;
    const v = row[i + 1];
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  };
  const byTime = new Map<number, HistorySample>();
  for (const row of values.rows) {
    const t = Date.parse(row[0]);
    if (!Number.isFinite(t) || t < fromMs || t > toMs) continue;
    const sample: HistorySample = {
      t,
      depth: num(row, iDepth),
      windApparent: num(row, iWind),
      pressure: num(row, iPressure),
      sog: num(row, iSog),
    };
    const pos = iPos >= 0 ? row[iPos + 1] : undefined;
    if (isLatLon(pos)) {
      sample.lon = pos.longitude;
      sample.lat = pos.latitude;
    }
    if (
      sample.lon === undefined &&
      typeof sample.depth !== 'number' &&
      typeof sample.windApparent !== 'number' &&
      typeof sample.pressure !== 'number' &&
      typeof sample.sog !== 'number'
    ) {
      continue;
    }
    byTime.set(t, sample);
    if (byTime.size > maxRows) return undefined;
  }
  return [...byTime.values()].sort((a, b) => a.t - b.t);
}

// toSamples returns samples sorted ascending by t, so both lookups use the binary-search variant.
export function nearestSample(
  samples: readonly HistorySample[],
  targetMs: number,
): HistorySample | undefined {
  return nearestBySorted(samples, (s) => s.t, targetMs);
}

export function nearestSampleWithin(
  samples: readonly HistorySample[],
  targetMs: number,
  toleranceMs: number,
): HistorySample | undefined {
  const sample = nearestSample(samples, targetMs);
  return sample && Math.abs(sample.t - targetMs) <= toleranceMs ? sample : undefined;
}

export function nextPlaybackSample(
  samples: readonly HistorySample[],
  currentMs: number,
  stepMs: number,
): HistorySample | undefined {
  if (samples.length === 0) return undefined;
  const low = lowerBound(samples, (sample) => sample.t, currentMs + stepMs);
  return samples[Math.min(low, samples.length - 1)];
}

// Deliberately not lowerBound: stepping back needs the last sample at or BEFORE the target, an
// upper bound, so a step from exactly on a sample moves rather than returning that same sample.
export function previousPlaybackSample(
  samples: readonly HistorySample[],
  currentMs: number,
  stepMs: number,
): HistorySample | undefined {
  if (samples.length === 0) return undefined;
  const target = currentMs - stepMs;
  let low = 0;
  let high = samples.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (samples[mid].t <= target) low = mid + 1;
    else high = mid;
  }
  return samples[Math.max(0, low - 1)];
}

export interface PositionedTrackPoint {
  t: number;
  lon: number;
  lat: number;
}

export function positionedTrackSegments(
  samples: readonly HistorySample[],
  throughMs: number,
  maxGapMs: number,
): PositionedTrackPoint[][] {
  const segments: PositionedTrackPoint[][] = [];
  let segment: PositionedTrackPoint[] = [];
  let priorTime: number | undefined;
  for (const sample of samples) {
    if (sample.t > throughMs) break;
    if (sample.lon === undefined || sample.lat === undefined) continue;
    if (priorTime !== undefined && sample.t - priorTime > maxGapMs) {
      if (segment.length > 1) segments.push(segment);
      segment = [];
    }
    segment.push({ t: sample.t, lon: sample.lon, lat: sample.lat });
    priorTime = sample.t;
  }
  if (segment.length > 1) segments.push(segment);
  return segments;
}

const TIME_TRAVEL_TIME_OPTIONS: Intl.DateTimeFormatOptions = {
  weekday: 'short',
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZoneName: 'short',
};

export function formatTimeTravelTimestamp(timeMs: number): string {
  return Number.isFinite(timeMs)
    ? new Date(timeMs).toLocaleString([], TIME_TRAVEL_TIME_OPTIONS)
    : '';
}

export function relativeTimeText(toMs: number, selectedMs: number): string {
  const delta = Math.max(0, toMs - selectedMs);
  if (delta < MINUTE_MS / 2) return 'Newest loaded sample';
  if (delta < HOUR_MS) {
    const minutes = Math.max(1, Math.round(delta / MINUTE_MS));
    return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
  }
  if (delta < 2 * DAY_MS) {
    const hours = Math.max(1, Math.round(delta / HOUR_MS));
    return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  }
  const days = Math.max(1, Math.round(delta / DAY_MS));
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}

export function scrubValueText(
  timestamp: string,
  relative: string,
  positionAvailable: boolean,
): string {
  return positionAvailable
    ? `${timestamp}, ${relative}`
    : `${timestamp}, ${relative}. Position unavailable near this time`;
}
