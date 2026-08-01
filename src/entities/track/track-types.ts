// One recorded fix on the own-vessel track. Position is decimal degrees (the SI exception),
// sog is m/s (SI), t is epoch milliseconds. gap is true when a break precedes this point, so
// the renderer does not draw a segment from the previous point across a dropout.
export interface TrackPoint {
  lat: number;
  lon: number;
  t: number;
  sog: number;
  gap?: boolean;
}

export interface TrackStats {
  distanceMeters: number;
  durationSeconds: number;
  avgSog: number;
  maxSog: number;
}

// A FeatureCollection of saved-track segments plus a version that bumps when it changes, so a
// renderer can pull and dirty-check it without rebuilding every frame. Declared with the other
// track shapes rather than inside the overlay, so the tracks controller that produces one and the
// overlay that consumes one do not have to reach across features for the contract between them.
export interface SavedTracksSource {
  features: () => GeoJSON.FeatureCollection;
  version: () => number;
}
