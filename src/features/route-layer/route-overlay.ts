import type { ExpressionSpecification, LineLayerSpecification } from 'maplibre-gl';
import type { RouteStore } from '$entities/route';
import {
  DARK_SCRIM,
  ensureGeoJsonSources,
  type MapThemePaint,
  mapThemePaint,
  type OverlayContext,
  type OverlayModule,
  removeLayersAndSources,
  rgbaCss,
  setLayersVisibility,
  setSourceData,
} from '$shared/map';
import { routeLineFeatures, waypointFeatures } from './route-features';
import { recolorWaypointLayers, waypointCircleLayer, waypointLabelLayer } from './waypoint-layers';

const LINE_SRC = 'binnacle-route-lines';
const LINE_CASING_LAYER = 'binnacle-route-line-casing';
const LINE_LAYER = 'binnacle-route-line';
const WPT_SRC = 'binnacle-route-waypoints';
const WPT_LAYER = 'binnacle-route-waypoint';
const WPT_LABEL_LAYER = 'binnacle-route-waypoint-label';
const BAND = 'routes';
const LAYERS = [LINE_CASING_LAYER, LINE_LAYER, WPT_LAYER, WPT_LABEL_LAYER];

// The overlay's registered id. Exported because the chart canvas treats this overlay as critical to
// startup and matches it by id; a rename there has to be a compile error, not a silent miss.
export const ROUTE_OVERLAY_ID = 'routes';

// The active route draws in the selection accent and a touch heavier, every other shown route in
// the note color, so the route being followed stands apart from the planned ones.
function lineColor(paint: MapThemePaint): ExpressionSpecification {
  return ['case', ['get', 'active'], paint.select, paint.note];
}

const LINE_WIDTH: ExpressionSpecification = ['case', ['get', 'active'], 3, 2];
// A solid dark casing under the route line, two pixels wider, so the line keeps its bright color but
// gains contrast on light day water (where the amber select is close in luminance to the water). On the
// dark dusk and night-red maps the near-black casing is invisible, so the line shows on its own. Fixed
// (not themed) on purpose, like the cursor halo: a constant dark backing that only reads where needed.
const CASING_WIDTH: ExpressionSpecification = ['case', ['get', 'active'], 5, 4];
const CASING_COLOR = rgbaCss(DARK_SCRIM);

export interface RouteOverlay extends OverlayModule {
  sync(ctx: OverlayContext): void;
}

// The nav chart registers this listed (a Layers-panel row the navigator toggles). The Forecast
// mini-map registers it with listed: false: read-only route context drawn over the weather fields,
// never a weather layer to toggle or persist there.
export function createRouteOverlay(store: RouteStore, opts?: { listed?: boolean }): RouteOverlay {
  let paint: MapThemePaint = mapThemePaint('day');
  let lastVersion = -1;

  return {
    id: ROUTE_OVERLAY_ID,
    title: 'Routes',
    band: BAND,
    listed: opts?.listed,
    supportsOpacity: true,
    layerIds: LAYERS,
    add(ctx) {
      // Reset the dirty-check so a reattach (after a base-style swap emptied the sources)
      // repopulates them on the next sync instead of staying blank.
      lastVersion = -1;
      const before = ctx.beforeIdFor(BAND);
      ensureGeoJsonSources(ctx.map, [LINE_SRC, WPT_SRC]);
      // The casing is added first so it sits below the line; a solid (not dashed) backing reads as a
      // continuous dark line with the bright dashes on top, which is what lifts it off light water.
      if (!ctx.map.getLayer(LINE_CASING_LAYER)) {
        const layer: LineLayerSpecification = {
          id: LINE_CASING_LAYER,
          type: 'line',
          source: LINE_SRC,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': CASING_COLOR, 'line-width': CASING_WIDTH },
        };
        ctx.map.addLayer(layer, before);
      }
      if (!ctx.map.getLayer(LINE_LAYER)) {
        const layer: LineLayerSpecification = {
          id: LINE_LAYER,
          type: 'line',
          source: LINE_SRC,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': lineColor(paint),
            'line-width': LINE_WIDTH,
            'line-dasharray': [2, 1],
          },
        };
        ctx.map.addLayer(layer, before);
      }
      if (!ctx.map.getLayer(WPT_LAYER)) {
        ctx.map.addLayer(waypointCircleLayer(WPT_LAYER, WPT_SRC, paint), before);
      }
      if (!ctx.map.getLayer(WPT_LABEL_LAYER)) {
        ctx.map.addLayer(waypointLabelLayer(WPT_LABEL_LAYER, WPT_SRC, paint), before);
      }
    },
    sync(ctx) {
      if (store.version === lastVersion) return;
      lastVersion = store.version;
      setSourceData(
        ctx.map,
        LINE_SRC,
        routeLineFeatures(store.routes, store.shownIds, store.activeId),
      );
      setSourceData(ctx.map, WPT_SRC, waypointFeatures(store.routes, store.shownIds));
    },
    setVisible(ctx, visible) {
      setLayersVisibility(ctx.map, LAYERS, visible);
    },
    setOpacity(ctx, opacity) {
      // The casing carries its own alpha in CASING_COLOR, so scale it by the layer opacity too.
      ctx.map.setPaintProperty(LINE_CASING_LAYER, 'line-opacity', opacity);
      ctx.map.setPaintProperty(LINE_LAYER, 'line-opacity', opacity);
      ctx.map.setPaintProperty(WPT_LAYER, 'circle-opacity', opacity);
      ctx.map.setPaintProperty(WPT_LAYER, 'circle-stroke-opacity', opacity);
      // Dim the waypoint labels with the rest, so the opacity slider fades the whole route, matching
      // the tides and notes overlays.
      ctx.map.setPaintProperty(WPT_LABEL_LAYER, 'text-opacity', opacity);
    },
    applyTheme(ctx, next) {
      paint = next;
      ctx.map.setPaintProperty(LINE_LAYER, 'line-color', lineColor(paint));
      recolorWaypointLayers(ctx.map, WPT_LAYER, WPT_LABEL_LAYER, paint);
    },
    remove(ctx) {
      removeLayersAndSources(ctx.map, LAYERS, [LINE_SRC, WPT_SRC]);
    },
  };
}
