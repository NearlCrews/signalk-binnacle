import { computeStats, splitAtGaps, type TrackPoint, toLonLat } from '$entities/track';
import { isLonLat } from '$shared/geo';
import { isFiniteNumber } from '$shared/lib';
import { antimeridianLineGeometry, featureCollection } from '$shared/map';
import {
  cleanResourceId,
  deleteResourceOutcome,
  fetchKeyedResource,
  fetchProviderIdList,
  putResourceOutcome,
  type ResourceMutationResult,
} from '$shared/signalk';
import { toGeoJsonFeature } from './track-export';

// A track read back from the Signal K resources API. Points are grouped one array per segment
// (the breaks between them are gaps). The fetched GeoJSON carries only position, so t and sog
// are absent here; the saved overlay renders saved tracks in a single color, not by speed.
export interface SavedTrack {
  id: string;
  name: string;
  points: TrackPoint[][];
  // SI distance (meters) and timespan (seconds) saved alongside the geometry, when present, so the
  // panel can show a track's stats without re-walking every point. Absent for tracks saved elsewhere.
  distanceMeters?: number;
  durationSeconds?: number;
}

// One line geometry per segment, for the saved tracks the user has chosen to show. Saved tracks
// draw in a single color, so no per-point speed is carried.
export function savedTracksToFeatures(
  tracks: readonly SavedTrack[],
  shownIds: ReadonlySet<string>,
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const track of tracks) {
    if (!shownIds.has(track.id)) continue;
    for (const segment of track.points) {
      if (segment.length < 2) continue;
      features.push({
        type: 'Feature',
        geometry: antimeridianLineGeometry(segment.map(toLonLat)),
        properties: { id: track.id },
      });
    }
  }
  return featureCollection(features);
}

const V2 = '/signalk/v2/api/resources/tracks';
const V1 = '/signalk/v1/api/resources/tracks';
const MAX_SAVED_TRACKS = 500;
const MAX_POINTS_PER_TRACK = 100_000;
const MAX_TRACK_PROVIDERS = 8;

interface RawGeometry {
  type?: unknown;
  coordinates?: unknown;
}

// A stored track may arrive as a Feature, a Feature nested under `feature`, or a bare geometry;
// pull the line geometry out of whichever shape the provider returned.
function extractGeometry(value: unknown): RawGeometry | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const v = value as { geometry?: unknown; feature?: { geometry?: unknown }; type?: unknown };
  if (v.geometry && typeof v.geometry === 'object') return v.geometry as RawGeometry;
  if (v.feature?.geometry && typeof v.feature.geometry === 'object') {
    return v.feature.geometry as RawGeometry;
  }
  if (v.type === 'MultiLineString' || v.type === 'LineString') return v as RawGeometry;
  return undefined;
}

function lineToPoints(line: unknown, remaining: number): TrackPoint[] {
  if (!Array.isArray(line)) return [];
  const points: TrackPoint[] = [];
  for (const coord of line) {
    if (points.length >= remaining) break;
    if (isLonLat(coord)) points.push({ lat: coord[1], lon: coord[0], t: 0, sog: 0 });
  }
  return points;
}

function geometryToSegments(geom: RawGeometry): TrackPoint[][] {
  // A line needs two positions; drop degenerate single-coordinate segments so a SavedTrack
  // never carries a point that cannot draw and would be silently dropped downstream.
  if (geom.type === 'MultiLineString' && Array.isArray(geom.coordinates)) {
    const segments: TrackPoint[][] = [];
    let remaining = MAX_POINTS_PER_TRACK;
    for (const line of geom.coordinates) {
      const segment = lineToPoints(line, remaining);
      remaining -= segment.length;
      if (segment.length >= 2) segments.push(segment);
      if (remaining === 0) break;
    }
    return segments;
  }
  if (geom.type === 'LineString') {
    const segment = lineToPoints(geom.coordinates, MAX_POINTS_PER_TRACK);
    return segment.length >= 2 ? [segment] : [];
  }
  return [];
}

function trackName(value: unknown, id: string): string {
  if (value && typeof value === 'object') {
    const v = value as { name?: unknown; properties?: { name?: unknown } };
    const name =
      typeof v.properties?.name === 'string'
        ? v.properties.name
        : typeof v.name === 'string'
          ? v.name
          : '';
    const trimmed = name.trim();
    if (trimmed) return trimmed.slice(0, 256);
  }
  return id;
}

// Read a finite numeric metadata field (distance, timespan) from whichever shape carries properties.
function trackMetric(value: unknown, key: 'distance' | 'timespan'): number | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const v = value as {
    properties?: Record<string, unknown>;
    feature?: { properties?: Record<string, unknown> };
  };
  const raw = v.properties?.[key] ?? v.feature?.properties?.[key];
  return isFiniteNumber(raw) && raw >= 0 ? raw : undefined;
}

// Map one keyed track record to a SavedTrack, or undefined when it carries no drawable line.
function toSavedTrack(id: string, raw: unknown): SavedTrack | undefined {
  const geom = extractGeometry(raw);
  if (!geom) return undefined;
  const segments = geometryToSegments(geom);
  if (segments.length === 0) return undefined;
  return {
    id,
    name: trackName(raw, id),
    points: segments,
    distanceMeters: trackMetric(raw, 'distance'),
    durationSeconds: trackMetric(raw, 'timespan'),
  };
}

// Undefined means both endpoints were unreachable, so a caller can keep the current list rather than
// blanking it over a transient failure. A reachable but empty resource resolves to an empty array.
export async function fetchSavedTracks(
  base: string,
  token?: string,
): Promise<SavedTrack[] | undefined> {
  let accepted = 0;
  return fetchKeyedResource(
    base,
    [V2, V1],
    token,
    (id, raw) => {
      // The collection guard permits more entries than the UI accepts. Stop decoding geometry as
      // soon as the saved-track budget is full instead of walking every remaining coordinate.
      if (accepted >= MAX_SAVED_TRACKS) return undefined;
      const track = toSavedTrack(id, raw);
      if (track) accepted += 1;
      return track;
    },
    (url, status) => console.warn(`[tracks] ${url} returned ${status}`),
  );
}

// Whether this server can store tracks at all. Tracks are not a standard Signal K resource type, and
// the bundled resources provider registers only the custom types an administrator configures, so a
// stock server has no provider behind /resources/tracks. Both the collection read and a save then
// answer 404 ahead of the auth gate, which makes a status-only guess unsafe: a registered provider
// that throws during a PUT answers 404 too. The _providers sub-route is the honest signal, and the
// resources API answers it with an array of provider ids, so undefined (the probe never answered)
// stays distinct from a confirmed empty list.
export async function fetchTracksProvisioned(
  base: string,
  token?: string,
): Promise<boolean | undefined> {
  const providers = await fetchProviderIdList(
    `${base}${V2}/_providers`,
    token,
    MAX_TRACK_PROVIDERS,
  );
  if (!providers) return undefined;
  return providers.ids.length > 0;
}

export function savedTrackFromPoints(
  id: string,
  name: string,
  points: readonly TrackPoint[],
): SavedTrack {
  const stats = computeStats(points);
  return {
    id,
    name: name.trim() || id,
    points: splitAtGaps(points).filter((segment) => segment.length >= 2),
    distanceMeters: stats.distanceMeters,
    durationSeconds: stats.durationSeconds,
  };
}

// Splits the points into a MultiLineString at gaps; distance (meters) and timespan (seconds)
// ride along as SI metadata. Returns whether the write succeeded.
export function saveTrack(
  base: string,
  token: string | undefined,
  id: string,
  name: string,
  points: readonly TrackPoint[],
): Promise<ResourceMutationResult> {
  const stats = computeStats(points);
  // Reuse the export's Feature (geometry plus the name and source tag); add the SI stats.
  const baseFeature = toGeoJsonFeature(name, points);
  const feature: GeoJSON.Feature = {
    ...baseFeature,
    properties: {
      ...baseFeature.properties,
      distance: stats.distanceMeters,
      timespan: stats.durationSeconds,
    },
  };
  const safeId = cleanResourceId(id);
  if (!safeId) return Promise.resolve('failed');
  return putResourceOutcome(`${base}${V2}/${encodeURIComponent(safeId)}`, token, feature);
}

export function deleteTrack(
  base: string,
  token: string | undefined,
  id: string,
): Promise<ResourceMutationResult> {
  const safeId = cleanResourceId(id);
  if (!safeId) return Promise.resolve('failed');
  return deleteResourceOutcome(`${base}${V2}/${encodeURIComponent(safeId)}`, token);
}
