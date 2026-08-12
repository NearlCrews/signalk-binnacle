import type { CircleLayerSpecification, LineLayerSpecification } from 'maplibre-gl';
import {
  antimeridianLineGeometry,
  emptyFeatureCollection,
  ensureGeoJsonSource,
  featureCollection,
  mapThemePaint,
  type OverlayContext,
  type OverlayModule,
  removeLayersAndSources,
  setLayersVisibility,
  setSourceData,
} from '$shared/map';
import type { TimeTravelController } from './time-travel-controller.svelte';
import { positionedTrackSegments } from './time-travel-timeline';

const MARKER_SOURCE_ID = 'binnacle-time-travel-marker';
const MARKER_LAYER_ID = 'binnacle-time-travel-marker-circle';
const TRACK_SOURCE_ID = 'binnacle-time-travel-track';
const TRACK_LAYER_ID = 'binnacle-time-travel-track-line';
const MARKER_RADIUS = 7;
const MARKER_STROKE_WIDTH = 3;
const TRACK_WIDTH = 3;
const TRACK_OPACITY = 0.75;

export interface TimeTravelOverlay extends OverlayModule {
  sync(ctx: OverlayContext): void;
}

export function createTimeTravelOverlay(controller: TimeTravelController): TimeTravelOverlay {
  let paint = mapThemePaint('day');
  let lastLon: number | undefined;
  let lastLat: number | undefined;
  let lastActive = false;

  function markerData(): GeoJSON.FeatureCollection {
    const s = controller.active ? controller.markerSample : undefined;
    if (!s || s.lon === undefined || s.lat === undefined) return emptyFeatureCollection();
    return featureCollection([
      { type: 'Feature', geometry: { type: 'Point', coordinates: [s.lon, s.lat] }, properties: {} },
    ]);
  }

  return {
    id: 'time-travel-marker',
    title: 'Playback',
    band: 'vessel',
    listed: false,
    supportsOpacity: false,
    defaultVisible: true,
    layerIds: [MARKER_LAYER_ID],
    add(ctx) {
      // Reset the dirty-check so a base-style swap that recreates the source empty repopulates on
      // the next sync rather than staying blank.
      lastActive = false;
      lastLon = undefined;
      lastLat = undefined;
      ensureGeoJsonSource(ctx.map, MARKER_SOURCE_ID);
      if (!ctx.map.getLayer(MARKER_LAYER_ID)) {
        const layer: CircleLayerSpecification = {
          id: MARKER_LAYER_ID,
          type: 'circle',
          source: MARKER_SOURCE_ID,
          paint: {
            'circle-radius': MARKER_RADIUS,
            'circle-color': 'rgba(0, 0, 0, 0)',
            'circle-stroke-color': paint.scrubMarker,
            'circle-stroke-width': MARKER_STROKE_WIDTH,
          },
        };
        ctx.map.addLayer(layer, ctx.beforeIdFor('vessel'));
      }
    },
    sync(ctx) {
      const s = controller.active ? controller.markerSample : undefined;
      const lon = s?.lon;
      const lat = s?.lat;
      if (controller.active === lastActive && lon === lastLon && lat === lastLat) return;
      lastActive = controller.active;
      lastLon = lon;
      lastLat = lat;
      setSourceData(ctx.map, MARKER_SOURCE_ID, markerData());
    },
    setVisible(ctx, visible) {
      setLayersVisibility(ctx.map, [MARKER_LAYER_ID], visible);
    },
    applyTheme(ctx, next) {
      paint = next;
      if (ctx.map.getLayer(MARKER_LAYER_ID)) {
        ctx.map.setPaintProperty(MARKER_LAYER_ID, 'circle-stroke-color', paint.scrubMarker);
      }
    },
    remove(ctx) {
      removeLayersAndSources(ctx.map, [MARKER_LAYER_ID], [MARKER_SOURCE_ID]);
    },
  };
}

export function createTimeTravelTrackOverlay(controller: TimeTravelController): TimeTravelOverlay {
  let paint = mapThemePaint('day');
  let lastActive = false;
  let lastSamples: TimeTravelController['samples'] | undefined;
  let lastScrub = Number.NaN;

  function trackData(): GeoJSON.FeatureCollection {
    const accepted = controller.accepted;
    if (!controller.active || !accepted) return emptyFeatureCollection();
    const maxGapMs = Math.max(5 * accepted.preset.resolutionSeconds, 5 * 60) * 1000;
    const throughMs = controller.markerSample?.t ?? controller.scrubMs;
    return featureCollection(
      positionedTrackSegments(accepted.samples, throughMs, maxGapMs).map((segment) => ({
        type: 'Feature',
        geometry: antimeridianLineGeometry(segment.map((point) => [point.lon, point.lat])),
        properties: {},
      })),
    );
  }

  return {
    id: 'time-travel-track',
    title: 'Playback track',
    band: 'track',
    listed: false,
    supportsOpacity: false,
    defaultVisible: true,
    layerIds: [TRACK_LAYER_ID],
    add(ctx) {
      lastActive = false;
      lastSamples = undefined;
      lastScrub = Number.NaN;
      ensureGeoJsonSource(ctx.map, TRACK_SOURCE_ID);
      if (!ctx.map.getLayer(TRACK_LAYER_ID)) {
        const layer: LineLayerSpecification = {
          id: TRACK_LAYER_ID,
          type: 'line',
          source: TRACK_SOURCE_ID,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': paint.scrubMarker,
            'line-width': TRACK_WIDTH,
            'line-opacity': TRACK_OPACITY,
          },
        };
        ctx.map.addLayer(layer, ctx.beforeIdFor('track'));
      }
    },
    sync(ctx) {
      if (
        controller.active === lastActive &&
        controller.samples === lastSamples &&
        controller.scrubMs === lastScrub
      ) {
        return;
      }
      lastActive = controller.active;
      lastSamples = controller.samples;
      lastScrub = controller.scrubMs;
      setSourceData(ctx.map, TRACK_SOURCE_ID, trackData());
    },
    setVisible(ctx, visible) {
      setLayersVisibility(ctx.map, [TRACK_LAYER_ID], visible);
    },
    applyTheme(ctx, next) {
      paint = next;
      if (ctx.map.getLayer(TRACK_LAYER_ID)) {
        ctx.map.setPaintProperty(TRACK_LAYER_ID, 'line-color', paint.scrubMarker);
      }
    },
    remove(ctx) {
      removeLayersAndSources(ctx.map, [TRACK_LAYER_ID], [TRACK_SOURCE_ID]);
    },
  };
}
