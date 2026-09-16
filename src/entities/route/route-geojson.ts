import { isLonLat, type LonLat, latLonToLonLat, lonLatToLatLon } from '$shared/geo';
import { isRecord } from '$shared/lib';
import { rhumbBearingRad, rhumbDistanceMeters } from '$shared/nav';
import { cleanResourceId, cleanTruncatedText } from '$shared/signalk';
import type { Route, RouteWaypoint } from './route-types';

export const MAX_ROUTE_WAYPOINTS = 10_000;
const MAX_ROUTE_NAME_LENGTH = 256;
const MAX_ROUTE_WAYPOINT_NAME_LENGTH = 256;

export function cleanRouteId(value: unknown): string | undefined {
  return cleanResourceId(value);
}

// The Signal K v2 route resource body: a GeoJSON Feature with a LineString, plus name and the
// total SI distance. Per-waypoint names ride in properties.coordinatesMeta, index-aligned.
export interface RouteResourceBody {
  name: string;
  distance: number;
  feature: {
    type: 'Feature';
    geometry: { type: 'LineString'; coordinates: LonLat[] };
    // The Signal K route schema requires every coordinatesMeta entry to carry a name or href.
    properties: Record<string, unknown> & { coordinatesMeta?: Array<Record<string, unknown>> };
  };
}

export function routeToFeature(route: Route): RouteResourceBody {
  // The server validates the standard route resource: each coordinatesMeta entry must have a name
  // (or href), so an unnamed-waypoint placeholder of {} is rejected. Emit coordinatesMeta only when
  // a waypoint is named, filling the unnamed gaps with their 1-based index, and omit it otherwise.
  const names = route.waypoints.map((waypoint) =>
    cleanTruncatedText(waypoint.name, MAX_ROUTE_WAYPOINT_NAME_LENGTH),
  );
  const named =
    names.some(Boolean) || route.waypoints.some((waypoint) => waypoint.metadata !== undefined);
  const properties = named
    ? {
        ...route.properties,
        coordinatesMeta: names.map((name, index) => {
          const metadata = route.waypoints[index].metadata;
          return {
            ...metadata,
            ...(name ? { name } : metadata?.href ? {} : { name: `${index + 1}` }),
          };
        }),
      }
    : { ...route.properties };
  const coordinates = route.waypoints.map((waypoint) => latLonToLonLat(waypoint.position));
  const featureExtras = { ...route.featureExtras };
  if (Object.hasOwn(featureExtras, 'bbox')) {
    // A supplied extent remains useful, but must follow moved or removed vertices.
    featureExtras.bbox = coordinates.reduce(
      ([west, south, east, north], [lon, lat]) => [
        Math.min(west, lon),
        Math.min(south, lat),
        Math.max(east, lon),
        Math.max(north, lat),
      ],
      [Infinity, Infinity, -Infinity, -Infinity],
    );
  }
  return {
    ...route.resourceExtras,
    name:
      cleanTruncatedText(route.name, MAX_ROUTE_NAME_LENGTH) ?? cleanRouteId(route.id) ?? 'Route',
    distance: routeDistanceMeters(route.waypoints),
    feature: {
      ...featureExtras,
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates,
      },
      properties,
    },
  };
}

export function featureToRoute(id: string, raw: unknown): Route | undefined {
  const safeId = cleanRouteId(id);
  if (!safeId) return undefined;
  if (!isRecord(raw)) return undefined;
  const r = raw as {
    name?: unknown;
    feature?: {
      geometry?: { type?: unknown; coordinates?: unknown };
      properties?: { coordinatesMeta?: unknown };
    };
  };
  const geom = r.feature?.geometry;
  if (geom?.type !== 'LineString' || !Array.isArray(geom.coordinates)) return undefined;
  if (geom.coordinates.length < 2 || geom.coordinates.length > MAX_ROUTE_WAYPOINTS)
    return undefined;
  const meta = Array.isArray(r.feature?.properties?.coordinatesMeta)
    ? (r.feature?.properties?.coordinatesMeta as Array<{ name?: unknown }>)
    : [];
  const waypoints: RouteWaypoint[] = [];
  for (const [i, coord] of geom.coordinates.entries()) {
    if (!isLonLat(coord)) return undefined;
    const name = cleanTruncatedText(meta[i]?.name, MAX_ROUTE_WAYPOINT_NAME_LENGTH);
    const metadata = extras(meta[i], ['name']);
    waypoints.push({
      position: lonLatToLatLon(coord),
      ...(name ? { name } : {}),
      ...(metadata ? { metadata } : {}),
    });
  }
  const name = cleanTruncatedText(r.name, MAX_ROUTE_NAME_LENGTH) ?? safeId;
  const resourceExtras = extras(raw, ['name', 'distance', 'feature']);
  const featureExtras = extras(r.feature, ['type', 'geometry', 'properties']);
  const properties = extras(r.feature?.properties, ['coordinatesMeta']);
  return {
    id: safeId,
    name,
    waypoints,
    ...(resourceExtras ? { resourceExtras } : {}),
    ...(featureExtras ? { featureExtras } : {}),
    ...(properties ? { properties } : {}),
  };
}

function extras(raw: unknown, excluded: readonly string[]): Record<string, unknown> | undefined {
  if (!isRecord(raw)) return undefined;
  const entries = Object.entries(raw).filter(([key]) => !excluded.includes(key));
  return entries.length ? Object.fromEntries(entries) : undefined;
}

export function routeDistanceMeters(waypoints: readonly RouteWaypoint[]): number {
  return remainingRouteDistanceMeters(waypoints, 0);
}

// The rhumb distance of the legs still ahead, starting at fromIndex (the active destination
// waypoint). The whole-route distance-to-go is this plus the boat's distance to that next waypoint,
// so a passage planner can show total remaining distance and arrival time, not just the next leg.
export function remainingRouteDistanceMeters(
  waypoints: readonly RouteWaypoint[],
  fromIndex: number,
): number {
  let total = 0;
  for (let i = Math.max(0, fromIndex); i < waypoints.length - 1; i += 1) {
    total += rhumbDistanceMeters(waypoints[i].position, waypoints[i + 1].position);
  }
  return total;
}

export function routeDistanceToGoMeters(
  waypoints: readonly RouteWaypoint[],
  activePointIndex: number,
  distanceToNextMeters: number,
  reversed: boolean,
): number | undefined {
  if (
    !Number.isSafeInteger(activePointIndex) ||
    activePointIndex < 0 ||
    activePointIndex >= waypoints.length ||
    waypoints.length - activePointIndex <= 1 ||
    !Number.isFinite(distanceToNextMeters) ||
    distanceToNextMeters < 0
  ) {
    return undefined;
  }
  const traversal = reversed ? waypoints.toReversed() : waypoints;
  return distanceToNextMeters + remainingRouteDistanceMeters(traversal, activePointIndex);
}

// One leg of a route: its zero-based start-waypoint index, rhumb distance, and rhumb (steered)
// bearing, for a leg-by-leg readout of a plan the way a navigator reads a passage on paper.
export interface RouteLeg {
  fromIndex: number;
  distanceMeters: number;
  bearingRad: number;
}

// One Point per waypoint with its zero-based index and a name-or-number label. The saved-route
// overlay tags each point with its route id; the working overlay needs none, so both overlays build
// their waypoint points from one helper.
export function waypointPointFeatures(
  waypoints: readonly RouteWaypoint[],
  extra?: { id?: string },
): GeoJSON.Feature[] {
  return waypoints.map((w, index) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: latLonToLonLat(w.position) },
    properties: { ...extra, index, name: w.name ?? `${index + 1}` },
  }));
}

export function routeLegs(waypoints: readonly RouteWaypoint[]): RouteLeg[] {
  const legs: RouteLeg[] = [];
  for (let i = 1; i < waypoints.length; i += 1) {
    legs.push({
      fromIndex: i - 1,
      distanceMeters: rhumbDistanceMeters(waypoints[i - 1].position, waypoints[i].position),
      bearingRad: rhumbBearingRad(waypoints[i - 1].position, waypoints[i].position),
    });
  }
  return legs;
}
