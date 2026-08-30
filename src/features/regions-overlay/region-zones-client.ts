import {
  bboxCenter,
  boundsOfPoints,
  isLonLat,
  type LonLat,
  latLonToLonLat,
  lonLatToLatLon,
  unwrapEast,
} from '$shared/geo';
import { cleanBoundedText, isRecord } from '$shared/lib';
import { asKeyedObject, cleanTruncatedText, fetchAuthedJsonOutcome } from '$shared/signalk';

// The Signal K regions resource: named geographic areas other tools publish to the server, such as
// exclusion zones, no-anchor zones, and race areas. Per the server API a region is
// { name?, description?, feature } with a GeoJSON Feature carrying Polygon or MultiPolygon
// geometry, keyed by resource id. "Region zone" naming throughout this slice keeps it apart from
// the prewarm slice's offline chart regions, which are a different concept.

export const REGION_ZONES_PATH = '/signalk/v2/api/resources/regions';
export const REGION_ZONES_V1_PATH = '/signalk/v1/api/resources/regions';
export const MAX_REGION_ZONES = 500;
export const MAX_REGION_ZONE_VERTICES = 10_000;
const MAX_NAME_LENGTH = 256;
const MAX_DESCRIPTION_LENGTH = 2_048;

export type RegionZoneSeverity = 'warning' | 'neutral';

export interface RegionZone {
  id: string;
  name: string;
  description?: string;
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
  // The [lon, lat] anchor for the on-chart name label: the bounding-box center of the largest
  // outer ring.
  labelPosition: LonLat;
  severity: RegionZoneSeverity;
}

export type RegionZonesFetchResult =
  | { state: 'ok'; regions: RegionZone[] }
  | { state: 'unavailable' }
  | { state: 'error' };

// Whether a zone's wording marks it as an anchoring prohibition, which gets the warning paint on
// the chart. Substring checks over the lowercased text: "no anchor" covers "no anchoring" and
// "no anchorage", the hyphenated form covers "no-anchor zone", and the anchor-plus-prohibit pair
// covers "anchoring prohibited" and "prohibited anchorage" in either order.
export function isAnchoringProhibition(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes('no anchor') ||
    lower.includes('no-anchor') ||
    (lower.includes('anchor') && lower.includes('prohibit'))
  );
}

interface VertexBudget {
  left: number;
}

// A validated copy of one linear ring: every position a finite in-range [lon, lat] pair, with any
// altitude element dropped so the map payload stays lean. GeoJSON requires at least four positions
// (a closed ring); closure itself is not enforced, since MapLibre renders an unclosed ring fine
// and rejecting one would drop a zone another tool draws.
function cleanRing(raw: unknown, budget: VertexBudget): LonLat[] | undefined {
  if (!Array.isArray(raw) || raw.length < 4) return undefined;
  budget.left -= raw.length;
  if (budget.left < 0) return undefined;
  const ring: LonLat[] = [];
  for (const position of raw) {
    if (!isLonLat(position)) return undefined;
    ring.push([position[0], position[1]]);
  }
  return ring;
}

function cleanRings(raw: unknown, budget: VertexBudget): LonLat[][] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const rings: LonLat[][] = [];
  for (const entry of raw) {
    const ring = cleanRing(entry, budget);
    if (!ring) return undefined;
    rings.push(ring);
  }
  return rings;
}

// A validated copy of the region's geometry, or undefined to reject the whole region: a provider
// entry with a malformed or oversized polygon never reaches the map. The vertex budget spans every
// ring of the region.
function cleanGeometry(raw: unknown): GeoJSON.Polygon | GeoJSON.MultiPolygon | undefined {
  if (!isRecord(raw)) return undefined;
  const budget: VertexBudget = { left: MAX_REGION_ZONE_VERTICES };
  if (raw.type === 'Polygon') {
    const rings = cleanRings(raw.coordinates, budget);
    return rings ? { type: 'Polygon', coordinates: rings } : undefined;
  }
  if (raw.type === 'MultiPolygon') {
    if (!Array.isArray(raw.coordinates) || raw.coordinates.length === 0) return undefined;
    const polygons: LonLat[][][] = [];
    for (const entry of raw.coordinates) {
      const rings = cleanRings(entry, budget);
      if (!rings) return undefined;
      polygons.push(rings);
    }
    return { type: 'MultiPolygon', coordinates: polygons };
  }
  return undefined;
}

// The bounding-box center of the largest outer ring, so a MultiPolygon labels its main area rather
// than the gap between parts. boundsOfPoints and bboxCenter carry the antimeridian handling, and
// the size comparison unwraps the east edge for the same reason.
function labelPositionFor(geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon): LonLat | undefined {
  const outerRings =
    geometry.type === 'Polygon' ? [geometry.coordinates[0]] : geometry.coordinates.map((p) => p[0]);
  let best: LonLat | undefined;
  let bestSize = -1;
  for (const ring of outerRings) {
    const bounds = boundsOfPoints(ring.map((position) => lonLatToLatLon(position as LonLat)));
    if (!bounds) continue;
    const [west, south, east, north] = bounds;
    const size = (unwrapEast(west, east) - west) * (north - south);
    if (size > bestSize) {
      bestSize = size;
      best = latLonToLonLat(bboxCenter(bounds));
    }
  }
  return best;
}

// Map one keyed resource entry to a RegionZone, or undefined to skip it. An error payload arriving
// as an entry has no valid feature geometry, so it falls through here.
function regionFromEntry(id: string, raw: unknown): RegionZone | undefined {
  const resourceId = cleanBoundedText(id, 512);
  if (!resourceId || !isRecord(raw)) return undefined;
  const feature = isRecord(raw.feature) ? raw.feature : undefined;
  const geometry = cleanGeometry(feature?.geometry);
  if (!geometry) return undefined;
  const center = labelPositionFor(geometry);
  if (!center) return undefined;
  const name = cleanTruncatedText(raw.name, MAX_NAME_LENGTH) ?? resourceId;
  const description = cleanTruncatedText(raw.description, MAX_DESCRIPTION_LENGTH);
  return {
    id: resourceId,
    name,
    description,
    geometry,
    labelPosition: center,
    severity: isAnchoringProhibition(`${name} ${description ?? ''}`) ? 'warning' : 'neutral',
  };
}

// Fetch the full regions collection, v2 first with a read-only v1 fallback like the other resource
// clients. The result separates the causes a caller handles differently: 'unavailable' means every
// path answered 404 (no regions endpoint on this server), while 'error' covers an unreachable
// server, a refused status, or a malformed body, so shown zones can be retained on a transient
// failure and a missing provider is only reported when the server actually said so.
export async function fetchRegionZones(
  origin: string,
  token: string | undefined,
): Promise<RegionZonesFetchResult> {
  let sawFailure = false;
  for (const path of [REGION_ZONES_PATH, REGION_ZONES_V1_PATH]) {
    const outcome = await fetchAuthedJsonOutcome<unknown>(`${origin}${path}`, token);
    if (outcome.state === 'not-found') continue;
    if (outcome.state === 'failed') {
      sawFailure = true;
      continue;
    }
    const keyed = asKeyedObject(outcome.value);
    if (!keyed) {
      sawFailure = true;
      continue;
    }
    const regions: RegionZone[] = [];
    for (const [id, entry] of Object.entries(keyed)) {
      if (regions.length >= MAX_REGION_ZONES) break;
      const region = regionFromEntry(id, entry);
      if (region) regions.push(region);
    }
    return { state: 'ok', regions };
  }
  return sawFailure ? { state: 'error' } : { state: 'unavailable' };
}
