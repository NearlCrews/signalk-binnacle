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

// A GeoJSON Feature with MultiLineString geometry: the portable, importable form of a track.
export function toGeoJsonFeature(name: string, points: readonly TrackPoint[]): GeoJSON.Feature {
  return {
    type: 'Feature',
    geometry: { type: 'MultiLineString', coordinates: coordinateSegments(points) },
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
