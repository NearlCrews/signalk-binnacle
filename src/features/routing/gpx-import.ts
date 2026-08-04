import type { Route, RouteWaypoint } from '$entities/route';
import { isLatitude, isLongitude } from '$shared/geo';
import { uuidv4 } from '$shared/lib';
import { unescapeXml } from './xml-entities';

const MAX_GPX_CHARACTERS = 5 * 1024 * 1024;
const MAX_GPX_ROUTES = 100;
const MAX_GPX_WAYPOINTS = 10_000;
const MAX_GPX_NAME_LENGTH = 256;

type GpxParseError = 'file-too-large' | 'too-many-routes' | 'too-many-waypoints';

export interface GpxParseResult {
  routes: Route[];
  error?: GpxParseError;
  // The document held at least one <trk>. A file exported as tracks elsewhere parses to no routes
  // at all, which is worth saying rather than reporting an empty file.
  sawTracks?: boolean;
}

interface XmlTag {
  start: number;
  end: number;
  name: string;
  attrs: string;
  closing: boolean;
  selfClosing: boolean;
}

interface RouteDraft {
  depth: number;
  name?: string;
  seenPoint: boolean;
  waypoints: RouteWaypoint[];
}

interface PointDraft {
  depth: number;
  latitude: number;
  longitude: number;
  name?: string;
}

interface NameCapture {
  depth: number;
  start: number;
  target: RouteDraft | PointDraft;
}

function isXmlNameCharacter(character: string): boolean {
  return /[A-Za-z0-9_.:-]/.test(character);
}

// Find one tag end without a backtracking expression. A quoted `>` belongs to an attribute value,
// not the tag boundary. Returning -1 for an unfinished tag lets the caller stop in one pass.
function findTagEnd(xml: string, start: number): number {
  let quote = '';
  for (let index = start + 1; index < xml.length; index += 1) {
    const character = xml[index];
    if (quote) {
      if (character === quote) quote = '';
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '>') {
      return index;
    }
  }
  return -1;
}

function parseTag(xml: string, start: number, end: number): XmlTag | undefined {
  let index = start + 1;
  while (/\s/.test(xml[index] ?? '')) index += 1;
  if (xml[index] === '!' || xml[index] === '?') return undefined;
  const closing = xml[index] === '/';
  if (closing) index += 1;
  const nameStart = index;
  while (index < end && isXmlNameCharacter(xml[index])) index += 1;
  if (index === nameStart) return undefined;
  const qualifiedName = xml.slice(nameStart, index);
  const name = qualifiedName.slice(qualifiedName.lastIndexOf(':') + 1).toLowerCase();
  let contentEnd = end;
  while (contentEnd > index && /\s/.test(xml[contentEnd - 1])) contentEnd -= 1;
  const selfClosing = !closing && xml[contentEnd - 1] === '/';
  if (selfClosing) contentEnd -= 1;
  return {
    start,
    end,
    name,
    attrs: closing ? '' : xml.slice(index, contentEnd),
    closing,
    selfClosing,
  };
}

function attrNumber(attrs: string, wanted: 'lat' | 'lon'): number {
  let index = 0;
  while (index < attrs.length) {
    while (/\s/.test(attrs[index] ?? '')) index += 1;
    const nameStart = index;
    while (index < attrs.length && isXmlNameCharacter(attrs[index])) index += 1;
    if (index === nameStart) {
      index += 1;
      continue;
    }
    const qualifiedName = attrs.slice(nameStart, index);
    const name = qualifiedName.slice(qualifiedName.lastIndexOf(':') + 1).toLowerCase();
    while (/\s/.test(attrs[index] ?? '')) index += 1;
    if (attrs[index] !== '=') continue;
    index += 1;
    while (/\s/.test(attrs[index] ?? '')) index += 1;
    const quote = attrs[index];
    if (quote !== '"' && quote !== "'") continue;
    index += 1;
    const valueStart = index;
    while (index < attrs.length && attrs[index] !== quote) index += 1;
    if (index >= attrs.length) return Number.NaN;
    const value = attrs.slice(valueStart, index).trim();
    index += 1;
    if (name === wanted) return value === '' ? Number.NaN : Number(value);
  }
  return Number.NaN;
}

function parsedName(raw: string): string | undefined {
  const name = unescapeXml(raw).trim().slice(0, MAX_GPX_NAME_LENGTH);
  return name || undefined;
}

// Parse the <rte> elements of a GPX document into routes, the inverse of routeToGpx. Coordinates are
// WGS84 decimal degrees, so rtept lat/lon map straight to a waypoint position. Tolerant of namespace
// prefixes, attribute order, and self-closing rtepts; routes with fewer than two valid points are
// dropped. Returns an empty array when the text holds no usable route, with sawTracks set when the
// document carried <trk> elements, which a file exported as tracks elsewhere does.
export function parseGpxRoutesDetailed(xml: string): GpxParseResult {
  if (
    xml.length > MAX_GPX_CHARACTERS ||
    new TextEncoder().encode(xml).byteLength > MAX_GPX_CHARACTERS
  ) {
    return { routes: [], error: 'file-too-large' };
  }
  const routes: Route[] = [];
  let routeCount = 0;
  let waypointCount = 0;
  let route: RouteDraft | undefined;
  let point: PointDraft | undefined;
  let nameCapture: NameCapture | undefined;
  let sawTracks = false;
  let cursor = 0;

  const closeName = (at: number): void => {
    if (!nameCapture) return;
    nameCapture.depth -= 1;
    if (nameCapture.depth > 0) return;
    const name = parsedName(xml.slice(nameCapture.start, at));
    if (name && nameCapture.target.name === undefined) nameCapture.target.name = name;
    nameCapture = undefined;
  };
  const closePoint = (): void => {
    if (!point) return;
    point.depth -= 1;
    if (point.depth > 0) return;
    const completed = point;
    point = undefined;
    if (!route || !isLatitude(completed.latitude) || !isLongitude(completed.longitude)) return;
    route.waypoints.push(
      completed.name
        ? {
            position: { latitude: completed.latitude, longitude: completed.longitude },
            name: completed.name,
          }
        : { position: { latitude: completed.latitude, longitude: completed.longitude } },
    );
  };
  const closeRoute = (): void => {
    if (!route) return;
    route.depth -= 1;
    if (route.depth > 0) return;
    const completed = route;
    route = undefined;
    point = undefined;
    nameCapture = undefined;
    if (completed.waypoints.length < 2) return;
    routes.push({
      id: uuidv4(),
      name: completed.name ?? `Imported route ${routes.length + 1}`,
      waypoints: completed.waypoints,
    });
  };

  while (cursor < xml.length) {
    const start = xml.indexOf('<', cursor);
    if (start < 0) break;
    if (xml.startsWith('<!--', start)) {
      const end = xml.indexOf('-->', start + 4);
      if (end < 0) break;
      cursor = end + 3;
      continue;
    }
    if (xml.startsWith('<![CDATA[', start)) {
      const end = xml.indexOf(']]>', start + 9);
      if (end < 0) break;
      cursor = end + 3;
      continue;
    }
    if (xml.startsWith('<?', start)) {
      const end = xml.indexOf('?>', start + 2);
      if (end < 0) break;
      cursor = end + 2;
      continue;
    }
    const end = findTagEnd(xml, start);
    if (end < 0) break;
    const tag = parseTag(xml, start, end);
    cursor = end + 1;
    if (!tag) continue;

    if (tag.closing) {
      if (tag.name === 'name') closeName(tag.start);
      else if (tag.name === 'rtept') closePoint();
      else if (tag.name === 'rte') closeRoute();
      continue;
    }

    if (tag.name === 'trk') {
      sawTracks = true;
      continue;
    }
    if (tag.name === 'rte') {
      routeCount += 1;
      if (routeCount > MAX_GPX_ROUTES) return { routes: [], error: 'too-many-routes' };
      if (route) route.depth += 1;
      else route = { depth: 1, seenPoint: false, waypoints: [] };
      if (tag.selfClosing) closeRoute();
      continue;
    }
    if (tag.name === 'rtept' && route) {
      waypointCount += 1;
      if (waypointCount > MAX_GPX_WAYPOINTS) {
        return { routes: [], error: 'too-many-waypoints' };
      }
      route.seenPoint = true;
      if (point) point.depth += 1;
      else {
        point = {
          depth: 1,
          latitude: attrNumber(tag.attrs, 'lat'),
          longitude: attrNumber(tag.attrs, 'lon'),
        };
      }
      if (tag.selfClosing) closePoint();
      continue;
    }
    if (tag.name === 'name' && route) {
      if (nameCapture) nameCapture.depth += 1;
      else if (point || !route.seenPoint) {
        nameCapture = { depth: 1, start: tag.end + 1, target: point ?? route };
      }
      if (tag.selfClosing) closeName(tag.end);
    }
  }
  return sawTracks ? { routes, sawTracks } : { routes };
}

export function parseGpxRoutes(xml: string): Route[] {
  return parseGpxRoutesDetailed(xml).routes;
}
