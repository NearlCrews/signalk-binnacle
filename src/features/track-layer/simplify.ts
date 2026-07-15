import { splitAtGaps, type TrackPoint } from '$entities/track';

// Perpendicular distance from p to the segment a-b, in degree space. Planar is fine at the
// scales a display track spans; it ignores the lon/lat scale difference (a degree of longitude
// shrinks with latitude), so simplification is slightly anisotropic, which is harmless at a
// roughly 9 m tolerance.
function perpendicular(p: TrackPoint, a: TrackPoint, b: TrackPoint): number {
  const dx = b.lon - a.lon;
  const dy = b.lat - a.lat;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.lon - a.lon, p.lat - a.lat);
  const t = ((p.lon - a.lon) * dx + (p.lat - a.lat) * dy) / len2;
  return Math.hypot(p.lon - (a.lon + t * dx), p.lat - (a.lat + t * dy));
}

// Iterative Douglas-Peucker over a single run: an explicit index-range stack and a keep mask,
// so a long jagged voyage cannot blow the call stack and there are no per-split array copies.
function simplifyRun(run: TrackPoint[], tolerance: number): TrackPoint[] {
  const n = run.length;
  if (n <= 2) return run;
  // Unwrap longitude onto one continuous axis before measuring perpendicular distance. Without
  // this, a short segment crossing 180 degrees looks almost 360 degrees wide and simplification can
  // remove or retain the wrong points. Output still uses the original normalized coordinates.
  const work: TrackPoint[] = [];
  for (const point of run) {
    if (work.length === 0) {
      work.push(point);
      continue;
    }
    const previous = work[work.length - 1].lon;
    let lon = point.lon;
    while (lon - previous > 180) lon -= 360;
    while (lon - previous < -180) lon += 360;
    work.push({ ...point, lon });
  }
  // A Uint8Array, not a boolean array: zero-initialized, unboxed, and cache-friendly on the long
  // runs a multi-day track produces.
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: Array<[number, number]> = [[0, n - 1]];
  while (stack.length > 0) {
    // The loop condition guarantees a non-empty stack; the guard just narrows the type.
    const top = stack.pop();
    if (!top) break;
    const [start, end] = top;
    let maxDist = 0;
    let index = -1;
    for (let i = start + 1; i < end; i += 1) {
      const dist = perpendicular(work[i], work[start], work[end]);
      if (dist > maxDist) {
        maxDist = dist;
        index = i;
      }
    }
    if (maxDist > tolerance && index !== -1) {
      keep[index] = 1;
      stack.push([start, index]);
      stack.push([index, end]);
    }
  }
  const out: TrackPoint[] = [];
  for (let i = 0; i < n; i += 1) if (keep[i]) out.push(run[i]);
  return out;
}

// Douglas-Peucker simplification that never crosses a break: the points are split into runs
// at every gap point and each run is simplified independently.
export function douglasPeucker(points: readonly TrackPoint[], tolerance: number): TrackPoint[] {
  if (points.length <= 2) return points.slice();
  const out: TrackPoint[] = [];
  for (const run of splitAtGaps(points)) out.push(...simplifyRun(run, tolerance));
  return out;
}
