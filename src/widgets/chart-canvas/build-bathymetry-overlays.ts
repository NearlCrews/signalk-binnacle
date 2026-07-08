import {
  createSeascapeDemOverlay,
  createSeascapeVectorOverlay,
  createStreamingChartOverlay,
  SEASCAPE_DEM_SOURCES,
  SEASCAPE_VECTOR_SOURCES,
  STREAMING_CHART_SOURCES,
} from '$features/depth-charts';
import type { OverlayModule } from '$shared/map';
import { proxiedSources } from '$shared/map/companion';

export interface BathymetryOverlaysDeps {
  // The Chart Locker tile proxy base, or null on a standalone install; threaded through
  // proxiedSources so every remote raster and Seascape source routes through one boat-side cache
  // when the companion plugin is present.
  companionBase: string | null;
}

// The bathymetry band, bottom to top: Seascape's DEM pair (depth shading, hillshade) first as a
// background tint, the same role GEBCO plays as the prior bottom-most bathymetry layer; then the
// existing STREAMING_CHART_SOURCES rasters (GEBCO, EMODnet, BlueTopo, NOAA ENC); then Seascape's
// vector pair (drying, then contours on top, fill under line and label) last, so vector detail
// draws over every bathymetry raster including the NOAA ENC chart, the same way soundings and
// contours sit over the depth-area fill on a paper chart. Registration order is z order within a
// band, so this relative order is load-bearing and is locked in by
// build-bathymetry-overlays.test.ts.
export function buildBathymetryOverlays(deps: BathymetryOverlaysDeps): OverlayModule[] {
  const { companionBase } = deps;
  const seascapeDem = createSeascapeDemOverlay(
    proxiedSources(SEASCAPE_DEM_SOURCES, companionBase)[0],
  );
  const seascapeVector = createSeascapeVectorOverlay(
    proxiedSources(SEASCAPE_VECTOR_SOURCES, companionBase)[0],
  );
  return [
    seascapeDem.depthShading,
    seascapeDem.hillshade,
    ...proxiedSources(STREAMING_CHART_SOURCES, companionBase).map((source) =>
      createStreamingChartOverlay(source),
    ),
    seascapeVector.drying,
    seascapeVector.contours,
  ];
}
