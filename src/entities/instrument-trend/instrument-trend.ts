import { hasControlCharacters } from '$shared/lib';

export const MAX_TREND_INSTRUMENTS = 8;
export const MAX_TREND_INSTRUMENT_ID_LENGTH = 256;
export const DEFAULT_TREND_INSTRUMENT_IDS = ['depth', 'wind-apparent', 'pressure', 'sog'] as const;

export type InstrumentTrendAggregate = 'average' | 'max' | 'last';

export type InstrumentTrendDisplayKind =
  | 'speed'
  | 'depth'
  | 'pressure'
  | 'temperature'
  | 'ratio'
  | 'rpm'
  | 'duration'
  | 'rate-of-turn'
  | 'voltage'
  | 'current'
  | 'volume'
  | 'power'
  | 'count';

export type InstrumentTrendCategory =
  | 'navigation'
  | 'wind'
  | 'depth'
  | 'weather'
  | 'electrical'
  | 'propulsion'
  | 'tanks'
  | 'cabin';

export interface InstrumentTrendCandidate {
  path: string;
  referenceLabel?: string;
  minPeriodMs: number;
  staleAfterMs: number;
}

// A feature-neutral description of one explicitly trendable instrument. Values remain in Signal K
// SI units until the trends presentation converts them at the chart boundary.
export interface InstrumentTrendDescriptor {
  id: string;
  label: string;
  description: string;
  category: InstrumentTrendCategory;
  candidates: readonly InstrumentTrendCandidate[];
  aggregate: InstrumentTrendAggregate;
  display: InstrumentTrendDisplayKind;
  metricPrecision: number;
  imperialPrecision: number;
}

export function isTrendInstrumentId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_TREND_INSTRUMENT_ID_LENGTH &&
    value.trim() === value &&
    !hasControlCharacters(value)
  );
}

// Stored ids are deliberately not checked against the current catalog. Dynamic sensors can be
// unavailable during startup or for an entire voyage, and their profile selection must survive.
export function cleanTrendInstrumentIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [...DEFAULT_TREND_INSTRUMENT_IDS];
  const cleaned: string[] = [];
  const seen = new Set<string>();
  for (const id of value) {
    if (!isTrendInstrumentId(id) || seen.has(id)) continue;
    seen.add(id);
    cleaned.push(id);
    if (cleaned.length >= MAX_TREND_INSTRUMENTS) break;
  }
  return cleaned;
}
