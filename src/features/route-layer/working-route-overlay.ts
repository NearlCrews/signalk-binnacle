import type { LineLayerSpecification } from 'maplibre-gl';
import {
  highlightFeatures,
  type Route,
  type RouteHighlight,
  type RouteStore,
  waypointPointFeatures,
} from '$entities/route';
import {
  emptyFeatureCollection,
  ensureGeoJsonSources,
  featureCollection,
  type MapThemePaint,
  mapThemePaint,
  type OverlayContext,
  removeLayersAndSources,
  setSourceData,
} from '$shared/map';
import type { Theme } from '$shared/ui';
import { recolorWaypointLayers, waypointCircleLayer, waypointLabelLayer } from './waypoint-layers';

// The working route's resting waypoint dots, their index labels, and the cross-highlight (a lit
// segment and a ring-and-halo on the lit dots). Terra Draw owns the line and all editing underneath;
// this overlay only presents the dots and the highlight. It is NOT a managed, user-toggleable layer:
// ChartCanvas constructs it, ticks it, recolors it, and raises it above the Terra Draw line, exactly
// the way it drives the Terra Draw editor itself.

const WPT_SRC = 'binnacle-working-wpt';
const WPT_LAYER = 'binnacle-working-wpt';
const WPT_LABEL_LAYER = 'binnacle-working-wpt-label';
const HL_SEG_SRC = 'binnacle-working-hl-seg';
const HL_SEG_LAYER = 'binnacle-working-hl-seg';
const HL_DOT_SRC = 'binnacle-working-hl-dot';
const HL_HALO_LAYER = 'binnacle-working-hl-halo';
const HL_RING_LAYER = 'binnacle-working-hl-ring';
const BAND = 'routes';
// Bottom to top: resting dots, the highlight group (lit segment, halo, ring), then labels on top so
// the active waypoint's own number is never covered by its highlight halo or ring.
const LAYERS = [WPT_LAYER, HL_SEG_LAYER, HL_HALO_LAYER, HL_RING_LAYER, WPT_LABEL_LAYER];
// The box half-size in pixels for the dot hit-test, generous so a small dot is tappable with a glove.
const HIT_PAD = 10;
const RENDER_GENERATION_PROPERTY = 'binnacleRenderGeneration';

export interface WorkingRouteOverlay {
  add(ctx: OverlayContext): void;
  sync(ctx: OverlayContext): void;
  // Recolor for a theme, mirroring the Terra Draw editor's setTheme, so the same ChartCanvas theme
  // effect drives both. Uses the map captured in add(), so it needs no context.
  setTheme(theme: Theme): void;
  // Re-assert the overlay layers above the lazily-added Terra Draw line, called after the editor
  // starts and after a layer reorder restacks the routes band.
  raise(ctx: OverlayContext): void;
  // Which waypoint index a chart tap hits, or undefined. Owned here so the widget needs neither the
  // layer id nor the feature property shape.
  hitTestWaypoint(point: { x: number; y: number }): number | undefined;
  // Detach the sources and layers. Unused today (ChartCanvas destroys the map, which takes them
  // with it), but an overlay that can be added and not removed leaves zombie sources behind the
  // first time anyone detaches one without destroying its map.
  remove(ctx: OverlayContext): void;
}

export function createWorkingRouteOverlay(
  store: RouteStore,
  initialTheme: Theme,
): WorkingRouteOverlay {
  let paint: MapThemePaint = mapThemePaint(initialTheme);
  let lastEditVersion = -1;
  // Per-source caches so a highlight-only tap does not rebuild the resting dots, and a drag rebuilds
  // the dots and the highlight (its geometry moved) but a leg-row tap rebuilds only the highlight.
  let lastWorking: Route | undefined;
  let lastHighlight: RouteHighlight | undefined;
  let ctxRef: OverlayContext | undefined;
  // MapLibre can briefly return features from the previous GeoJSON source data after setData().
  // Tag each working-route snapshot so an index that shifted after an insert or reorder cannot select
  // a different waypoint while the renderer catches up.
  let waypointRenderGeneration = 0;

  return {
    add(ctx) {
      // Reset the caches so a reattach repopulates every source on the next sync.
      lastEditVersion = -1;
      lastWorking = undefined;
      lastHighlight = undefined;
      ctxRef = ctx;
      const before = ctx.beforeIdFor(BAND);
      ensureGeoJsonSources(ctx.map, [WPT_SRC, HL_SEG_SRC, HL_DOT_SRC]);
      if (!ctx.map.getLayer(WPT_LAYER)) {
        ctx.map.addLayer(waypointCircleLayer(WPT_LAYER, WPT_SRC, paint), before);
      }
      if (!ctx.map.getLayer(HL_SEG_LAYER)) {
        const layer: LineLayerSpecification = {
          id: HL_SEG_LAYER,
          type: 'line',
          source: HL_SEG_SRC,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          // A warmer tone than the editing line's select so the lit leg stands out from it.
          paint: { 'line-color': paint.routeHighlight, 'line-width': 5 },
        };
        ctx.map.addLayer(layer, before);
      }
      if (!ctx.map.getLayer(HL_HALO_LAYER)) {
        ctx.map.addLayer(
          {
            id: HL_HALO_LAYER,
            type: 'circle',
            source: HL_DOT_SRC,
            // A tight, faint accent disc so the lit dot reads at night without raising the brightest
            // pixel much; the ring above carries the crisp cue.
            paint: { 'circle-radius': 12, 'circle-color': paint.select, 'circle-opacity': 0.16 },
          },
          before,
        );
      }
      if (!ctx.map.getLayer(HL_RING_LAYER)) {
        ctx.map.addLayer(
          {
            id: HL_RING_LAYER,
            type: 'circle',
            source: HL_DOT_SRC,
            paint: {
              'circle-radius': 7,
              'circle-color': paint.select,
              'circle-stroke-color': paint.markerGlyph,
              'circle-stroke-width': 2,
            },
          },
          before,
        );
      }
      if (!ctx.map.getLayer(WPT_LABEL_LAYER)) {
        ctx.map.addLayer(waypointLabelLayer(WPT_LABEL_LAYER, WPT_SRC, paint), before);
      }
    },
    sync(ctx) {
      if (store.editVersion === lastEditVersion) return;
      lastEditVersion = store.editVersion;
      const working = store.working;
      const highlight = store.highlight;
      const workingChanged = working !== lastWorking;
      const highlightChanged = highlight !== lastHighlight;
      lastWorking = working;
      lastHighlight = highlight;
      if (workingChanged) waypointRenderGeneration += 1;
      if (!working) {
        if (workingChanged) {
          for (const src of [WPT_SRC, HL_SEG_SRC, HL_DOT_SRC]) {
            setSourceData(ctx.map, src, emptyFeatureCollection());
          }
        }
        return;
      }
      if (workingChanged) {
        const features = waypointPointFeatures(working.waypoints).map((feature) => ({
          ...feature,
          properties: {
            ...feature.properties,
            [RENDER_GENERATION_PROPERTY]: waypointRenderGeneration,
          },
        }));
        setSourceData(ctx.map, WPT_SRC, featureCollection(features));
      }
      // The highlight geometry rides on the waypoint positions, so a drag (working change) moves it
      // too; rebuild it when either the working route or the highlight changed.
      if (workingChanged || highlightChanged) {
        const hl = highlightFeatures(working, highlight);
        setSourceData(ctx.map, HL_SEG_SRC, hl.segments);
        setSourceData(ctx.map, HL_DOT_SRC, hl.dots);
      }
    },
    setTheme(theme) {
      paint = mapThemePaint(theme);
      const map = ctxRef?.map;
      if (!map?.getLayer(WPT_LAYER)) return;
      recolorWaypointLayers(map, WPT_LAYER, WPT_LABEL_LAYER, paint);
      map.setPaintProperty(HL_SEG_LAYER, 'line-color', paint.routeHighlight);
      map.setPaintProperty(HL_HALO_LAYER, 'circle-color', paint.select);
      map.setPaintProperty(HL_RING_LAYER, 'circle-color', paint.select);
      map.setPaintProperty(HL_RING_LAYER, 'circle-stroke-color', paint.markerGlyph);
    },
    raise(ctx) {
      const before = ctx.beforeIdFor(BAND);
      for (const id of LAYERS) {
        if (ctx.map.getLayer(id)) ctx.map.moveLayer(id, before);
      }
    },
    remove(ctx) {
      removeLayersAndSources(ctx.map, LAYERS, [WPT_SRC, HL_SEG_SRC, HL_DOT_SRC]);
      // Reset the dirty checks too, so a later add() repopulates rather than trusting caches that
      // describe sources this just deleted.
      ctxRef = undefined;
      lastEditVersion = -1;
      lastWorking = undefined;
      lastHighlight = undefined;
    },
    hitTestWaypoint(point) {
      const map = ctxRef?.map;
      if (!map?.getLayer(WPT_LAYER)) return undefined;
      const hits = map.queryRenderedFeatures(
        [
          [point.x - HIT_PAD, point.y - HIT_PAD],
          [point.x + HIT_PAD, point.y + HIT_PAD],
        ],
        { layers: [WPT_LAYER] },
      );
      const working = store.working;
      // If the store changed before this overlay's next sync, every rendered waypoint is stale.
      if (!working || working !== lastWorking) return undefined;
      for (const feature of hits) {
        if (feature.geometry.type !== 'Point') continue;
        if (feature.properties?.[RENDER_GENERATION_PROPERTY] !== waypointRenderGeneration) {
          continue;
        }
        const index = feature.properties?.index;
        if (
          typeof index === 'number' &&
          Number.isSafeInteger(index) &&
          index >= 0 &&
          index < working.waypoints.length
        ) {
          return index;
        }
      }
      return undefined;
    },
  };
}
