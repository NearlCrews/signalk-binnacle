import { splitAtGaps, type TrackPoint, toLonLat } from '$entities/track';
import { downloadText, portableFilename } from '$shared/lib';

// Split a flat point list into per-segment runs, breaking at gap points so a dropout shows as a
// real break. Single-point runs are dropped: a LineString needs two positions, so a lone fix
// cannot form a line.
function pointSegments(points: readonly TrackPoint[]): (readonly TrackPoint[])[] {
  return splitAtGaps(points).filter((segment) => segment.length >= 2);
}

// Per-point capture times mirroring the MultiLineString coordinates (the GeoJSON coordTimes
// convention): one array per segment, one RFC 3339 string per coordinate. Omitted entirely unless
// every kept point carries a real timestamp: a track loaded from a resource saved without times
// has t 0 on every point, and a partially timed feature would put 1970 stamps beside real ones.
function coordTimes(segments: readonly (readonly TrackPoint[])[]): string[][] | undefined {
  if (segments.length === 0) return undefined;
  const timed = segments.every((segment) =>
    segment.every((point) => Number.isFinite(point.t) && point.t > 0),
  );
  if (!timed) return undefined;
  return segments.map((segment) => segment.map((point) => new Date(point.t).toISOString()));
}

// The one Feature builder behind both entry points, so the geometry, the name and source tag, and
// the coordTimes cannot drift between the save and the download forms.
function featureFromSegments(
  name: string,
  segments: readonly (readonly TrackPoint[])[],
): GeoJSON.Feature {
  const times = coordTimes(segments);
  return {
    type: 'Feature',
    geometry: {
      type: 'MultiLineString',
      coordinates: segments.map((segment) => segment.map(toLonLat)),
    },
    properties: { name, source: 'binnacle', ...(times ? { coordTimes: times } : {}) },
  };
}

// A GeoJSON Feature with MultiLineString geometry: the portable, importable form of a track.
export function toGeoJsonFeature(name: string, points: readonly TrackPoint[]): GeoJSON.Feature {
  return featureFromSegments(name, pointSegments(points));
}

// The segments-input counterpart to toGeoJsonFeature, for a saved track's own segments rather
// than a flat point list carrying synthetic gap markers.
export function toGeoJsonFeatureFromSegments(
  name: string,
  segments: readonly (readonly TrackPoint[])[],
): GeoJSON.Feature {
  return featureFromSegments(
    name,
    segments.filter((segment) => segment.length >= 2),
  );
}

export function toGeoJsonString(name: string, points: readonly TrackPoint[]): string {
  return JSON.stringify(toGeoJsonFeature(name, points), null, 2);
}

export function trackGeoJsonFilename(name: string): string {
  return portableFilename(name, 'track', 'geojson');
}

// Trigger a browser download of the track as a .geojson file.
export function downloadGeoJson(name: string, points: readonly TrackPoint[]): void {
  downloadText(trackGeoJsonFilename(name), toGeoJsonString(name, points), 'application/geo+json');
}

// The segments-input counterpart to downloadGeoJson, for a saved track's own per-segment points.
export function downloadGeoJsonFromSegments(
  name: string,
  segments: readonly (readonly TrackPoint[])[],
): void {
  downloadText(
    trackGeoJsonFilename(name),
    JSON.stringify(toGeoJsonFeatureFromSegments(name, segments), null, 2),
    'application/geo+json',
  );
}
