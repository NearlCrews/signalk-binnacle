import type { Route, RouteWaypoint } from '$entities/route';
import { isLatitude, isLongitude } from '$shared/geo';
import { uuidv4 } from '$shared/lib';
import { unescapeXml } from './xml-entities';

// An optional namespace prefix (gpx:, ns3:, ...) precedes the element name in some exports.
const RTE = /<(?:\w+:)?rte\b[^>]*>([\s\S]*?)<\/(?:\w+:)?rte>/gi;
const RTEPT = /<(?:\w+:)?rtept\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?rtept>)/gi;
const NAME = /<(?:\w+:)?name\b[^>]*>([\s\S]*?)<\/(?:\w+:)?name>/i;
const LAT = /\blat\s*=\s*["']([^"']*)["']/i;
const LON = /\blon\s*=\s*["']([^"']*)["']/i;
const MAX_GPX_CHARACTERS = 5 * 1024 * 1024;
const MAX_GPX_ROUTES = 100;
const MAX_GPX_WAYPOINTS = 10_000;

export type GpxParseError = 'file-too-large' | 'too-many-routes' | 'too-many-waypoints';

export interface GpxParseResult {
  routes: Route[];
  error?: GpxParseError;
}

function attrNumber(attrs: string, pattern: RegExp): number {
  const m = attrs.match(pattern);
  if (!m || m[1].trim() === '') return Number.NaN;
  return Number(m[1]);
}

function parseWaypoints(block: string, remaining: number): RouteWaypoint[] | undefined {
  const waypoints: RouteWaypoint[] = [];
  for (const pt of block.matchAll(RTEPT)) {
    const latitude = attrNumber(pt[1], LAT);
    const longitude = attrNumber(pt[1], LON);
    if (!isLatitude(latitude) || !isLongitude(longitude)) continue;
    if (waypoints.length >= remaining) return undefined;
    const nameMatch = pt[2]?.match(NAME);
    const name = nameMatch ? unescapeXml(nameMatch[1]).trim() : '';
    waypoints.push(
      name ? { position: { latitude, longitude }, name } : { position: { latitude, longitude } },
    );
  }
  return waypoints;
}

// Parse the <rte> elements of a GPX document into routes, the inverse of routeToGpx. Coordinates are
// WGS84 decimal degrees, so rtept lat/lon map straight to a waypoint position. Tolerant of namespace
// prefixes, attribute order, and self-closing rtepts; routes with fewer than two valid points are
// dropped. Returns an empty array when the text holds no usable route.
export function parseGpxRoutesDetailed(xml: string): GpxParseResult {
  if (
    xml.length > MAX_GPX_CHARACTERS ||
    new TextEncoder().encode(xml).byteLength > MAX_GPX_CHARACTERS
  ) {
    return { routes: [], error: 'file-too-large' };
  }
  const routes: Route[] = [];
  let waypointCount = 0;
  for (const rte of xml.matchAll(RTE)) {
    if (routes.length >= MAX_GPX_ROUTES) return { routes: [], error: 'too-many-routes' };
    const block = rte[1];
    const waypoints = parseWaypoints(block, MAX_GPX_WAYPOINTS - waypointCount);
    if (!waypoints) return { routes: [], error: 'too-many-waypoints' };
    if (waypoints.length < 2) continue;
    waypointCount += waypoints.length;
    // The route name is the <name> before the first rtept, not a waypoint's name.
    const head = block.search(/<(?:\w+:)?rtept\b/i);
    const nameMatch = (head >= 0 ? block.slice(0, head) : block).match(NAME);
    const name = nameMatch ? unescapeXml(nameMatch[1]).trim() : '';
    routes.push({ id: uuidv4(), name: name || `Imported route ${routes.length + 1}`, waypoints });
  }
  return { routes };
}

export function parseGpxRoutes(xml: string): Route[] {
  return parseGpxRoutesDetailed(xml).routes;
}
