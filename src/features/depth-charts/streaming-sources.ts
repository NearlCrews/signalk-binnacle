import { catalogSource, type RasterOverlaySource } from '$shared/map';

// A free hosted bathymetry service streamed as raster tiles and cached as the user pans. All
// sources start hidden; the user enables the one that covers their cruising area. It is a hosted
// raster overlay (the generic shape lives in shared/map), always in the bathymetry band.
export type StreamingChartSource = RasterOverlaySource;

// Every upstream fact below comes from the shared catalog through catalogSource: the service URLs,
// the layer and style names, the zoom ranges, the bounds, the groups, and the attributions. Only the
// plain-language descriptions and region tags are ours.
//
// Two entries per service where the service offers a survey-confidence facet, because each facet is
// its own request and toggles independently: EMODnet's quality index and BlueTopo's vertical
// uncertainty each render their base layer in a different style, and the NOAA ENC splits its S-57
// display categories so the data-quality markers come off without losing the chart. Which categories
// and styles those are is the catalog's business, recorded on depth-noaa-enc and its siblings.

// Live-verified free services (2026-06-02). The bathymetry families are reference overlays, not
// charts: they carry no aids to navigation and Seascape-class depths are not reduced to chart
// datum. The NOAA ENC family is the exception, a real chart display the ambient chart badge counts
// (navigationChart below). Two traps kept exactly as verified: BlueTopo
// serves 512px PNG8 tiles, and the NOAA ENC is a full chart-display WMS whose LAYERS list selects
// S-57 display categories (see noaaEncSource above). Registration order is z, bottom to top, so the
// array runs from the least specific at the bottom to the most relevant on top: GEBCO (global), then
// EMODnet (EU), then BlueTopo and the NOAA ENC chart (US). The Layers panel reads that reversed, so
// the default order is the US nautical chart first, then US bathymetry, then EU, then global. Most of
// the free detail is US, and the navigator can drag any of them to taste.
export const STREAMING_CHART_SOURCES: StreamingChartSource[] = [
  catalogSource('depth-gebco', {
    region: 'Global',
    description:
      'Coarse global seabed-depth shading. Use BlueTopo, EMODnet, or the ENC for inshore detail.',
  }),
  catalogSource('depth-gebco-color', {
    parent: 'depth-gebco',
    description:
      'The same global grid in flat color bands, easier to read at a glance than shading.',
  }),
  catalogSource('depth-gebco-measured', {
    parent: 'depth-gebco',
    description:
      'Only where the seabed was actually surveyed. Everywhere else in GEBCO is interpolated.',
  }),
  // Registration order is z-order, so each base sits below its quality facet. EMODnet and BlueTopo
  // each render a bathymetry base plus a survey-confidence facet from one service, so each is a
  // group: the base, and nested under it the facet (EMODnet's combined quality index, BlueTopo's
  // per-cell vertical uncertainty). The group itself comes from the catalog.
  catalogSource('depth-emodnet', {
    region: 'EU',
    description: 'European seabed-depth shading.',
  }),
  catalogSource('depth-emodnet-quality', {
    parent: 'depth-emodnet',
    description: 'How reliable each EMODnet depth cell is.',
  }),
  catalogSource('depth-emodnet-contours', {
    parent: 'depth-emodnet',
    description: 'Depth contour lines, for reading the slope rather than the shading.',
  }),
  catalogSource('depth-bluetopo', {
    region: 'US',
    description: 'High-resolution US seabed-depth shading.',
  }),
  catalogSource('depth-bluetopo-uncertainty', {
    parent: 'depth-bluetopo',
    description: 'How uncertain each BlueTopo depth value is.',
  }),
  // Registered last so the US nautical chart sits on top of the bathymetry when several are enabled,
  // and leads the Charts and depth section. The chart sits below its own data-quality overlay, and
  // both facets share the "NOAA ENC (US)" group.
  catalogSource('depth-noaa-enc', {
    region: 'US',
    description: 'US official electronic navigation charts from the live NOAA chart display.',
    // The one streaming family that is a real chart display (S-57 categories rendered by NOAA's
    // own service), so the ambient chart badge counts it; the bathymetry families stay reference.
    navigationChart: true,
  }),
  catalogSource('depth-noaa-enc-quality', {
    parent: 'depth-noaa-enc',
    description: "Survey-quality zones (ZOC): how trustworthy the chart's depths are.",
  }),
];
