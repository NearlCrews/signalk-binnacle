import { isLatLon } from '$shared/geo';
import { HOUR_MS, nearestBy } from '$shared/lib';
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

const MAX_HISTORY_SAMPLES = 10_000;

export function toSamples(values: HistoryValues): HistorySample[] {
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
  const out: HistorySample[] = [];
  for (const row of values.rows) {
    const t = Date.parse(row[0]);
    if (!Number.isFinite(t)) continue;
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
    out.push(sample);
    if (out.length >= MAX_HISTORY_SAMPLES) break;
  }
  return out.sort((a, b) => a.t - b.t);
}

export function nearestSample(
  samples: readonly HistorySample[],
  targetMs: number,
): HistorySample | undefined {
  return nearestBy(samples, (s) => s.t, targetMs);
}

export function nearestPositioned(
  samples: readonly HistorySample[],
  targetMs: number,
): HistorySample | undefined {
  return nearestBy(
    samples,
    (s) => s.t,
    targetMs,
    (s) => s.lon !== undefined && s.lat !== undefined,
  );
}

export function relativeHours(toMs: number, sampleMs: number): number {
  return Math.max(0, Math.round((toMs - sampleMs) / HOUR_MS));
}

export function scrubValueText(clock: string, hoursAgo: number): string {
  return `${clock}, ${hoursAgo} ${hoursAgo === 1 ? 'hour' : 'hours'} ago`;
}
