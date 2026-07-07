import type {
  ExpressionSpecification,
  FillLayerSpecification,
  FilterSpecification,
  LineLayerSpecification,
  SymbolLayerSpecification,
} from 'maplibre-gl';
import {
  colorProperty,
  mapThemePaint,
  type OverlayContext,
  type OverlayModule,
  removeLayersAndSources,
  setLayersVisibility,
} from '$shared/map';
import { SEASCAPE_GROUP, type SeascapeVectorSource } from './seascape-sources';

const VECTOR_SOURCE_ID = 'seascape-vector';
const DRYING_LAYER_ID = 'seascape-drying-layer';
const CONTOUR_LINE_LAYER_ID = 'seascape-contours-line';
const CONTOUR_LABEL_LAYER_ID = 'seascape-contours-label';
const SOUNDING_LAYER_ID = 'seascape-soundings-layer';
const DRYING_OPACITY = 0.55;
// A style weight baked into the contour line's own paint, not a user-facing default: the contours
// module's setOpacity (below) multiplies the slider value by this constant, so a slider at its
// ordinary full-scale default of 1 reproduces exactly this baked translucency instead of a solid line.
const CONTOUR_LINE_OPACITY = 0.6;

// Initial draw colors; applyTheme corrects them once the real saved theme is broadcast, matching the
// load-then-correct pattern seascape-dem-overlay.ts and chart-adapter.ts use for their own DAY_PAINT.
const DAY_PAINT = mapThemePaint('day');

// Seascape ships both a metric and an imperial contour feature set on the same 'contours'
// source-layer, tagged by the `sys` field, rather than converting one set live; this filter
// selects whichever set matches the app's current unit mode. Mirrors Seascape's own style.json.
const CONTOUR_UNIT_FILTER: FilterSpecification = [
  'case',
  ['==', ['global-state', 'unit'], 'ft'],
  ['==', ['get', 'sys'], 'ft'],
  ['!=', ['get', 'sys'], 'ft'],
];

const CONTOUR_LABEL_TEXT: ExpressionSpecification = [
  'case',
  ['==', ['global-state', 'unit'], 'ft'],
  ['concat', ['to-string', ['get', 'depth_ft']], 'ft'],
  ['concat', ['to-string', ['get', 'depth_abs_m']], 'm'],
];

const SOUNDING_TEXT: ExpressionSpecification = [
  'case',
  ['==', ['global-state', 'unit'], 'ft'],
  ['to-string', ['get', 'depth_ft']],
  ['to-string', ['get', 'depth_m']],
];

const LABEL_TEXT_SIZE: ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['zoom'],
  8,
  9,
  13,
  12,
];

const CONTOUR_LAYER_IDS = [
  CONTOUR_LINE_LAYER_ID,
  CONTOUR_LABEL_LAYER_ID,
  SOUNDING_LAYER_ID,
] as const;
const DRYING_LAYER_IDS = [DRYING_LAYER_ID] as const;

export interface SeascapeVectorOverlays {
  contours: OverlayModule;
  drying: OverlayModule;
}

// Contours (with its two symbol facets, contour labels and soundings) and drying areas share one
// vector source. Unlike the DEM pair in seascape-dem-overlay.ts, which assigns one module a fixed
// first-owner role for the shared source, this pair is symmetric: both rows guard-add the source
// with the same if-absent check every overlay in this codebase already uses (createChartOverlay,
// createRasterOverlay), so whichever registers first creates it, and each row's remove() deletes the
// shared source only once it has confirmed the other row's layers are already gone, so whichever is
// torn down last is the one that actually removes it. This is safe because MapLibre's addSource,
// removeSource, getLayer, and getSource are all synchronous, so there is no window where both rows
// race to create the source twice or both wrongly believe the other still needs it.
export function createSeascapeVectorOverlay(source: SeascapeVectorSource): SeascapeVectorOverlays {
  const ensureSource = (ctx: OverlayContext) => {
    if (!ctx.map.getSource(VECTOR_SOURCE_ID)) {
      ctx.map.addSource(VECTOR_SOURCE_ID, {
        type: 'vector',
        tiles: [...source.tiles],
        maxzoom: source.maxzoom,
        attribution: source.attribution,
      });
    }
  };

  // Removes the shared vector source only once none of `siblingLayerIds` are still attached, so one
  // row's remove() never deletes the source out from under the other row's still-live layers.
  const removeSharedSourceIfOrphaned = (
    ctx: OverlayContext,
    siblingLayerIds: readonly string[],
  ) => {
    if (siblingLayerIds.every((id) => !ctx.map.getLayer(id))) {
      removeLayersAndSources(ctx.map, [], [VECTOR_SOURCE_ID]);
    }
  };

  const drying: OverlayModule = {
    id: 'seascape-drying',
    title: 'Seascape drying areas',
    description: 'Areas that dry at low tide, not reduced to chart datum, for reference only.',
    band: 'bathymetry',
    group: SEASCAPE_GROUP,
    supportsOpacity: true,
    defaultVisible: false,
    defaultOpacity: DRYING_OPACITY,
    layerIds: DRYING_LAYER_IDS,
    add(ctx) {
      ensureSource(ctx);
      if (!ctx.map.getLayer(DRYING_LAYER_ID)) {
        const layer: FillLayerSpecification = {
          id: DRYING_LAYER_ID,
          type: 'fill',
          source: VECTOR_SOURCE_ID,
          'source-layer': 'drying',
          paint: { 'fill-color': DAY_PAINT.land, 'fill-opacity': DRYING_OPACITY },
        };
        ctx.map.addLayer(layer, ctx.beforeIdFor('bathymetry'));
      }
    },
    remove(ctx) {
      removeLayersAndSources(ctx.map, [DRYING_LAYER_ID], []);
      removeSharedSourceIfOrphaned(ctx, CONTOUR_LAYER_IDS);
    },
    setVisible(ctx, visible) {
      setLayersVisibility(ctx.map, [DRYING_LAYER_ID], visible);
    },
    setOpacity(ctx, opacity) {
      if (ctx.map.getLayer(DRYING_LAYER_ID)) {
        ctx.map.setPaintProperty(DRYING_LAYER_ID, 'fill-opacity', opacity);
      }
    },
    applyTheme(ctx, paint) {
      if (ctx.map.getLayer(DRYING_LAYER_ID)) {
        ctx.map.setPaintProperty(DRYING_LAYER_ID, colorProperty('fill'), paint.land);
      }
    },
  };

  const contours: OverlayModule = {
    id: 'seascape-contours',
    title: 'Seascape contours',
    description:
      'Seabed depth contours and soundings, not reduced to chart datum, for reference only.',
    band: 'bathymetry',
    group: SEASCAPE_GROUP,
    supportsOpacity: true,
    defaultVisible: false,
    // Not CONTOUR_LINE_OPACITY: that weight is applied inside setOpacity's own multiplier below, so
    // the module's default slider position is the ordinary full-scale 1, matching what LayerManager
    // already assumes when defaultOpacity is absent. Setting this to CONTOUR_LINE_OPACITY would
    // re-apply the multiplier on top of itself and dim a fresh install's line to 0.36 opacity.
    defaultOpacity: 1,
    layerIds: CONTOUR_LAYER_IDS,
    add(ctx) {
      ensureSource(ctx);
      if (!ctx.map.getLayer(CONTOUR_LINE_LAYER_ID)) {
        const layer: LineLayerSpecification = {
          id: CONTOUR_LINE_LAYER_ID,
          type: 'line',
          source: VECTOR_SOURCE_ID,
          'source-layer': 'contours',
          filter: CONTOUR_UNIT_FILTER,
          minzoom: 6,
          paint: {
            'line-color': DAY_PAINT.boundary,
            'line-width': 0.5,
            'line-opacity': CONTOUR_LINE_OPACITY,
          },
        };
        ctx.map.addLayer(layer, ctx.beforeIdFor('bathymetry'));
      }
      if (!ctx.map.getLayer(CONTOUR_LABEL_LAYER_ID)) {
        const layer: SymbolLayerSpecification = {
          id: CONTOUR_LABEL_LAYER_ID,
          type: 'symbol',
          source: VECTOR_SOURCE_ID,
          'source-layer': 'contours',
          filter: CONTOUR_UNIT_FILTER,
          minzoom: 8,
          layout: {
            'symbol-placement': 'line',
            'text-field': CONTOUR_LABEL_TEXT,
            'text-size': LABEL_TEXT_SIZE,
            'text-letter-spacing': 0.1,
            'text-max-angle': 30,
            'text-padding': 50,
          },
          paint: {
            'text-color': DAY_PAINT.label,
            'text-halo-color': DAY_PAINT.background,
            'text-halo-width': 1,
          },
        };
        ctx.map.addLayer(layer, ctx.beforeIdFor('bathymetry'));
      }
      if (!ctx.map.getLayer(SOUNDING_LAYER_ID)) {
        const layer: SymbolLayerSpecification = {
          id: SOUNDING_LAYER_ID,
          type: 'symbol',
          source: VECTOR_SOURCE_ID,
          'source-layer': 'soundings',
          minzoom: 7,
          layout: {
            'text-field': SOUNDING_TEXT,
            'text-size': LABEL_TEXT_SIZE,
            'text-padding': 8,
          },
          paint: {
            'text-color': DAY_PAINT.label,
            'text-halo-color': DAY_PAINT.background,
            'text-halo-width': 1,
          },
        };
        ctx.map.addLayer(layer, ctx.beforeIdFor('bathymetry'));
      }
    },
    remove(ctx) {
      removeLayersAndSources(ctx.map, CONTOUR_LAYER_IDS, []);
      removeSharedSourceIfOrphaned(ctx, DRYING_LAYER_IDS);
    },
    setVisible(ctx, visible) {
      setLayersVisibility(ctx.map, CONTOUR_LAYER_IDS, visible);
    },
    setOpacity(ctx, opacity) {
      if (ctx.map.getLayer(CONTOUR_LINE_LAYER_ID)) {
        ctx.map.setPaintProperty(
          CONTOUR_LINE_LAYER_ID,
          'line-opacity',
          opacity * CONTOUR_LINE_OPACITY,
        );
      }
      for (const id of [CONTOUR_LABEL_LAYER_ID, SOUNDING_LAYER_ID]) {
        if (ctx.map.getLayer(id)) ctx.map.setPaintProperty(id, 'text-opacity', opacity);
      }
    },
    applyTheme(ctx, paint) {
      if (ctx.map.getLayer(CONTOUR_LINE_LAYER_ID)) {
        ctx.map.setPaintProperty(CONTOUR_LINE_LAYER_ID, colorProperty('line'), paint.boundary);
      }
      for (const id of [CONTOUR_LABEL_LAYER_ID, SOUNDING_LAYER_ID]) {
        if (!ctx.map.getLayer(id)) continue;
        ctx.map.setPaintProperty(id, colorProperty('symbol'), paint.label);
        ctx.map.setPaintProperty(id, 'text-halo-color', paint.background);
      }
    },
  };

  return { contours, drying };
}
