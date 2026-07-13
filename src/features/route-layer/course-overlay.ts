import type { CircleLayerSpecification, LineLayerSpecification } from 'maplibre-gl';

import type { CourseGuidance } from '$entities/course';
import type { OwnVessel } from '$entities/vessel';
import { latLonToLonLat as toLonLat } from '$shared/geo';
import {
  DARK_SCRIM,
  emptyFeatureCollection,
  ensureGeoJsonSources,
  featureCollection,
  type MapThemePaint,
  mapThemePaint,
  type OverlayContext,
  type OverlayModule,
  removeLayersAndSources,
  rgbaCss,
  setLayersVisibility,
  setSourceData,
} from '$shared/map';

const LINE_SRC = 'binnacle-course-line-src';
const POINT_SRC = 'binnacle-course-point-src';
const LINE_LAYER = 'binnacle-course-line';
const POINT_LAYER = 'binnacle-course-point';
const BAND = 'routes';
const LAYERS = [LINE_LAYER, POINT_LAYER];

const LINE_WIDTH = 3;
// A slightly larger circle so the destination reads as a distinct target, not just a waypoint dot.
const POINT_RADIUS = 6;
const POINT_STROKE_WIDTH = 1.5;

export interface CourseOverlay extends OverlayModule {
  sync(ctx: OverlayContext): void;
}

export function createCourseOverlay(guidance: CourseGuidance, vessel: OwnVessel): CourseOverlay {
  let paint: MapThemePaint = mapThemePaint('day');
  // Dirty-check state: the last drawn vessel and destination coordinates, compared numerically so the
  // unchanged-frame path returns without allocating. NaN is the empty sentinel (no course drawn yet).
  let lastVesselLng = Number.NaN;
  let lastVesselLat = Number.NaN;
  let lastDestLng = Number.NaN;
  let lastDestLat = Number.NaN;

  function clearBoth(ctx: OverlayContext): void {
    if (Number.isNaN(lastVesselLng)) return;
    lastVesselLng = Number.NaN;
    lastVesselLat = Number.NaN;
    lastDestLng = Number.NaN;
    lastDestLat = Number.NaN;
    for (const src of [LINE_SRC, POINT_SRC]) {
      setSourceData(ctx.map, src, emptyFeatureCollection());
    }
  }

  return {
    id: 'course',
    title: 'Course',
    band: BAND,
    supportsOpacity: true,
    defaultVisible: true,
    layerIds: LAYERS,
    add(ctx) {
      // Reset the dirty-check so a reattach (after a base-style swap emptied the sources)
      // repopulates them on the next sync instead of staying blank.
      lastVesselLng = Number.NaN;
      lastVesselLat = Number.NaN;
      lastDestLng = Number.NaN;
      lastDestLat = Number.NaN;

      const before = ctx.beforeIdFor(BAND);
      ensureGeoJsonSources(ctx.map, [LINE_SRC, POINT_SRC]);

      // Line first so it sits below the destination circle in the stack.
      if (!ctx.map.getLayer(LINE_LAYER)) {
        const layer: LineLayerSpecification = {
          id: LINE_LAYER,
          type: 'line',
          source: LINE_SRC,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': paint.select,
            'line-width': LINE_WIDTH,
            // Dashed so the course line reads as a live projection, distinct from a saved route leg.
            'line-dasharray': [2, 1],
          },
        };
        ctx.map.addLayer(layer, before);
      }

      if (!ctx.map.getLayer(POINT_LAYER)) {
        const layer: CircleLayerSpecification = {
          id: POINT_LAYER,
          type: 'circle',
          source: POINT_SRC,
          paint: {
            'circle-radius': POINT_RADIUS,
            'circle-color': paint.select,
            'circle-stroke-color': rgbaCss(DARK_SCRIM),
            'circle-stroke-width': POINT_STROKE_WIDTH,
          },
        };
        ctx.map.addLayer(layer, before);
      }
    },
    sync(ctx) {
      if (!guidance.active) {
        clearBoth(ctx);
        return;
      }
      const dest = guidance.nextPosition;
      const pos = vessel.position;
      if (!dest || !pos || vessel.positionStale) {
        clearBoth(ctx);
        return;
      }

      // Compare the raw fields so the common unchanged-frame path returns before allocating any
      // coordinate arrays or feature objects.
      if (
        pos.longitude === lastVesselLng &&
        pos.latitude === lastVesselLat &&
        dest.longitude === lastDestLng &&
        dest.latitude === lastDestLat
      ) {
        return;
      }
      lastVesselLng = pos.longitude;
      lastVesselLat = pos.latitude;
      lastDestLng = dest.longitude;
      lastDestLat = dest.latitude;

      const vesselCoord = toLonLat(pos);
      const destCoord = toLonLat(dest);
      setSourceData(
        ctx.map,
        LINE_SRC,
        featureCollection([
          {
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: [vesselCoord, destCoord] },
            properties: {},
          },
        ]),
      );
      setSourceData(
        ctx.map,
        POINT_SRC,
        featureCollection([
          { type: 'Feature', geometry: { type: 'Point', coordinates: destCoord }, properties: {} },
        ]),
      );
    },
    applyTheme(ctx, next) {
      paint = next;
      ctx.map.setPaintProperty(LINE_LAYER, 'line-color', paint.select);
      ctx.map.setPaintProperty(POINT_LAYER, 'circle-color', paint.select);
    },
    setVisible(ctx, visible) {
      setLayersVisibility(ctx.map, LAYERS, visible);
    },
    setOpacity(ctx, opacity) {
      ctx.map.setPaintProperty(LINE_LAYER, 'line-opacity', opacity);
      ctx.map.setPaintProperty(POINT_LAYER, 'circle-opacity', opacity);
      ctx.map.setPaintProperty(POINT_LAYER, 'circle-stroke-opacity', opacity);
    },
    remove(ctx) {
      removeLayersAndSources(ctx.map, LAYERS, [LINE_SRC, POINT_SRC]);
    },
  };
}
