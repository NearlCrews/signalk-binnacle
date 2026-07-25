import { type TrackPoint, toLonLat } from '$entities/track';
import { antimeridianLineGeometry, featureCollection } from '$shared/map';

// One two-point line feature per consecutive non-gap pair, carrying the segment's speed so the
// line can be data-driven colored. A point flagged gap emits no segment, which is how a break
// (GPS dropout, reconnect) shows as a real gap instead of a straight line across the chart.
export function trackSegments(points: readonly TrackPoint[]): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (let i = 1; i < points.length; i += 1) {
    const point = points[i];
    if (point.gap) continue;
    const prev = points[i - 1];
    features.push({
      type: 'Feature',
      geometry: antimeridianLineGeometry([toLonLat(prev), toLonLat(point)]),
      properties: { sog: point.sog },
    });
  }
  return featureCollection(features);
}
