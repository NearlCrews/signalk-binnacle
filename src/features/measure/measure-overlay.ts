import type {
  CircleLayerSpecification,
  LineLayerSpecification,
  MapLayerMouseEvent,
  MapLayerTouchEvent,
  MapMouseEvent,
  MapTouchEvent,
  PointLike,
  SymbolLayerSpecification,
} from 'maplibre-gl';
import type { MeasureLeg, MeasureStore, MeasureVertex } from '$entities/measure';
import { type LatLon, latLonToLonLat, wrapLongitude } from '$shared/geo';
import { formatMetersOrNm, type UnitsMode } from '$shared/lib';
import {
  antimeridianLineGeometry,
  emptyFeatureCollection,
  ensureGeoJsonSource,
  featureCollection,
  mapThemePaint,
  type OverlayModule,
  removeLayersAndSources,
  type Syncable,
  setLayersVisibility,
  setSourceData,
} from '$shared/map';
import { mercatorIsometricLatitude, normalizeLonDeltaDeg } from '$shared/nav';
import { MEASURE_LAYER_IDS, MEASURE_OVERLAY_ID } from './measure-overlay-contract';

const SRC = 'binnacle-measure';
const [LINE_LAYER, HIT_LAYER, SELECTED_LAYER, VERTEX_LAYER, LEG_LABEL_LAYER, TOTAL_LABEL_LAYER] =
  MEASURE_LAYER_IDS;
const LEG_LABEL_MIN_ZOOM = 8;
const TRAILING_CLICK_WINDOW_MS = 500;

// A rhumb line is straight in Mercator space. Averaging there, with the longitude unwrapped to the
// short side of the world, keeps a label on its visual leg even when that leg crosses 180 degrees.
export function rhumbDisplayMidpoint(from: LatLon, to: LatLon): LatLon {
  const fromY = mercatorIsometricLatitude(from.latitude);
  const toY = mercatorIsometricLatitude(to.latitude);
  const latitude = (2 * Math.atan(Math.exp((fromY + toY) / 2)) - Math.PI / 2) * (180 / Math.PI);
  const rawDelta = normalizeLonDeltaDeg(to.longitude - from.longitude);
  return {
    latitude,
    longitude: wrapLongitude(from.longitude + rawDelta / 2),
  };
}

function lineFeature(item: MeasureLeg, moving: boolean): GeoJSON.Feature {
  return {
    type: 'Feature',
    id: item.id,
    geometry: antimeridianLineGeometry([latLonToLonLat(item.from), latLonToLonLat(item.to)]),
    properties: { kind: 'leg', legId: item.id, moving },
  };
}

function vertexFeature(
  vertex: MeasureVertex,
  index: number,
  lastIndex: number,
  selectedId: string | undefined,
  totalMeters: number,
  mode: UnitsMode,
): GeoJSON.Feature {
  return {
    type: 'Feature',
    id: vertex.id,
    geometry: { type: 'Point', coordinates: latLonToLonLat(vertex.position) },
    properties: {
      kind: 'vertex',
      vertexId: vertex.id,
      index,
      selected: vertex.id === selectedId,
      ...(index === lastIndex && lastIndex > 0
        ? { totalLabel: formatMetersOrNm(totalMeters, mode) }
        : {}),
    },
  };
}

function legLabelFeature(item: MeasureLeg, mode: UnitsMode): GeoJSON.Feature {
  return {
    type: 'Feature',
    id: `label:${item.id}`,
    geometry: {
      type: 'Point',
      coordinates: latLonToLonLat(rhumbDisplayMidpoint(item.from, item.to)),
    },
    properties: {
      kind: 'leg-label',
      legId: item.id,
      label: formatMetersOrNm(item.distanceMeters, mode),
    },
  };
}

function features(measure: MeasureStore, mode: UnitsMode): GeoJSON.FeatureCollection {
  const vertices = measure.displayVertices;
  if (vertices.length === 0) return emptyFeatureCollection();
  const legs = measure.displayLegs;
  const totalMeters = legs.reduce((total, item) => total + item.distanceMeters, 0);
  const movingId = measure.moveArmed ? measure.selectedId : undefined;
  const out: GeoJSON.Feature[] = vertices.map((vertex, index) =>
    vertexFeature(vertex, index, vertices.length - 1, measure.selectedId, totalMeters, mode),
  );
  for (const item of legs) {
    const moving = item.fromId === movingId || item.toId === movingId;
    out.push(lineFeature(item, moving), legLabelFeature(item, mode));
  }
  return featureCollection(out);
}

export interface MeasureOverlay extends OverlayModule, Syncable {
  hitTestVertex(point: PointLike): string | undefined;
  consumeTrailingClick(): boolean;
  cancelInteraction(): void;
}

// The overlay owns the Measure-specific chart gesture surface. The host delegates a chart click to
// hitTestVertex before appending a point, while deliberate move mode enables drag handlers on the
// invisible 44 px vertex targets. A completed drag commits one store operation.
export function createMeasureOverlay(
  measure: MeasureStore,
  units: { mode: UnitsMode },
): MeasureOverlay {
  let paint = mapThemePaint('day');
  let opacity = 1;
  let lastVertices: readonly MeasureVertex[] | undefined;
  let lastSelectedId: string | undefined;
  let lastMode: UnitsMode | undefined;
  let lastMoveArmed = false;
  let handlersAttached = false;
  let detachInteractions: (() => void) | undefined;
  let cancelActiveDrag: (() => void) | undefined;
  let hitTest: ((point: PointLike) => string | undefined) | undefined;
  let suppressClickUntil = 0;

  function reset(): void {
    lastVertices = undefined;
  }

  return {
    id: MEASURE_OVERLAY_ID,
    title: 'Measure',
    band: 'routes',
    listed: false,
    supportsOpacity: true,
    layerIds: MEASURE_LAYER_IDS,
    add(ctx) {
      const { map } = ctx;
      const before = ctx.beforeIdFor('routes');
      ensureGeoJsonSource(map, SRC);
      if (!map.getLayer(LINE_LAYER)) {
        const layer: LineLayerSpecification = {
          id: LINE_LAYER,
          type: 'line',
          source: SRC,
          filter: ['==', ['get', 'kind'], 'leg'],
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': paint.select,
            'line-width': ['case', ['get', 'moving'], 3, 2],
            'line-dasharray': [2, 2],
            'line-opacity': opacity,
          },
        };
        map.addLayer(layer, before);
      }
      if (!map.getLayer(HIT_LAYER)) {
        const layer: CircleLayerSpecification = {
          id: HIT_LAYER,
          type: 'circle',
          source: SRC,
          filter: ['==', ['get', 'kind'], 'vertex'],
          paint: {
            // Twenty-two pixels of radius supplies the 44 px gloved-hand target. It remains fully
            // transparent so the compact visible vertex and chart detail stay readable.
            'circle-radius': 22,
            'circle-color': paint.select,
            'circle-opacity': 0,
          },
        };
        map.addLayer(layer, before);
      }
      if (!map.getLayer(SELECTED_LAYER)) {
        const layer: CircleLayerSpecification = {
          id: SELECTED_LAYER,
          type: 'circle',
          source: SRC,
          filter: ['all', ['==', ['get', 'kind'], 'vertex'], ['==', ['get', 'selected'], true]],
          paint: {
            'circle-radius': 10,
            'circle-color': paint.background,
            'circle-opacity': opacity,
            'circle-stroke-color': paint.select,
            'circle-stroke-opacity': opacity,
            'circle-stroke-width': 3,
          },
        };
        map.addLayer(layer, before);
      }
      if (!map.getLayer(VERTEX_LAYER)) {
        const layer: CircleLayerSpecification = {
          id: VERTEX_LAYER,
          type: 'circle',
          source: SRC,
          filter: ['==', ['get', 'kind'], 'vertex'],
          paint: {
            'circle-radius': 5,
            'circle-color': paint.select,
            'circle-opacity': opacity,
            'circle-stroke-color': paint.markerGlyph,
            'circle-stroke-opacity': opacity,
            'circle-stroke-width': 1.5,
          },
        };
        map.addLayer(layer, before);
      }
      if (!map.getLayer(LEG_LABEL_LAYER)) {
        const layer: SymbolLayerSpecification = {
          id: LEG_LABEL_LAYER,
          type: 'symbol',
          source: SRC,
          minzoom: LEG_LABEL_MIN_ZOOM,
          filter: ['==', ['get', 'kind'], 'leg-label'],
          layout: {
            'text-field': ['get', 'label'],
            'text-font': ['Noto Sans Regular'],
            'text-size': 11,
            'text-optional': true,
            'text-allow-overlap': false,
            'text-ignore-placement': false,
            'symbol-avoid-edges': true,
          },
          paint: {
            'text-color': paint.select,
            'text-halo-color': paint.background,
            'text-halo-width': 1.5,
            'text-opacity': opacity,
          },
        };
        map.addLayer(layer, before);
      }
      if (!map.getLayer(TOTAL_LABEL_LAYER)) {
        const layer: SymbolLayerSpecification = {
          id: TOTAL_LABEL_LAYER,
          type: 'symbol',
          source: SRC,
          filter: ['has', 'totalLabel'],
          layout: {
            'text-field': ['get', 'totalLabel'],
            'text-font': ['Noto Sans Regular'],
            'text-size': 12,
            'text-offset': [0, 1.3],
            'text-optional': true,
          },
          paint: {
            'text-color': paint.select,
            'text-halo-color': paint.background,
            'text-halo-width': 1.5,
            'text-opacity': opacity,
          },
        };
        map.addLayer(layer, before);
      }
      reset();

      hitTest = (point) => {
        if (!map.getLayer(HIT_LAYER)) return undefined;
        try {
          const currentIds = new Set(measure.vertices.map((vertex) => vertex.id));
          for (const feature of map.queryRenderedFeatures(point, { layers: [HIT_LAYER] })) {
            const vertexId = feature.properties?.vertexId;
            if (
              feature.geometry.type === 'Point' &&
              typeof vertexId === 'string' &&
              currentIds.has(vertexId)
            ) {
              return vertexId;
            }
          }
          return undefined;
        } catch {
          // A style replacement can remove the layer between getLayer and the query. The next add
          // recreates it, and an empty result safely treats this one chart tap as water.
          return undefined;
        }
      };

      if (handlersAttached) return;
      handlersAttached = true;
      let dragging = false;
      let dragPanWasEnabled = false;
      let priorCursor = '';

      const restoreMapInteraction = (): void => {
        map.off('mousemove', onPointerMove);
        map.off('mouseup', onPointerEnd);
        map.off('touchmove', onPointerMove);
        map.off('touchend', onPointerEnd);
        map.off('touchcancel', onPointerCancel);
        if (typeof window !== 'undefined') window.removeEventListener('blur', onPointerCancel);
        if (dragging && dragPanWasEnabled) map.dragPan.enable();
        if (dragging) map.getCanvas().style.cursor = priorCursor;
        dragging = false;
      };

      const onPointerMove = (event: MapMouseEvent | MapTouchEvent): void => {
        if (!dragging) return;
        measure.previewSelected({
          latitude: event.lngLat.lat,
          longitude: event.lngLat.lng,
        });
      };

      const onPointerEnd = (event: MapMouseEvent | MapTouchEvent): void => {
        if (!dragging) return;
        const point = { latitude: event.lngLat.lat, longitude: event.lngLat.lng };
        restoreMapInteraction();
        measure.commitMove(point);
        suppressClickUntil = Date.now() + TRAILING_CLICK_WINDOW_MS;
      };

      const onPointerCancel = (): void => {
        if (!dragging) return;
        restoreMapInteraction();
        measure.cancelMove();
      };

      const beginDrag = (
        event: MapLayerMouseEvent | MapLayerTouchEvent,
        isTouch: boolean,
      ): void => {
        if (!measure.active || !measure.moveArmed || dragging) return;
        if (isTouch && 'points' in event && event.points.length !== 1) return;
        const vertexId = event.features?.[0]?.properties?.vertexId;
        if (vertexId !== measure.selectedId) return;
        event.preventDefault();
        dragging = true;
        dragPanWasEnabled = map.dragPan.isEnabled();
        if (dragPanWasEnabled) map.dragPan.disable();
        priorCursor = map.getCanvas().style.cursor;
        map.getCanvas().style.cursor = 'grabbing';
        map.on('mousemove', onPointerMove);
        map.on('mouseup', onPointerEnd);
        map.on('touchmove', onPointerMove);
        map.on('touchend', onPointerEnd);
        map.on('touchcancel', onPointerCancel);
        if (typeof window !== 'undefined') window.addEventListener('blur', onPointerCancel);
        measure.previewSelected({
          latitude: event.lngLat.lat,
          longitude: event.lngLat.lng,
        });
      };

      const onMouseDown = (event: MapLayerMouseEvent): void => beginDrag(event, false);
      const onTouchStart = (event: MapLayerTouchEvent): void => beginDrag(event, true);
      map.on('mousedown', HIT_LAYER, onMouseDown);
      map.on('touchstart', HIT_LAYER, onTouchStart);

      cancelActiveDrag = onPointerCancel;
      detachInteractions = () => {
        onPointerCancel();
        map.off('mousedown', HIT_LAYER, onMouseDown);
        map.off('touchstart', HIT_LAYER, onTouchStart);
      };
    },
    reset,
    sync(ctx) {
      if ((!measure.active || !measure.moveArmed) && cancelActiveDrag) cancelActiveDrag();
      const vertices = measure.displayVertices;
      const selectedId = measure.selectedId;
      const mode = units.mode;
      const moveArmed = measure.moveArmed;
      if (
        vertices === lastVertices &&
        selectedId === lastSelectedId &&
        mode === lastMode &&
        moveArmed === lastMoveArmed
      ) {
        return;
      }
      lastVertices = vertices;
      lastSelectedId = selectedId;
      lastMode = mode;
      lastMoveArmed = moveArmed;
      setSourceData(ctx.map, SRC, features(measure, mode));
    },
    hitTestVertex(point) {
      return hitTest?.(point);
    },
    consumeTrailingClick() {
      const suppressed = Date.now() <= suppressClickUntil;
      suppressClickUntil = 0;
      return suppressed;
    },
    cancelInteraction() {
      cancelActiveDrag?.();
      measure.cancelMove();
    },
    setVisible(ctx, visible) {
      setLayersVisibility(ctx.map, MEASURE_LAYER_IDS, visible);
    },
    setOpacity(ctx, next) {
      opacity = next;
      const { map } = ctx;
      if (map.getLayer(LINE_LAYER)) map.setPaintProperty(LINE_LAYER, 'line-opacity', opacity);
      if (map.getLayer(SELECTED_LAYER)) {
        map.setPaintProperty(SELECTED_LAYER, 'circle-opacity', opacity);
        map.setPaintProperty(SELECTED_LAYER, 'circle-stroke-opacity', opacity);
      }
      if (map.getLayer(VERTEX_LAYER)) {
        map.setPaintProperty(VERTEX_LAYER, 'circle-opacity', opacity);
        map.setPaintProperty(VERTEX_LAYER, 'circle-stroke-opacity', opacity);
      }
      if (map.getLayer(LEG_LABEL_LAYER)) {
        map.setPaintProperty(LEG_LABEL_LAYER, 'text-opacity', opacity);
      }
      if (map.getLayer(TOTAL_LABEL_LAYER)) {
        map.setPaintProperty(TOTAL_LABEL_LAYER, 'text-opacity', opacity);
      }
    },
    applyTheme(ctx, next) {
      paint = next;
      const { map } = ctx;
      if (map.getLayer(LINE_LAYER)) map.setPaintProperty(LINE_LAYER, 'line-color', paint.select);
      if (map.getLayer(HIT_LAYER)) map.setPaintProperty(HIT_LAYER, 'circle-color', paint.select);
      if (map.getLayer(SELECTED_LAYER)) {
        map.setPaintProperty(SELECTED_LAYER, 'circle-color', paint.background);
        map.setPaintProperty(SELECTED_LAYER, 'circle-stroke-color', paint.select);
      }
      if (map.getLayer(VERTEX_LAYER)) {
        map.setPaintProperty(VERTEX_LAYER, 'circle-color', paint.select);
        map.setPaintProperty(VERTEX_LAYER, 'circle-stroke-color', paint.markerGlyph);
      }
      for (const layer of [LEG_LABEL_LAYER, TOTAL_LABEL_LAYER]) {
        if (!map.getLayer(layer)) continue;
        map.setPaintProperty(layer, 'text-color', paint.select);
        map.setPaintProperty(layer, 'text-halo-color', paint.background);
      }
    },
    remove(ctx) {
      detachInteractions?.();
      detachInteractions = undefined;
      cancelActiveDrag = undefined;
      hitTest = undefined;
      handlersAttached = false;
      removeLayersAndSources(ctx.map, MEASURE_LAYER_IDS, [SRC]);
    },
  };
}
