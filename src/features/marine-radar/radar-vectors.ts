import { type LatLon, latLonToLonLat } from '$shared/geo';
import { antimeridianLineGeometry, featureCollection } from '$shared/map';
import { geodesicCircleRing, geodesicDestination } from '$shared/nav';

export function rangeRingFeatures(
  center: LatLon,
  rangeMeters: number,
  rings: number,
  // Formats a ring's radius (meters) into its label, supplied by the caller so this geometry module
  // stays free of unit-formatting. When omitted, no label points are emitted.
  labelFor?: (meters: number) => string,
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (let k = 1; k <= rings; k += 1) {
    const ringMeters = (rangeMeters * k) / rings;
    const coordinates = geodesicCircleRing(center.latitude, center.longitude, ringMeters);
    // geodesicCircleRing's last point is sin(2pi)-rounded, not exactly the first; close it exactly.
    coordinates[coordinates.length - 1] = coordinates[0];
    features.push({
      type: 'Feature',
      properties: { ring: k },
      geometry: antimeridianLineGeometry(coordinates),
    });
    if (labelFor) {
      // The range label sits at the ring's north point (the chart is north-up), so the rings read as a
      // top-up range scale; a symbol layer renders the `label` property.
      features.push({
        type: 'Feature',
        properties: { label: labelFor(ringMeters) },
        geometry: {
          type: 'Point',
          coordinates: geodesicDestination(center.latitude, center.longitude, 0, ringMeters),
        },
      });
    }
  }
  return featureCollection(features);
}

export function headingLineFeature(
  center: LatLon,
  headingRad: number,
  rangeMeters: number,
): GeoJSON.Feature {
  const tip = geodesicDestination(center.latitude, center.longitude, headingRad, rangeMeters);
  return {
    type: 'Feature',
    properties: { heading: true },
    geometry: antimeridianLineGeometry([latLonToLonLat(center), tip]),
  };
}
