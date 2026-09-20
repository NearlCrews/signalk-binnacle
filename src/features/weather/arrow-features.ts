import type { WeatherGrid } from '$entities/weather';
import { featureCollection } from '$shared/map';

export interface Arrow {
  u: number; // unit vector east component
  v: number; // unit vector north component
  props: GeoJSON.GeoJsonProperties;
}

// Build one arrow line per strided grid cell, its length a fraction of the grid spacing, from the
// unit vector and properties that `arrowAt` returns for a cell index (undefined skips the cell).
// Shared by the wind and wave arrow layers; each supplies its own per-cell vector, skip rule, and
// tagged property.
export function cellArrowFeatures(
  grid: WeatherGrid,
  stride: number,
  fraction: number,
  arrowAt: (cellIndex: number) => Arrow | undefined,
): GeoJSON.FeatureCollection {
  const cols = grid.lons.length;
  const dLon = cols > 1 ? Math.abs(grid.lons[1] - grid.lons[0]) : 1;
  const dLat = grid.lats.length > 1 ? Math.abs(grid.lats[1] - grid.lats[0]) : 1;
  const len = Math.min(dLon, dLat) * fraction;
  const features: GeoJSON.Feature[] = [];
  for (let r = 0; r < grid.lats.length; r += stride) {
    for (let c = 0; c < cols; c += stride) {
      const arrow = arrowAt(r * cols + c);
      if (!arrow) continue;
      const lon = grid.lons[c];
      const lat = grid.lats[r];
      const tip = [lon + arrow.u * len, lat + arrow.v * len];
      const head = len * 0.3;
      features.push({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [
            [lon, lat],
            tip,
            [
              tip[0] - arrow.u * head - arrow.v * head * 0.5,
              tip[1] - arrow.v * head + arrow.u * head * 0.5,
            ],
            tip,
            [
              tip[0] - arrow.u * head + arrow.v * head * 0.5,
              tip[1] - arrow.v * head - arrow.u * head * 0.5,
            ],
          ],
        },
        properties: arrow.props,
      });
    }
  }
  return featureCollection(features);
}
