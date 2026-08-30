import type {
  ExpressionSpecification,
  FillLayerSpecification,
  LineLayerSpecification,
  SymbolLayerSpecification,
} from 'maplibre-gl';
import {
  ensureGeoJsonSources,
  featureCollection,
  type MapThemePaint,
  mapThemePaint,
  type OverlayContext,
  type OverlayModule,
  removeLayersAndSources,
  setLayersVisibility,
  setPaintProp,
  setSourceData,
  severityMatchExpression,
} from '$shared/map';
import type { RegionZone } from './region-zones-client';
import type { RegionZonesStore } from './region-zones-store.svelte';

const SHAPE_SRC = 'binnacle-region-zones-shapes';
const LABEL_SRC = 'binnacle-region-zones-labels';
const FILL_LAYER = 'binnacle-region-zones-fill';
const OUTLINE_LAYER = 'binnacle-region-zones-outline';
const LABEL_LAYER = 'binnacle-region-zones-label';
const BAND = 'safety';
const LAYERS = [FILL_LAYER, OUTLINE_LAYER, LABEL_LAYER];

export const REGION_ZONES_OVERLAY_ID = 'region-zones';

// The polygon layer a tap recognizer queries for region hits. Its features carry id, name,
// description, and severity properties, so a hit can title and describe the tapped zone without
// another fetch. Tap wiring itself lives with the chart's recognizers, not in this slice.
export const REGION_ZONES_HIT_LAYER = FILL_LAYER;

// A faint wash so the chart reads through the area; the outline and label carry the color.
const FILL_OPACITY = 0.12;

// Anchoring prohibitions take the warning hue; everything else takes the muted boundary tone, so a
// named race area reads as an annotation rather than an alert. No zone is graded 'danger' today,
// but the shared severity expression carries the arm so a future grading slots in without a new
// paint shape.
function zoneColor(paint: MapThemePaint): ExpressionSpecification {
  return severityMatchExpression(paint.danger, paint.warning, paint.boundary);
}

function labelColor(paint: MapThemePaint): ExpressionSpecification {
  return severityMatchExpression(paint.danger, paint.warning, paint.label);
}

function shapeFeatures(zones: readonly RegionZone[]): GeoJSON.FeatureCollection {
  return featureCollection(
    zones.map((zone) => ({
      type: 'Feature' as const,
      geometry: zone.geometry,
      properties: {
        id: zone.id,
        name: zone.name,
        ...(zone.description ? { description: zone.description } : {}),
        severity: zone.severity,
      },
    })),
  );
}

function labelFeatures(zones: readonly RegionZone[]): GeoJSON.FeatureCollection {
  return featureCollection(
    zones.map((zone) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: zone.labelPosition },
      properties: { name: zone.name, severity: zone.severity },
    })),
  );
}

export interface RegionZonesOverlay extends OverlayModule {
  sync(ctx: OverlayContext): void;
}

// The regions resource on the chart: each zone as a low-opacity fill with a themed outline and its
// name at the area's center. Data loads on demand, through the store, the first time the layer
// turns visible.
export function createRegionZonesOverlay(store: RegionZonesStore): RegionZonesOverlay {
  let paint = mapThemePaint('day');
  let opacity = 1;
  let needsRedraw = false;
  let lastRegions: readonly RegionZone[] | undefined;

  return {
    id: REGION_ZONES_OVERLAY_ID,
    title: 'Regions',
    description:
      'Named areas published to the Signal K server: exclusion zones, no-anchor zones, and race areas.',
    band: BAND,
    category: 'reference',
    supportsOpacity: true,
    defaultVisible: false,
    layerIds: LAYERS,
    available: () => store.state !== 'unavailable',
    unavailableHint: 'This Signal K server has no regions provider.',
    add(ctx) {
      const { map } = ctx;
      const before = ctx.beforeIdFor(BAND);
      ensureGeoJsonSources(map, [SHAPE_SRC, LABEL_SRC]);
      if (!map.getLayer(FILL_LAYER)) {
        const fill: FillLayerSpecification = {
          id: FILL_LAYER,
          type: 'fill',
          source: SHAPE_SRC,
          paint: { 'fill-color': zoneColor(paint), 'fill-opacity': FILL_OPACITY * opacity },
        };
        map.addLayer(fill, before);
      }
      if (!map.getLayer(OUTLINE_LAYER)) {
        const outline: LineLayerSpecification = {
          id: OUTLINE_LAYER,
          type: 'line',
          source: SHAPE_SRC,
          paint: { 'line-color': zoneColor(paint), 'line-width': 1.5, 'line-opacity': opacity },
        };
        map.addLayer(outline, before);
      }
      if (!map.getLayer(LABEL_LAYER)) {
        const label: SymbolLayerSpecification = {
          id: LABEL_LAYER,
          type: 'symbol',
          source: LABEL_SRC,
          layout: {
            'text-field': ['get', 'name'],
            'text-font': ['Noto Sans Regular'],
            'text-size': 11,
            'text-max-width': 12,
          },
          paint: {
            'text-color': labelColor(paint),
            'text-halo-color': paint.background,
            'text-halo-width': 1.2,
            'text-opacity': opacity,
          },
        };
        map.addLayer(label, before);
      }
      // Force a redraw so a reattach after a base-style swap repopulates the emptied sources.
      needsRedraw = true;
    },
    sync(ctx) {
      const regions = store.regions;
      if (!needsRedraw && regions === lastRegions) return;
      needsRedraw = false;
      lastRegions = regions;
      setSourceData(ctx.map, SHAPE_SRC, shapeFeatures(regions));
      setSourceData(ctx.map, LABEL_SRC, labelFeatures(regions));
    },
    setVisible(ctx, visible) {
      // Load on demand: the first turn to visible is what asks the server for the collection.
      if (visible) void store.ensureLoaded();
      setLayersVisibility(ctx.map, LAYERS, visible);
    },
    setOpacity(ctx, next) {
      opacity = next;
      setPaintProp(ctx.map, FILL_LAYER, 'fill-opacity', FILL_OPACITY * opacity);
      setPaintProp(ctx.map, OUTLINE_LAYER, 'line-opacity', opacity);
      setPaintProp(ctx.map, LABEL_LAYER, 'text-opacity', opacity);
    },
    applyTheme(ctx, next) {
      paint = next;
      setPaintProp(ctx.map, FILL_LAYER, 'fill-color', zoneColor(paint));
      setPaintProp(ctx.map, OUTLINE_LAYER, 'line-color', zoneColor(paint));
      setPaintProp(ctx.map, LABEL_LAYER, 'text-color', labelColor(paint));
      setPaintProp(ctx.map, LABEL_LAYER, 'text-halo-color', paint.background);
    },
    reset() {
      lastRegions = undefined;
    },
    remove(ctx) {
      removeLayersAndSources(ctx.map, LAYERS, [SHAPE_SRC, LABEL_SRC]);
    },
  };
}
