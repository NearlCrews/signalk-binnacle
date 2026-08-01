import type { RasterLayerSpecification, RasterSourceSpecification } from 'maplibre-gl';
import {
  type ChartGroup,
  type ChartSource,
  chartSourceById,
  type LngLatBbox,
} from 'signalk-chart-sources';
import { applyRasterTheme } from './map-theme';
import { removeLayersAndSources, setLayersVisibility } from './overlay-helpers';
import type { OverlayModule, ZBand } from './types';

// The id prefix on every hosted-raster overlay source and layer. The base-theme recolor skips ids
// under this prefix, so the id scheme lives here in one place and base-theme imports it.
export const RASTER_ID_PREFIX = 'streaming-';
const rasterSourceId = (id: string): string => `${RASTER_ID_PREFIX}${id}`;
const rasterLayerId = (id: string): string => `${RASTER_ID_PREFIX}${id}-layer`;

// A hosted raster tile service shown as a themed overlay: an XYZ or WMTS template, or a WMS GetMap
// request. It starts hidden unless told otherwise, streams and caches as the user pans, and follows
// the theme (day and dusk show it as served; night-red desaturates and dims it, since a raster
// cannot be recolored to true night-red).
export interface RasterOverlaySource {
  id: string;
  title: string;
  // A plain-language gloss for the Layers-panel row tooltip. See OverlayModule.description.
  description?: string;
  // MapLibre raster tile URL template(s): {z}/{x}/{y} for XYZ or WMTS, or a WMS GetMap request using
  // the {bbox-epsg-3857} token.
  tiles: string[];
  tileSize?: number;
  minzoom?: number;
  maxzoom?: number;
  // Optional coverage bounds [west, south, east, north] in WGS84 degrees for a regional source.
  bounds?: LngLatBbox;
  attribution: string;
  // An optional parent source id: a facet of another overlay nests under it in the Layers panel and
  // only shows when the parent is on.
  parent?: string;
  // An optional named group: facets that share a group id render under one labeled header in the
  // Layers panel.
  group?: ChartGroup;
  // The Layers-panel category this source declares. See OverlayModule.category.
  category?: string;
  // The region tag (US, EU, Global) shown on the row. See OverlayModule.region.
  region?: string;
  // Initial visibility when there is no saved state. Defaults to hidden so an overlay starts off
  // until the user enables it for their area.
  defaultVisible?: boolean;
  // Initial opacity when there is no saved state. Defaults to 1; a translucent overlay sets it lower.
  defaultOpacity?: number;
}

// A WMS 1.3.0 GetMap raster tile template: 256px EPSG:3857 PNG tiles with the {bbox-epsg-3857} token
// MapLibre substitutes per tile. The optional styles names a non-default WMS style; empty selects the
// layer default.
export const wmsTiles = (base: string, layers: string, styles = ''): string =>
  `${base}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=${layers}&CRS=EPSG:3857&BBOX={bbox-epsg-3857}&WIDTH=256&HEIGHT=256&FORMAT=image/png&TRANSPARENT=true&STYLES=${styles}`;

// An ArcGIS MapServer export raster tile template: a 256px EPSG:3857 PNG with the {bbox-epsg-3857}
// token MapLibre substitutes per tile. Some marine services (the NOAA MPA Inventory) serve only this
// ArcGIS REST export, not WMS. The base is the MapServer URL without a trailing slash. Reached only
// through catalogSource now, since every such service in use is a catalog entry.
const arcgisExportTiles = (base: string): string =>
  `${base}/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&dpi=96&format=png32&transparent=true&f=image`;

/** The tile template for a catalog source, built the way the companion proxy builds the same request. */
const catalogTiles = (source: ChartSource): string[] => {
  switch (source.upstream.mode) {
    case 'wms':
      return [wmsTiles(source.upstream.base, source.upstream.layers, source.upstream.styles)];
    case 'arcgis':
      return [arcgisExportTiles(source.upstream.base)];
    case 'wmts':
    case 'xyz':
      return [source.upstream.urlTemplate];
    default:
      throw new TypeError(`Chart source ${source.id} is not a streamable raster source`);
  }
};

/**
 * Build a raster overlay from the shared catalog, which owns every upstream fact: the service URL,
 * the layer and style names, the zoom range, the bounds, the group, and the attribution. Callers add
 * only what the catalog deliberately does not carry, the UI-facing description, region, category,
 * parent, and default visibility.
 *
 * No caller may re-state a catalog value. Hand-copying one is how the webapp and the companion proxy
 * drift apart, which is the whole reason the shared package exists: copies of the EMODnet bounds and
 * the NOAA protected-area bounds had both gone stale before this helper existed.
 */
export const catalogSource = (
  id: string,
  opts: {
    description?: string;
    region?: string;
    category?: string;
    parent?: string;
    defaultVisible?: boolean;
    defaultOpacity?: number;
  } = {},
): RasterOverlaySource => {
  const source = chartSourceById(id);
  if (!source) {
    throw new TypeError(`Missing chart source metadata for ${id}`);
  }
  return {
    id: source.id,
    title: source.title,
    tiles: catalogTiles(source),
    tileSize: source.tileSize,
    minzoom: source.minzoom,
    maxzoom: source.maxzoom,
    bounds: source.bounds,
    attribution: source.attribution,
    group: source.group,
    ...opts,
  };
};

// The safety band hosts the navigation-hazard rasters (seamarks, protected areas, and maritime
// boundaries): they draw above charts and routes so a hazard mark always reads over the chart
// picture. The seamark, MPA, and boundary slices share this one binding so the band lives in a
// single place rather than being re-spelled in each slice.
export function createSafetyOverlay(source: RasterOverlaySource): OverlayModule {
  return createRasterOverlay(source, 'safety');
}

// Wrap a hosted raster tile service as a themed overlay in the given band. The layer manager sets
// opacity via setOpacity right after add, and MapLibre defaults raster-opacity to 1, so no inline
// opacity is set on the layer.
export function createRasterOverlay(source: RasterOverlaySource, band: ZBand): OverlayModule {
  const sourceId = rasterSourceId(source.id);
  const layerId = rasterLayerId(source.id);

  return {
    id: source.id,
    title: source.title,
    description: source.description,
    band,
    parent: source.parent,
    group: source.group,
    category: source.category,
    region: source.region,
    supportsOpacity: true,
    defaultVisible: source.defaultVisible ?? false,
    defaultOpacity: source.defaultOpacity ?? 1,
    layerIds: [layerId],
    add(ctx) {
      if (!ctx.map.getSource(sourceId)) {
        const spec: RasterSourceSpecification = {
          type: 'raster',
          tiles: [...source.tiles],
          tileSize: source.tileSize ?? 256,
          attribution: source.attribution,
        };
        if (source.minzoom !== undefined) spec.minzoom = source.minzoom;
        if (source.maxzoom !== undefined) spec.maxzoom = source.maxzoom;
        if (source.bounds) spec.bounds = [...source.bounds];
        ctx.map.addSource(sourceId, spec);
      }
      if (!ctx.map.getLayer(layerId)) {
        const layer: RasterLayerSpecification = {
          id: layerId,
          type: 'raster',
          source: sourceId,
        };
        ctx.map.addLayer(layer, ctx.beforeIdFor(band));
      }
    },
    remove(ctx) {
      removeLayersAndSources(ctx.map, [layerId], [sourceId]);
    },
    setVisible(ctx, visible) {
      setLayersVisibility(ctx.map, [layerId], visible);
    },
    setOpacity(ctx, opacity) {
      // Guard on getLayer, matching setLayersVisibility: setPaintProperty throws on an absent layer.
      if (ctx.map.getLayer(layerId)) ctx.map.setPaintProperty(layerId, 'raster-opacity', opacity);
    },
    applyTheme(ctx, paint) {
      applyRasterTheme(ctx.map, layerId, paint);
    },
  };
}
