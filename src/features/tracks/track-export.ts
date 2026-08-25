import { splitAtGaps, type TrackPoint, toLonLat } from '$entities/track';
import { downloadText, portableFilename } from '$shared/lib';

// Split a flat point list into per-segment coordinate arrays, breaking at gap points so a
// dropout shows as a real break. Each coordinate is GeoJSON [lon, lat]. Single-coordinate
// segments are dropped: a LineString needs two positions, so a lone fix cannot form a line.
function coordinateSegments(points: readonly TrackPoint[]): [number, number][][] {
  return splitAtGaps(points)
    .map((run) => run.map(toLonLat))
    .filter((segment) => segment.length >= 2);
}

// The same coordinate mapping and degenerate-segment filter, for input that is already split into
// segments (a saved track's own per-segment point arrays) and so needs no gap-splitting.
function coordinateSegmentsFromSegments(
  segments: readonly (readonly TrackPoint[])[],
): [number, number][][] {
  return segments.map((segment) => segment.map(toLonLat)).filter((segment) => segment.length >= 2);
}

// A GeoJSON Feature with MultiLineString geometry: the portable, importable form of a track.
export function toGeoJsonFeature(name: string, points: readonly TrackPoint[]): GeoJSON.Feature {
  return {
    type: 'Feature',
    geometry: { type: 'MultiLineString', coordinates: coordinateSegments(points) },
    properties: { name, source: 'binnacle' },
  };
}

// The segments-input counterpart to toGeoJsonFeature, for a saved track's own segments rather
// than a flat point list carrying synthetic gap markers.
export function toGeoJsonFeatureFromSegments(
  name: string,
  segments: readonly (readonly TrackPoint[])[],
): GeoJSON.Feature {
  return {
    type: 'Feature',
    geometry: { type: 'MultiLineString', coordinates: coordinateSegmentsFromSegments(segments) },
    properties: { name, source: 'binnacle' },
  };
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
