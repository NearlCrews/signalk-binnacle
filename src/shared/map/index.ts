export { antimeridianLineGeometry } from './antimeridian';
export type { XyzCatalogSource } from './catalog';
export { BASEMAP_SOURCE_ID, requireCatalogSource } from './catalog';
export { chartSourceId } from './chart-adapter';
export { createChartOverlay } from './chart-overlay';
export type { SignalKChart } from './chart-types';
export {
  type ChartViewStatusKind,
  chartViewCharts,
  chartViewStatus,
  hasVisibleNavigationChart,
} from './chart-view-status';
export { depthShadingStops, shadeColor } from './color-ramp';
export {
  type CompanionProbeResult,
  detectCompanion,
  probeCompanion,
  proxiedSources,
} from './companion';
export { DARK_SCRIM, rgbaCss } from './contrast';
export { type CustomLayerMatrix, matrixForWebGl, matrixOf } from './custom-layer';
export { emptyFeatureCollection, featureCollection } from './feature-collection';
export type { Rgba } from './icon-raster';
export { rasterIcon, rasterIconColored } from './icon-raster';
export {
  activeLayerHitCursor,
  createLayerHitHandlers,
  type LayerHitEvent,
  type LayerHitHandlers,
} from './layer-hit-handlers';
export type { LayerListItem, LayerSettings } from './layer-manager';
export { DEFAULT_OVERLAY_STATE, LayerManager } from './layer-manager';
export { CONTEXT_MENU_KEYSHORTCUTS } from './long-press';
export { setMapImage } from './map-image';
export {
  createMapTapRecognizer,
  type MapTapEvent,
} from './map-tap';
export type { MapThemePaint } from './map-theme';
export { applyRasterTheme, colorProperty, DAY_PAINT, mapThemePaint } from './map-theme';
export {
  iconOffsetExpression,
  markerIconSizeExpression,
  severityMatchExpression,
} from './overlay-expressions';
export {
  ensureGeoJsonSource,
  ensureGeoJsonSources,
  ensureSource,
  overlayInteractive,
  removeLayersAndSources,
  removeSharedSourceIfOrphaned,
  setLayersVisibility,
  setPaintProp,
  setSourceData,
} from './overlay-helpers';
export type { Syncable } from './overlay-tick';
export { registerPmtilesProtocol } from './pmtiles';
export { readPmtilesMeta } from './pmtiles-metadata';
export {
  catalogSource,
  createRasterOverlay,
  createSafetyOverlay,
  type RasterOverlaySource,
} from './raster-overlay';
export { decodeSvgToImageData } from './svg-raster';
export type { SymbolOverlay } from './symbol-overlay';
export { createSymbolOverlay } from './symbol-overlay';
export {
  createThemedMap,
  type ThemedMapHandle,
} from './themed-map';
export type { OverlayContext, OverlayModule } from './types';
