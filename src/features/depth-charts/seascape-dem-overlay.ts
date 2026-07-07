import type {
  ColorReliefLayerSpecification,
  ExpressionSpecification,
  HillshadeLayerSpecification,
  RasterDEMSourceSpecification,
} from 'maplibre-gl';
import {
  DAY_PAINT,
  depthShadingStops,
  ensureSource,
  type MapThemePaint,
  type OverlayModule,
  removeLayersAndSources,
  removeSharedSourceIfOrphaned,
  setLayersVisibility,
  shadeColor,
} from '$shared/map';
import type { Theme } from '$shared/ui';
import { SEASCAPE_GROUP, type SeascapeDemSource } from './seascape-sources';

const DEM_SOURCE_ID = 'seascape-dem';
const DEPTH_SHADING_LAYER_ID = 'seascape-depth-shading-layer';
const HILLSHADE_LAYER_ID = 'seascape-hillshade-layer';
const DEPTH_SHADING_OPACITY = 0.85;
const HILLSHADE_ILLUMINATION_DIRECTION = 315;
const HILLSHADE_EXAGGERATION = 0.5;
// Hillshade's shadow and highlight colors are the theme's water and land tones mixed toward black
// and white respectively, matching the same shadeColor ratios depthShadingStops's own darkest and
// brightest stops use, so hillshade's relief reads as one seabed model with the depth-shading fill.
const HILLSHADE_SHADOW_RATIO = -0.5;
const HILLSHADE_HIGHLIGHT_RATIO = 0.3;

export interface SeascapeDemOverlays {
  depthShading: OverlayModule;
  hillshade: OverlayModule;
}

function demSourceSpec(source: SeascapeDemSource): RasterDEMSourceSpecification {
  return {
    type: 'raster-dem',
    encoding: 'terrarium',
    tiles: [...source.tiles],
    tileSize: source.tileSize,
    attribution: source.attribution,
    maxzoom: source.maxzoom,
  };
}

// Theme is a closed three-value set (day, dusk, night-red; see map-theme.ts), so the derived
// depth-shading gradient and hillshade colors for a given theme never change once computed. These
// two caches compute each lazily on first use per theme and read thereafter, instead of re-deriving
// colors from the same water and land hex on every add() and every theme switch.
const depthShadingColorCache = new Map<Theme, ExpressionSpecification>();
const hillshadeColorCache = new Map<Theme, { shadow: string; highlight: string }>();

function depthShadingColorRelief(paint: MapThemePaint): ExpressionSpecification {
  const cached = depthShadingColorCache.get(paint.theme);
  if (cached) return cached;
  const expression: ExpressionSpecification = [
    'interpolate',
    ['linear'],
    ['elevation'],
    ...depthShadingStops(paint.water, paint.land),
  ];
  depthShadingColorCache.set(paint.theme, expression);
  return expression;
}

function hillshadeColors(paint: MapThemePaint): { shadow: string; highlight: string } {
  const cached = hillshadeColorCache.get(paint.theme);
  if (cached) return cached;
  const colors = {
    shadow: shadeColor(paint.water, HILLSHADE_SHADOW_RATIO),
    highlight: shadeColor(paint.land, HILLSHADE_HIGHLIGHT_RATIO),
  };
  hillshadeColorCache.set(paint.theme, colors);
  return colors;
}

// Depth shading and hillshade share one raster-dem source, the same symmetric ownership scheme as
// the vector pair in seascape-vector-overlay.ts: both rows guard-add the source with the shared
// ensureSource helper, so whichever registers first creates it, and each row's remove() deletes the
// shared source through removeSharedSourceIfOrphaned only once it has confirmed the other row's
// layer is already gone, so whichever is torn down last is the one that actually removes it. This is
// safe because MapLibre's addSource, removeSource, getLayer, and getSource are all synchronous, so
// there is no window where both rows race to create the source twice or both wrongly believe the
// other still needs it. Neither module is ever unregistered individually in this app today (unregister
// is only called at feature-teardown sites for deletable user charts).
export function createSeascapeDemOverlay(source: SeascapeDemSource): SeascapeDemOverlays {
  const depthShading: OverlayModule = {
    id: 'seascape-depth-shading',
    title: 'Seascape depth shading',
    description: 'Seabed depth shading, not reduced to chart datum, for reference only.',
    band: 'bathymetry',
    group: SEASCAPE_GROUP,
    supportsOpacity: true,
    defaultOpacity: DEPTH_SHADING_OPACITY,
    defaultVisible: false,
    layerIds: [DEPTH_SHADING_LAYER_ID],
    add(ctx) {
      ensureSource(ctx.map, DEM_SOURCE_ID, demSourceSpec(source));
      if (!ctx.map.getLayer(DEPTH_SHADING_LAYER_ID)) {
        const layer: ColorReliefLayerSpecification = {
          id: DEPTH_SHADING_LAYER_ID,
          type: 'color-relief',
          source: DEM_SOURCE_ID,
          paint: {
            'color-relief-color': depthShadingColorRelief(DAY_PAINT),
            'color-relief-opacity': DEPTH_SHADING_OPACITY,
          },
        };
        ctx.map.addLayer(layer, ctx.beforeIdFor('bathymetry'));
      }
    },
    remove(ctx) {
      removeLayersAndSources(ctx.map, [DEPTH_SHADING_LAYER_ID], []);
      removeSharedSourceIfOrphaned(ctx.map, DEM_SOURCE_ID, [HILLSHADE_LAYER_ID]);
    },
    setVisible(ctx, visible) {
      setLayersVisibility(ctx.map, [DEPTH_SHADING_LAYER_ID], visible);
    },
    setOpacity(ctx, opacity) {
      if (ctx.map.getLayer(DEPTH_SHADING_LAYER_ID)) {
        ctx.map.setPaintProperty(DEPTH_SHADING_LAYER_ID, 'color-relief-opacity', opacity);
      }
    },
    applyTheme(ctx, paint) {
      if (!ctx.map.getLayer(DEPTH_SHADING_LAYER_ID)) return;
      ctx.map.setPaintProperty(
        DEPTH_SHADING_LAYER_ID,
        'color-relief-color',
        depthShadingColorRelief(paint),
      );
    },
  };

  const hillshade: OverlayModule = {
    id: 'seascape-hillshade',
    title: 'Seascape hillshade',
    description: 'Seabed relief shading from the same depth model as Seascape depth shading.',
    band: 'bathymetry',
    parent: 'seascape-depth-shading',
    group: SEASCAPE_GROUP,
    // No MapLibre hillshade paint property maps to a user opacity slider (hillshade-exaggeration is a
    // relief-strength control, not a fade), unlike color-relief's own color-relief-opacity.
    supportsOpacity: false,
    defaultVisible: false,
    layerIds: [HILLSHADE_LAYER_ID],
    add(ctx) {
      ensureSource(ctx.map, DEM_SOURCE_ID, demSourceSpec(source));
      if (ctx.map.getLayer(HILLSHADE_LAYER_ID)) return;
      const colors = hillshadeColors(DAY_PAINT);
      const layer: HillshadeLayerSpecification = {
        id: HILLSHADE_LAYER_ID,
        type: 'hillshade',
        source: DEM_SOURCE_ID,
        paint: {
          'hillshade-illumination-direction': HILLSHADE_ILLUMINATION_DIRECTION,
          'hillshade-exaggeration': HILLSHADE_EXAGGERATION,
          'hillshade-shadow-color': colors.shadow,
          'hillshade-highlight-color': colors.highlight,
        },
      };
      ctx.map.addLayer(layer, ctx.beforeIdFor('bathymetry'));
    },
    remove(ctx) {
      removeLayersAndSources(ctx.map, [HILLSHADE_LAYER_ID], []);
      removeSharedSourceIfOrphaned(ctx.map, DEM_SOURCE_ID, [DEPTH_SHADING_LAYER_ID]);
    },
    setVisible(ctx, visible) {
      setLayersVisibility(ctx.map, [HILLSHADE_LAYER_ID], visible);
    },
    applyTheme(ctx, paint) {
      if (!ctx.map.getLayer(HILLSHADE_LAYER_ID)) return;
      const colors = hillshadeColors(paint);
      ctx.map.setPaintProperty(HILLSHADE_LAYER_ID, 'hillshade-shadow-color', colors.shadow);
      ctx.map.setPaintProperty(HILLSHADE_LAYER_ID, 'hillshade-highlight-color', colors.highlight);
    },
  };

  return { depthShading, hillshade };
}
