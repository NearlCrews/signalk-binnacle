// Wrap a feature list in a FeatureCollection, so the overlays that build features for setData share
// one spelling of the wrapper instead of each writing the literal. Generic over the geometry so an
// overlay that promises a narrower collection (the radar areas are all polygons) keeps that promise
// through the helper; the default is the mixed collection every other overlay builds.
export function featureCollection<G extends GeoJSON.Geometry = GeoJSON.Geometry>(
  features: GeoJSON.Feature<G>[],
): GeoJSON.FeatureCollection<G> {
  return { type: 'FeatureCollection', features };
}

// A fresh empty GeoJSON FeatureCollection, the idle state for an overlay's GeoJSON source. Returns a
// new object each call rather than a shared singleton, because MapLibre's setData may retain the
// reference, so the overlays must not alias one mutable instance.
export function emptyFeatureCollection<
  G extends GeoJSON.Geometry = GeoJSON.Geometry,
>(): GeoJSON.FeatureCollection<G> {
  return featureCollection<G>([]);
}
