import type { LatLon } from '$shared/geo';

// A saved position the route editor may snap a vertex to. Structural on purpose, so the waypoint
// store's array is handed over as is, with no per-event mapping allocation on the drag path.
export interface SnapTarget {
  position: LatLon;
}

// Screen-space snap radius. Twelve pixels reads as "on the marker" at the shipped marker sizes
// while staying well under half a 44 px touch target, so a tap meant to land beside a waypoint is
// not captured by it.
export const SNAP_RADIUS_PX = 12;

// The projection pair Terra Draw hands its snapping hooks: container pixels to and from lng/lat.
export interface SnapProjection {
  project: (lng: number, lat: number) => { x: number; y: number };
  unproject: (x: number, y: number) => { lng: number; lat: number };
}

// The candidate prefilter unprojects the corners of a square around the pointer, and the pad
// grows that square past the snap radius so the corner-derived degree box still bounds the snap
// disc where the projection bends across it (Mercator's latitude nonlinearity, a pitched camera).
// The box only admits candidates to the exact pixel test below, so a generous pad costs a few
// extra projections, never a wrong snap.
const PREFILTER_PAD = 1.5;

// The nearest target within radiusPx of the pointer, measured in projected screen pixels so the
// radius feels constant while zooming and stays correct at any latitude; undefined when none is
// in range, which leaves the vertex where the pointer put it. The scan is a flat pass over the
// targets with a degree-box prefilter, cheap enough for a per-pointermove call under the 5,000
// waypoint collection cap.
export function nearestSnapPosition(
  pointer: { x: number; y: number },
  targets: readonly SnapTarget[],
  projection: SnapProjection,
  radiusPx: number = SNAP_RADIUS_PX,
): LatLon | undefined {
  if (targets.length === 0) return undefined;
  const pad = radiusPx * PREFILTER_PAD;
  const a = projection.unproject(pointer.x - pad, pointer.y - pad);
  const b = projection.unproject(pointer.x + pad, pointer.y - pad);
  const c = projection.unproject(pointer.x - pad, pointer.y + pad);
  const d = projection.unproject(pointer.x + pad, pointer.y + pad);
  const minLat = Math.min(a.lat, b.lat, c.lat, d.lat);
  const maxLat = Math.max(a.lat, b.lat, c.lat, d.lat);
  const minLng = Math.min(a.lng, b.lng, c.lng, d.lng);
  const maxLng = Math.max(a.lng, b.lng, c.lng, d.lng);
  const radiusSq = radiusPx * radiusPx;
  let best: LatLon | undefined;
  let bestDistSq = Number.POSITIVE_INFINITY;
  for (const target of targets) {
    const { latitude, longitude } = target.position;
    if (latitude < minLat || latitude > maxLat) continue;
    // The map's longitude space runs unwrapped past the antimeridian, so a stored in-range
    // longitude can sit one world copy away from the pointer's box; project the on-screen copy,
    // but snap to the stored position so the saved vertex equals the waypoint exactly.
    let lng = longitude;
    if (lng < minLng || lng > maxLng) {
      if (lng + 360 >= minLng && lng + 360 <= maxLng) lng += 360;
      else if (lng - 360 >= minLng && lng - 360 <= maxLng) lng -= 360;
      else continue;
    }
    const point = projection.project(lng, latitude);
    const dx = point.x - pointer.x;
    const dy = point.y - pointer.y;
    const distSq = dx * dx + dy * dy;
    if (distSq > radiusSq || distSq >= bestDistSq) continue;
    bestDistSq = distSq;
    best = target.position;
  }
  return best;
}
