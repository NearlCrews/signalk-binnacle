import {
  catalogSource,
  createSafetyOverlay,
  type OverlayModule,
  type RasterOverlaySource,
} from '$shared/map';

// The OpenSeaMap seamark overlay: a transparent global raster layer of navigation aids (buoys,
// beacons, lights, light sectors, and harbors) derived from OpenStreetMap. It sits in the safety
// band, above charts and routes, so a hazard mark always draws over the chart picture. It defaults
// hidden; the user enables it. As a raster it cannot be recolored, so at night-red it desaturates
// and dims with the other rasters (applyRasterTheme): the marks read by symbol shape and position
// rather than color, since preserving saturated green would break the night-red contract.
//
// The catalog owns every upstream fact here, including the choice of a single host: MapLibre
// round-robins a tiles array by tile coordinate rather than failing over, so a second host that
// went dark would blank half the tiles instead of degrading.
export const SEAMARK_SOURCES: RasterOverlaySource[] = [
  catalogSource('seamark', {
    region: 'Global',
    category: 'reference',
    description: 'Buoys, beacons, lights, and harbors from OpenSeaMap, drawn over the chart.',
  }),
];

// The seamark raster draws in the safety band, bound through the shared createSafetyOverlay so the
// band is not re-spelled per slice.
export function createSeamarkOverlay(source: RasterOverlaySource): OverlayModule {
  return createSafetyOverlay(source);
}
