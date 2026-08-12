import { isLonLat, type LonLat, latLonToLonLat, lonLatToLatLon } from '$shared/geo';
import { hasControlCharacters, isRecord } from '$shared/lib';
import { cleanTruncatedText, str } from '$shared/signalk';
import type { Waypoint } from './waypoint-types';

export const MAX_WAYPOINT_NAME_LENGTH = 256;
const MAX_WAYPOINT_DESCRIPTION_LENGTH = 10_000;
const MAX_WAYPOINT_ICON_LENGTH = 256;
const MAX_WAYPOINT_ID_LENGTH = 512;

export function cleanWaypointId(value: unknown): string | undefined {
  const text = str(value);
  if (
    !text ||
    text.length > MAX_WAYPOINT_ID_LENGTH ||
    text !== text.trim() ||
    hasControlCharacters(text)
  ) {
    return undefined;
  }
  return text;
}

export function cleanWaypointName(value: unknown, fallback: string): string {
  return (
    cleanTruncatedText(value, MAX_WAYPOINT_NAME_LENGTH) ??
    fallback.slice(0, MAX_WAYPOINT_NAME_LENGTH)
  );
}

export function cleanWaypointIcon(value: unknown): string | undefined {
  return cleanTruncatedText(value, MAX_WAYPOINT_ICON_LENGTH);
}

// The Signal K v2 waypoint resource body: name and description ride at the top level (not in
// feature.properties), and the feature wraps a GeoJSON Point in [longitude, latitude] order,
// per the server's WaypointSchema.
interface WaypointResourceBody {
  name: string;
  description?: string;
  feature: {
    type: 'Feature';
    geometry: { type: 'Point'; coordinates: LonLat };
    // skIcon is a Symbols API reference; absent for the default marker.
    properties: { skIcon?: string };
  };
}

export function waypointToFeature(waypoint: Waypoint): WaypointResourceBody {
  const fallbackName = cleanWaypointId(waypoint.id) ?? 'Waypoint';
  const name = cleanWaypointName(waypoint.name, fallbackName);
  const description = cleanTruncatedText(waypoint.description, MAX_WAYPOINT_DESCRIPTION_LENGTH);
  const icon = cleanWaypointIcon(waypoint.icon);
  return {
    name,
    ...(description ? { description } : {}),
    feature: {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: latLonToLonLat(waypoint.position) },
      properties: { skIcon: icon ?? 'waypoint' },
    },
  };
}

export function featureToWaypoint(id: string, raw: unknown): Waypoint | undefined {
  const safeId = cleanWaypointId(id);
  if (!safeId) return undefined;
  if (!isRecord(raw)) return undefined;
  const w = raw as {
    name?: unknown;
    description?: unknown;
    feature?: {
      geometry?: { type?: unknown; coordinates?: unknown };
      properties?: { skIcon?: unknown };
    };
  };
  const geom = w.feature?.geometry;
  if (geom?.type !== 'Point' || !isLonLat(geom.coordinates)) return undefined;
  const description = cleanTruncatedText(w.description, MAX_WAYPOINT_DESCRIPTION_LENGTH);
  const icon = cleanWaypointIcon(w.feature?.properties?.skIcon);
  return {
    id: safeId,
    name: cleanWaypointName(w.name, safeId),
    position: lonLatToLatLon(geom.coordinates),
    ...(description ? { description } : {}),
    ...(icon ? { icon } : {}),
  };
}
