// Linear interpolation between a and b by fraction f (0..1). Shared so the weather overlays blend
// forecast steps and interpolate coordinates through one helper.
export function lerp(a: number, b: number, f: number): number {
  return a + (b - a) * f;
}

// A finite-number type guard, shared so the persisted-state and descriptor validators do not each
// re-declare it.
export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function isSafeNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

// Compare two optional numbers so missing or non-finite values sort last regardless of direction,
// keeping unknowns from burying the meaningful values. Shared by the AIS list and the POI search.
export function compareOptionalNumber(
  a: number | undefined,
  b: number | undefined,
  dir: 'asc' | 'desc' = 'asc',
): number {
  const av = isFiniteNumber(a) ? a : undefined;
  const bv = isFiniteNumber(b) ? b : undefined;
  if (av === undefined && bv === undefined) return 0;
  if (av === undefined) return 1;
  if (bv === undefined) return -1;
  return dir === 'asc' ? av - bv : bv - av;
}

// Round v to the nearest integer within the inclusive range [lo, hi]. Shared so the numeric inputs
// that must land on a whole value inside a bound clamp and round in one place.
export function clampInt(v: number, lo: number, hi: number): number {
  return Math.round(Math.max(lo, Math.min(v, hi)));
}

// The item whose time is nearest the target, skipping items with a NaN time. An optional predicate
// filters candidates first, so a caller can restrict the scan (a positioned sample, say) without a
// separate pass. One scan shared by the nearest-forecast-step, nearest-grid-time, and
// latest-observation lookups.
export function nearestBy<T>(
  items: readonly T[],
  toMs: (item: T) => number,
  targetMs: number,
  predicate?: (item: T) => boolean,
): T | undefined {
  let best: T | undefined;
  let bestGap = Number.POSITIVE_INFINITY;
  for (const item of items) {
    if (predicate && !predicate(item)) continue;
    const t = toMs(item);
    if (Number.isNaN(t)) continue;
    const gap = Math.abs(t - targetMs);
    if (gap < bestGap) {
      bestGap = gap;
      best = item;
    }
  }
  return best;
}
