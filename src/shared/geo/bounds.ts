import type { LatLon } from './geo-guards';

// A geographic bounding box as [west, south, east, north] in degrees, the shape a chart descriptor
// carries.
export type Bbox4 = [number, number, number, number];

// True when every argument is a finite number, the shared guard for rejecting a box or a metadata
// bounds array carrying a NaN, an Infinity, or a missing coordinate.
function allFinite(...n: number[]): boolean {
  return n.every(Number.isFinite);
}

// Whether an unknown value is a Bbox4: a four-element array of finite numbers. Guards a raw chart
// descriptor before its bounds are treated as a box. Number.isFinite already rejects a non-number,
// so the length check plus the finite check is sufficient.
export function isBbox4(x: unknown): x is Bbox4 {
  return Array.isArray(x) && x.length === 4 && x.every(Number.isFinite);
}

// A Bbox4 as "lat, lon to lat, lon" at two decimals, the south-west then north-east corner text the
// charts and layers panels show. Reads the [west, south, east, north] order as [1], [0] then [3], [2].
export function formatBounds(bbox: readonly [number, number, number, number]): string {
  const r = (n: number): string => n.toFixed(2);
  return `${r(bbox[1])}, ${r(bbox[0])} to ${r(bbox[3])}, ${r(bbox[2])}`;
}

// A MapLibre-ready corner pair: [[west, south], [east, north]].
type CornerBounds = [[number, number], [number, number]];

// Pad applied to a degenerate (zero-width, zero-height, or point) box so a fit does not jump to an
// extreme zoom trying to frame nothing. About 55 m.
const DEGENERATE_PAD_DEG = 0.0005;

// East below west is the antimeridian-crossing convention; unwrap east past 180 so a span or a fit is
// measured the short way across the seam, not the long way around.
function unwrapEast(west: number, east: number): number {
  return east < west ? east + 360 : east;
}

// Normalize a bounding box for a map fit, or return null when it is unusable. A box with any
// non-finite coordinate, or with south above north, is rejected (a malformed descriptor: unlike
// west greater than east, latitude has no wraparound to explain the inversion). A west greater
// than east box crosses the antimeridian, expressed by adding 360 to east so the fit takes the
// short way. A zero-area box is padded so it has a real extent.
export function normalizeBounds(
  bbox: readonly [number, number, number, number],
): CornerBounds | null {
  const [west, south, east, north] = bbox;
  if (!allFinite(west, south, east, north)) return null;
  if (south > north) return null;
  const unwrappedEast = unwrapEast(west, east);
  const w = unwrappedEast === west ? west - DEGENERATE_PAD_DEG : west;
  const e = unwrappedEast === west ? unwrappedEast + DEGENERATE_PAD_DEG : unwrappedEast;
  const s = north === south ? south - DEGENERATE_PAD_DEG : south;
  const n = north === south ? north + DEGENERATE_PAD_DEG : north;
  return [
    [w, s],
    [e, n],
  ];
}

// The center of a box, including an antimeridian-crossing box. Longitude is measured through the
// unwrapped short span and then returned in the conventional [-180, 180] range.
export function bboxCenter(bbox: readonly [number, number, number, number]): LatLon {
  const [west, south, east, north] = bbox;
  let longitude = (west + unwrapEast(west, east)) / 2;
  if (longitude > 180) longitude -= 360;
  return { latitude: (south + north) / 2, longitude };
}

// The Web Mercator projection is undefined toward the poles, so a padded box stops at the standard
// latitude limit on both sides.
const WEB_MERCATOR_MAX_LAT = 85;
function clampLatitudes([west, south, east, north]: Bbox4): Bbox4 {
  return [
    west,
    Math.max(-WEB_MERCATOR_MAX_LAT, south),
    east,
    Math.min(WEB_MERCATOR_MAX_LAT, north),
  ];
}

// Wrap one longitude into [-180, 180). 180 itself becomes -180, which is the same meridian; the
// callers below only wrap an edge they are about to cut at the seam anyway.
function wrapLongitude(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

// Cut an unwrapped box into the one or two in-range boxes that cover the same ground, for the
// request edge. padBbox deliberately leaves longitude unwrapped (see below), but a longitude on the
// wire has to be a real one: a Signal K bbox query carrying an east of 200 matches nothing, which
// would trade a cache miss for an empty answer. A box that already sits inside [-180, 180] passes
// through untouched, so the common case allocates one box and issues one request.
export function splitAtAntimeridian([west, south, east, north]: Bbox4): Bbox4[] {
  if (!allFinite(west, south, east, north)) return [];
  if (east - west >= 360) return [[-180, south, 180, north]];
  if (west >= -180 && east <= 180) return [[west, south, east, north]];
  const w = wrapLongitude(west);
  const e = wrapLongitude(east);
  // Wrapping kept the edges in order, so the span never actually reached the seam.
  if (w <= e) return [[w, south, e, north]];
  return [
    [w, south, 180, north],
    [-180, south, e, north],
  ];
}

// The default fraction the viewport-keyed fetch overlays pad their bbox by, so a small pan or a
// zoom-in stays inside the last fetch's area and reuses it. Shared so the notes cache and the
// AIS-trail overlay pad by the same amount.
export const VIEWPORT_FETCH_PAD_FRACTION = 0.5;

// Expand a viewport bbox outward by `fraction` on each side, so one padded fetch covers more than
// the visible area and a small pan reuses it. Shared by the notes and AIS-trails overlays.
//
// Latitude is clamped to the Web Mercator limit; longitude deliberately is NOT clamped into
// [-180, 180]. MapLibre reports an unwrapped viewport at the antimeridian (LngLatBounds.extend
// takes a plain min/max of lng, so a west of 178 with an east of 182 is exactly what getBounds
// returns there). Clamping the padded east back to 180 made bboxContains fail against that
// viewport every time, so the coverage cache missed on every move and the overlays refetched
// continuously in the one region where boats cross oceans. Coverage comparisons therefore stay in
// the unwrapped space MapLibre reports, and splitAtAntimeridian normalizes at the request edge.
export function padBbox(
  [west, south, east, north]: Bbox4,
  fraction: number = VIEWPORT_FETCH_PAD_FRACTION,
): Bbox4 {
  // unwrapEast measures the longitude span the short way across the seam for a crossing box, rather
  // than the negative naive east - west.
  const lonSpan = unwrapEast(west, east) - west;
  const dx = lonSpan * fraction;
  const dy = (north - south) * fraction;
  return clampLatitudes([west - dx, south - dy, east + dx, north + dy]);
}

// Fetch an area that may cross the antimeridian, as one request away from the seam and as two
// concurrent ones across it, merged into a single list. The all-or-nothing rule is the point: a
// piece that fails leaves the whole area unanswered, because reporting half of it would let a
// caller cache a partial answer as complete and hide everything on the other side of the seam.
//
// `keyOf` identifies the subject an item belongs to, so an item whose subject an EARLIER piece
// already reported is dropped. Deduplicating across pieces rather than across items is what lets a
// subject legitimately carry several items (a vessel with several track lines) while still
// collapsing what both pieces return for whatever sits on 180 itself.
export async function fetchAcrossSeam<T>(
  bbox: Bbox4,
  fetchBox: (box: Bbox4) => Promise<T[] | undefined>,
  keyOf: (item: T) => string,
): Promise<T[] | undefined> {
  const boxes = splitAtAntimeridian(bbox);
  if (boxes.length === 0) return undefined;
  const answers = await Promise.all(boxes.map(fetchBox));
  const merged: T[] = [];
  const seen = new Set<string>();
  for (const answer of answers) {
    if (!answer) return undefined;
    const fromThisPiece = new Set<string>();
    for (const item of answer) {
      const key = keyOf(item);
      if (seen.has(key)) continue;
      fromThisPiece.add(key);
      merged.push(item);
    }
    for (const key of fromThisPiece) seen.add(key);
  }
  return merged;
}

// Whether outer fully encloses inner, for cache-coverage checks. Not to be confused with the
// same-named check in $entities/weather, which normalizes both boxes itself; this one deliberately
// does not, and leaves seam normalization to the request edge (fetchAcrossSeam). Both boxes must be
// expressed the same way: west below east, in the possibly-unwrapped space padBbox and the MapLibre viewport
// share. The edge comparisons are meaningless for a box in the west greater than east crossing
// convention (boundsOfPoints emits those; they are for fitting, not for coverage).
export function bboxContains(outer: Bbox4, inner: Bbox4): boolean {
  return (
    outer[0] <= inner[0] && outer[1] <= inner[1] && outer[2] >= inner[2] && outer[3] >= inner[3]
  );
}

// Whether a non-crossing box contains a point, for an in-view check before a camera move. Same
// non-crossing caveat as bboxContains: the edge comparisons are meaningless for a box that wraps the
// antimeridian. Callers pass a viewport box, which MapLibre reports non-crossing.
export function bboxContainsPoint(box: Readonly<Bbox4>, p: LatLon): boolean {
  return (
    p.longitude >= box[0] && p.longitude <= box[2] && p.latitude >= box[1] && p.latitude <= box[3]
  );
}

// The four edge getters a MapLibre LngLatBounds exposes, typed structurally so $shared/geo does not
// depend on maplibre-gl and a test can pass a plain object.
export interface LngLatBoundsLike {
  getWest(): number;
  getSouth(): number;
  getEast(): number;
  getNorth(): number;
}

// A MapLibre LngLatBounds as a [west, south, east, north] box (the visible area as a Bbox4).
// Shared by the chart viewport read and the notes and AIS-trails overlays. MapLibre reports a
// non-crossing viewport, so the box feeds the non-crossing padBbox and bboxContains path.
export function lngLatBoundsToBbox4(b: LngLatBoundsLike): Bbox4 {
  return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
}

// The bounding box enclosing a set of positions, or undefined when empty, for fitting the chart to a
// route or a track. A single point yields a zero-area box the caller pads before fitting. A set that
// straddles the antimeridian yields a box in the west > east crossing convention, so the fit takes
// the short way across 180 rather than framing nearly the whole globe.
export function boundsOfPoints(points: readonly LatLon[]): Bbox4 | undefined {
  if (points.length === 0) return undefined;
  let west = Number.POSITIVE_INFINITY;
  let south = Number.POSITIVE_INFINITY;
  let east = Number.NEGATIVE_INFINITY;
  let north = Number.NEGATIVE_INFINITY;
  // The same longitudes with the western hemisphere shifted to follow the eastern (lon < 0 becomes
  // lon + 360). When this wrapped interval is narrower than the naive one, the points straddle the
  // antimeridian and the box that crosses the seam is the intended fit.
  let shiftedWest = Number.POSITIVE_INFINITY;
  let shiftedEast = Number.NEGATIVE_INFINITY;
  for (const { latitude, longitude } of points) {
    if (longitude < west) west = longitude;
    if (longitude > east) east = longitude;
    if (latitude < south) south = latitude;
    if (latitude > north) north = latitude;
    const shifted = longitude < 0 ? longitude + 360 : longitude;
    if (shifted < shiftedWest) shiftedWest = shifted;
    if (shifted > shiftedEast) shiftedEast = shifted;
  }
  if (shiftedEast - shiftedWest < east - west) {
    // Express the crossing box in the west > east convention padBbox and normalizeBounds handle,
    // wrapping a shifted longitude past 180 back into [-180, 180].
    const wrap = (lon: number): number => (lon > 180 ? lon - 360 : lon);
    return [wrap(shiftedWest), south, wrap(shiftedEast), north];
  }
  return [west, south, east, north];
}
