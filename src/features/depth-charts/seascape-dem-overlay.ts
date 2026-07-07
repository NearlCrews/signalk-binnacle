import type { LayerSpecification } from 'maplibre-gl';
import {
  depthShadingStops,
  mapThemePaint,
  type OverlayModule,
  removeLayersAndSources,
  setLayersVisibility,
  shadeColor,
} from '$shared/map';
import { SEASCAPE_GROUP, type SeascapeDemSource } from './seascape-sources';

const DEM_SOURCE_ID = 'seascape-dem';
const DEPTH_SHADING_LAYER_ID = 'seascape-depth-shading-layer';
const HILLSHADE_LAYER_ID = 'seascape-hillshade-layer';
const DEPTH_SHADING_OPACITY = 0.85;
const HILLSHADE_ILLUMINATION_DIRECTION = 315;
const HILLSHADE_EXAGGERATION = 0.5;

// Initial draw colors; applyTheme corrects them once the real saved theme is broadcast, the same
// load-then-correct pattern chart-adapter.ts uses for its own DAY_PAINT.
const DAY_PAINT = mapThemePaint('day');

export interface SeascapeDemOverlays {
  depthShading: OverlayModule;
  hillshade: OverlayModule;
}

// Depth shading and hillshade share one raster-dem source: the first shared-source pairing in this
// codebase (every other overlay derives its MapLibre source id one to one from its own module id).
// removeLayersAndSources deletes a source unconditionally, with no reference count, so ownership is
// split explicitly: seascape-depth-shading is sole owner of the source's add and remove; seascape-
// hillshade only ever attaches or removes its own layer, guarded on getSource and getLayer, and never
// touches the source. LayerManager#addModule awaits each module's add in array order (registerAll
// processes its list sequentially), so registering depth shading before hillshade in ChartCanvas.svelte
// guarantees the source already exists when hillshade's add runs. Neither module is ever unregistered
// individually in this app today (unregister is only called at feature-teardown sites for deletable
// user charts), so the narrower risk of one being torn down while the other survives is a documented,
// currently inert edge case rather than one this design adds handling for.
export function createSeascapeDemOverlay(source: SeascapeDemSource): SeascapeDemOverlays {
  const depthShading: OverlayModule = {
    id: 'seascape-depth-shading',
    title: 'Seascape depth shading',
    description: 'Seabed depth shading, not reduced to chart datum, for reference only.',
    band: 'bathymetry',
    group: SEASCAPE_GROUP,
    supportsOpacity: true,
    defaultVisible: false,
    layerIds: [DEPTH_SHADING_LAYER_ID],
    add(ctx) {
      if (!ctx.map.getSource(DEM_SOURCE_ID)) {
        ctx.map.addSource(DEM_SOURCE_ID, {
          type: 'raster-dem',
          encoding: 'terrarium',
          tiles: [...source.tiles],
          tileSize: source.tileSize,
          attribution: source.attribution,
          ...(source.maxzoom !== undefined ? { maxzoom: source.maxzoom } : {}),
        });
      }
      if (!ctx.map.getLayer(DEPTH_SHADING_LAYER_ID)) {
        ctx.map.addLayer(
          {
            id: DEPTH_SHADING_LAYER_ID,
            type: 'color-relief',
            source: DEM_SOURCE_ID,
            paint: {
              'color-relief-color': [
                'interpolate',
                ['linear'],
                ['elevation'],
                ...depthShadingStops(DAY_PAINT.water, DAY_PAINT.land),
              ],
              'color-relief-opacity': DEPTH_SHADING_OPACITY,
            },
          } as LayerSpecification,
          ctx.beforeIdFor('bathymetry'),
        );
      }
    },
    remove(ctx) {
      removeLayersAndSources(ctx.map, [DEPTH_SHADING_LAYER_ID], [DEM_SOURCE_ID]);
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
      ctx.map.setPaintProperty(DEPTH_SHADING_LAYER_ID, 'color-relief-color', [
        'interpolate',
        ['linear'],
        ['elevation'],
        ...depthShadingStops(paint.water, paint.land),
      ]);
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
      if (ctx.map.getLayer(HILLSHADE_LAYER_ID)) return;
      ctx.map.addLayer(
        {
          id: HILLSHADE_LAYER_ID,
          type: 'hillshade',
          source: DEM_SOURCE_ID,
          paint: {
            'hillshade-illumination-direction': HILLSHADE_ILLUMINATION_DIRECTION,
            'hillshade-exaggeration': HILLSHADE_EXAGGERATION,
            'hillshade-shadow-color': shadeColor(DAY_PAINT.water, -0.5),
            'hillshade-highlight-color': shadeColor(DAY_PAINT.land, 0.3),
          },
        } as LayerSpecification,
        ctx.beforeIdFor('bathymetry'),
      );
    },
    remove(ctx) {
      removeLayersAndSources(ctx.map, [HILLSHADE_LAYER_ID], []);
    },
    setVisible(ctx, visible) {
      setLayersVisibility(ctx.map, [HILLSHADE_LAYER_ID], visible);
    },
    applyTheme(ctx, paint) {
      if (!ctx.map.getLayer(HILLSHADE_LAYER_ID)) return;
      ctx.map.setPaintProperty(
        HILLSHADE_LAYER_ID,
        'hillshade-shadow-color',
        shadeColor(paint.water, -0.5),
      );
      ctx.map.setPaintProperty(
        HILLSHADE_LAYER_ID,
        'hillshade-highlight-color',
        shadeColor(paint.land, 0.3),
      );
    },
  };

  return { depthShading, hillshade };
}
