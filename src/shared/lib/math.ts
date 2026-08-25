// Linear interpolation between a and b by fraction f (0..1). Shared so the weather overlays blend
// forecast steps and interpolate coordinates through one helper.
export function lerp(a: number, b: number, f: number): number {
  return a + (b - a) * f;
}

// Interpolate between two angles in radians through the shorter arc, so a blend that crosses the
// 0/2 pi seam passes through north rather than sweeping the long way around (350 degrees to 10
// degrees yields about 0, never 180). Blending the unit-vector components is what makes that work,
// and it also keeps the NaN discipline callers rely on: a missing or NaN input yields NaN rather
// than silently borrowing the other side, so an existing Number.isNaN guard still rejects the
// sample. The result is normalized into [0, 2 pi).
export function lerpAngle(a: number, b: number, f: number): number {
  const x = lerp(Math.sin(a), Math.sin(b), f);
  const y = lerp(Math.cos(a), Math.cos(b), f);
  return (Math.atan2(x, y) + 2 * Math.PI) % (2 * Math.PI);
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
export function clamp(value: number, lo: number, hi: number): number {
  return Math.min(Math.max(value, lo), hi);
}

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

// The first index whose key is not below the target, for an array sorted ascending by that key
// (binary lower bound). Shared by nearestBySorted and the tide-station latitude band scan.
export function lowerBound<T>(
  items: readonly T[],
  key: (item: T) => number,
  target: number,
): number {
  let lo = 0;
  let hi = items.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (key(items[mid]) < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// The item whose time is nearest the target, for an array already sorted ascending by that time
// (finite values only). Binary search finds the insertion point, then a neighbor walk expands
// outward from it, always advancing the temporally closer side, so the first predicate match it
// reaches is the nearest one. This turns the per-scrub history lookups from a full linear scan of
// up to ten thousand samples into a logarithmic search. On a tie the earlier item wins, matching
// nearestBy. Callers with unsorted data must keep using nearestBy.
export function nearestBySorted<T>(
  items: readonly T[],
  toMs: (item: T) => number,
  targetMs: number,
  predicate?: (item: T) => boolean,
): T | undefined {
  const count = items.length;
  if (count === 0) return undefined;
  const lo = lowerBound(items, toMs, targetMs);
  let left = lo - 1;
  let right = lo;
  while (left >= 0 || right < count) {
    const gapLeft = left >= 0 ? Math.abs(toMs(items[left]) - targetMs) : Number.POSITIVE_INFINITY;
    const gapRight =
      right < count ? Math.abs(toMs(items[right]) - targetMs) : Number.POSITIVE_INFINITY;
    if (gapLeft <= gapRight) {
      const item = items[left];
      if (!predicate || predicate(item)) return item;
      left -= 1;
    } else {
      const item = items[right];
      if (!predicate || predicate(item)) return item;
      right += 1;
    }
  }
  return undefined;
}
