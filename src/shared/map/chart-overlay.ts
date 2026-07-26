import type { Map as MapLibreMap, MapSourceDataEvent } from 'maplibre-gl';
import {
  chartSourceId,
  chartToSpecs,
  hasPmtilesPath,
  PMTILES_SCHEME,
  THEME_PAINT_KEY,
} from './chart-adapter';
import type { SignalKChart } from './chart-types';
import { applyRasterTheme, colorProperty, type MapColorKey } from './map-theme';
import { removeLayersAndSources, setLayersVisibility, setPaintProp } from './overlay-helpers';
import { registerPmtilesArchive, unregisterPmtilesArchive } from './pmtiles';
import type { ChartLayerInfo, OverlayModule, ZBand } from './types';

// How far past a chart's native max zoom its layers keep drawing before they hand off
// to the base map. Zooming past a chart's scale overzooms the top tiles into a blocky,
// low-detail chart, which is worse than the sharp base underneath. Capping the chart a
// step beyond its native max lets the base map show through when you zoom in past the
// chart's detail, so the chart stays useful and aligned with the base at every zoom.
const CHART_OVERZOOM_BUDGET = 1;

const OPACITY_PROPERTY = {
  fill: 'fill-opacity',
  line: 'line-opacity',
  raster: 'raster-opacity',
} as const;
const RASTER_FORMATS = new Set(['png', 'jpg', 'jpeg', 'webp', 'avif']);

// The opacity paint property for a layer type, or undefined for a type the chart adapter never
// emits (only fill, line, and raster are produced). setOpacity skips an undefined so an unexpected
// type is a clear no-op rather than a wrong property silently applied.
function opacityProperty(layerType: string): string | undefined {
  return OPACITY_PROPERTY[layerType as keyof typeof OPACITY_PROPERTY];
}

function chartKind(chart: SignalKChart): ChartLayerInfo['kind'] {
  if (chart.type === 'mapstyleJSON') return 'style';
  if (chart.type === 'tileJSON' || chart.format === 'mvt' || chart.format === 'pbf')
    return 'vector';
  if (chart.format && RASTER_FORMATS.has(chart.format)) return 'raster';
  const candidate = chart.url ?? chart.tilemapUrl ?? '';
  return hasPmtilesPath(candidate) ? 'vector' : 'raster';
}

// Server charts default to the basemap band; a user-imported chart passes 'bathymetry' so it
// layers above the base map. Pass getToken when the archive may be companion-provided so each
// PMTiles fetch carries the current auth token on a security-enabled server.
export function createChartOverlay(
  chart: SignalKChart,
  serverBase: string,
  band: ZBand = 'basemap',
  getToken?: () => string | undefined,
  options: { source?: ChartLayerInfo['source'] } = {},
): OverlayModule {
  const specs = chartToSpecs(chart, serverBase);
  const sourceIds = Object.keys(specs.sources);
  // A lightweight view of just the fields the lifecycle methods touch, derived once from
  // specs.layers. add() works from the full specs, while remove, setVisible, setOpacity, applyTheme,
  // and capToNativeZoom iterate this. It is derived, so it cannot drift from specs.layers.
  const layers = specs.layers.map((layer) => ({
    id: layer.id,
    type: layer.type,
    minzoom: (layer as { minzoom?: number }).minzoom ?? 0,
    themePaint: (layer.metadata as Record<string, MapColorKey> | undefined)?.[THEME_PAINT_KEY],
  }));
  const layerIds = layers.map((layer) => layer.id);
  const chartSource = sourceIds[0];
  // The bare http urls of this chart's PMTiles archives, registered with the protocol on add and
  // unregistered on remove so a deleted chart does not leak its archive instance (for a blob: url,
  // a permanently dead one).
  const pmtilesUrls = sourceIds.flatMap((sourceId) => {
    const spec = specs.sources[sourceId];
    return 'url' in spec && typeof spec.url === 'string' && spec.url.startsWith(PMTILES_SCHEME)
      ? [spec.url.slice(PMTILES_SCHEME.length)]
      : [];
  });
  let onSourceData: ((event: MapSourceDataEvent) => void) | undefined;
  const source = options.source ?? 'server';
  const url = chart.url ?? chart.tilemapUrl;
  const kind = chartKind(chart);
  const description =
    chart.description ??
    (source === 'user' ? 'User-added chart source' : 'Chart source from the Signal K server');

  // The native max zoom lives in the source's TileJSON, which a PMTiles archive reports
  // only once it has loaded, so this is applied after the source is loaded. Each layer's
  // own minzoom is preserved (e.g. landuse is held back from low zoom for performance).
  const capToNativeZoom = (map: MapLibreMap): boolean => {
    const source = map.getSource(chartSource) as { maxzoom?: number } | undefined;
    const nativeMax = source?.maxzoom;
    if (nativeMax === undefined) return false;
    for (const layer of layers) {
      if (map.getLayer(layer.id)) {
        map.setLayerZoomRange(layer.id, layer.minzoom, nativeMax + CHART_OVERZOOM_BUDGET);
      }
    }
    return true;
  };

  return {
    id: chartSourceId(chart.identifier),
    title: chart.name,
    description,
    band,
    supportsOpacity: true,
    layerIds,
    chart: {
      identifier: chart.identifier,
      source,
      kind,
      type: chart.type,
      url,
      bounds: chart.bounds,
      minzoom: chart.minzoom,
      maxzoom: chart.maxzoom,
      format: chart.format,
    },
    add(ctx) {
      // A PMTiles archive registers a no-store source first so MapLibre resolves the
      // pmtiles:// url to it rather than the default cache-writing fetch source.
      for (const url of pmtilesUrls) {
        registerPmtilesArchive(url, getToken);
      }
      for (const sourceId of sourceIds) {
        if (!ctx.map.getSource(sourceId)) {
          ctx.map.addSource(sourceId, specs.sources[sourceId]);
        }
      }
      for (const layer of specs.layers) {
        if (!ctx.map.getLayer(layer.id)) {
          ctx.map.addLayer(layer, ctx.beforeIdFor(band));
        }
      }
      // A chart with no sources (the empty mapstyleJSON specs) has nothing to cap, so skip
      // the listener entirely rather than waiting forever on an undefined source id.
      if (!chartSource) return;
      // Clear any listener left by a prior add (the reattach path) before installing a
      // new one, so the handler reference cannot be orphaned.
      if (onSourceData) {
        ctx.map.off('sourcedata', onSourceData);
        onSourceData = undefined;
      }
      const tryCap = () => ctx.map.isSourceLoaded(chartSource) && capToNativeZoom(ctx.map);
      if (!tryCap()) {
        const handler = (event: MapSourceDataEvent) => {
          if (event.sourceId === chartSource && event.isSourceLoaded && tryCap()) {
            ctx.map.off('sourcedata', handler);
            if (onSourceData === handler) onSourceData = undefined;
          }
        };
        onSourceData = handler;
        ctx.map.on('sourcedata', handler);
      }
    },
    remove(ctx) {
      if (onSourceData) {
        ctx.map.off('sourcedata', onSourceData);
        onSourceData = undefined;
      }
      removeLayersAndSources(ctx.map, layerIds, sourceIds);
      for (const url of pmtilesUrls) {
        unregisterPmtilesArchive(url);
      }
    },
    setVisible(ctx, visible) {
      setLayersVisibility(ctx.map, layerIds, visible);
    },
    setOpacity(ctx, opacity) {
      for (const layer of layers) {
        const property = opacityProperty(layer.type);
        // Guard on getLayer, matching setLayersVisibility: setPaintProperty throws on a layer that is
        // not present, for example if the slider moves during the window after a base-style reload and
        // before the overlay reattaches.
        if (property && ctx.map.getLayer(layer.id))
          setPaintProp(ctx.map, layer.id, property, opacity);
      }
    },
    applyTheme(ctx, paint) {
      // Recolor this chart's own themed vector draw layers; a raster layer cannot be recolored,
      // so adjust it the way the streaming bathymetry does: night-red desaturates and dims it so
      // it carries no blue and keeps the brightest pixel low.
      for (const layer of layers) {
        if (layer.type === 'raster') {
          applyRasterTheme(ctx.map, layer.id, paint);
          continue;
        }
        if (!layer.themePaint) continue;
        // Guard on getLayer, matching setLayersVisibility and setOpacity: setPaintProperty throws on a
        // layer absent during the window after a base-style reload and before reattach.
        if (!ctx.map.getLayer(layer.id)) continue;
        const property = colorProperty(layer.type);
        ctx.map.setPaintProperty(layer.id, property, paint[layer.themePaint]);
      }
    },
  };
}
