import type {
  CircleLayerSpecification,
  ExpressionSpecification,
  FillLayerSpecification,
  LineLayerSpecification,
  MapLayerMouseEvent,
  MapLayerTouchEvent,
  MapMouseEvent,
  MapTouchEvent,
} from 'maplibre-gl';
import type { AnchorWatch } from '$entities/anchor';
import type { OwnVessel } from '$entities/vessel';
import { type LatLon, latLonToLonLat } from '$shared/geo';
import {
  antimeridianLineGeometry,
  emptyFeatureCollection,
  ensureGeoJsonSources,
  featureCollection,
  type MapThemePaint,
  mapThemePaint,
  type OverlayContext,
  type OverlayModule,
  removeLayersAndSources,
  setLayersVisibility,
  setSourceData,
} from '$shared/map';
import { geodesicCircleRing } from '$shared/nav';

const SHAPE_SRC = 'binnacle-anchor-shapes';
const POINT_SRC = 'binnacle-anchor-point';
const FILL_LAYER = 'binnacle-anchor-swing-fill';
const RING_LAYER = 'binnacle-anchor-swing-ring';
const RODE_LAYER = 'binnacle-anchor-rode';
const MARKER_LAYER = 'binnacle-anchor-marker';
const BAND = 'routes';
const LAYERS = [FILL_LAYER, RING_LAYER, RODE_LAYER, MARKER_LAYER];

const ANCHOR_OVERLAY_ID = 'anchor-watch';

// The swing fill is a faint wash so the chart reads through it; the ring and marker carry the color.
const FILL_OPACITY = 0.1;

// Watch geometry in the selection accent; the alarm color takes over while dragging.
function watchColor(paint: MapThemePaint): ExpressionSpecification {
  return ['case', ['get', 'dragging'], paint.danger, paint.select];
}

function shapeFeatures(
  anchor: LatLon | undefined,
  radiusMeters: number | undefined,
  vessel: LatLon | undefined,
  dragging: boolean,
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  if (anchor && radiusMeters !== undefined) {
    features.push({
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [geodesicCircleRing(anchor.latitude, anchor.longitude, radiusMeters)],
      },
      properties: { dragging },
    });
  }
  if (anchor && vessel) {
    features.push({
      type: 'Feature',
      geometry: antimeridianLineGeometry([latLonToLonLat(anchor), latLonToLonLat(vessel)]),
      properties: { dragging, rode: true },
    });
  }
  return featureCollection(features);
}

function pointFeatures(anchor: LatLon | undefined, dragging: boolean): GeoJSON.FeatureCollection {
  if (!anchor) return emptyFeatureCollection();
  return featureCollection([
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: latLonToLonLat(anchor) },
      properties: { dragging },
    },
  ]);
}

export interface AnchorOverlay extends OverlayModule {
  sync(ctx: OverlayContext): void;
}

// The on-chart anchor watch: the swing circle, the rode line from anchor to vessel, and a draggable
// anchor marker. Dragging the marker previews locally and commits the new drop point through
// onMoved once the pointer lifts (the app routes it to the server PUT or the local store).
export function createAnchorOverlay(
  anchor: AnchorWatch,
  vessel: OwnVessel,
  onMoved?: (position: LatLon) => void,
  interactionsAllowed: () => boolean = () => true,
): AnchorOverlay {
  let paint = mapThemePaint('day');
  let opacity = 1;
  let visible = true;
  // The marker position while a drag is in flight, overriding the store so the preview is smooth
  // without committing every pointer move. Cleared on pointer-up; in server mode the marker can snap
  // back briefly until the stream confirms the PUT, which is honest about who owns the state.
  let dragPreview: LatLon | undefined;
  let needsRedraw = false;
  let lastAnchor: LatLon | undefined;
  let lastVessel: LatLon | undefined;
  let lastRadius: number | undefined;
  let lastDragging = false;
  // add() can run again after a base-style swap; the map keeps its listeners across that, so the
  // drag handlers must only ever attach once.
  let handlersAttached = false;
  let cancelActiveDrag: (() => void) | undefined;
  // Detaches the marker-layer drag handlers, set when they attach so remove() can unregister them.
  // Without it a standalone unregister-then-readd would leak the listeners and the attach guard would
  // then block reattach, silently disabling anchor drag.
  let detachMarkerDrag: (() => void) | undefined;

  const canInteract = (): boolean => visible && opacity > 0 && interactionsAllowed();
  const onPointerMove = (e: MapMouseEvent | MapTouchEvent): void => {
    if (!canInteract()) {
      cancelActiveDrag?.();
      return;
    }
    dragPreview = { latitude: e.lngLat.lat, longitude: e.lngLat.lng };
    needsRedraw = true;
  };

  return {
    id: ANCHOR_OVERLAY_ID,
    title: 'Anchor watch',
    description: 'The set anchor point and its drag-alarm circle.',
    band: BAND,
    supportsOpacity: true,
    layerIds: LAYERS,
    add(ctx) {
      const { map } = ctx;
      const before = ctx.beforeIdFor(BAND);
      ensureGeoJsonSources(map, [SHAPE_SRC, POINT_SRC]);
      if (!map.getLayer(FILL_LAYER)) {
        const layer: FillLayerSpecification = {
          id: FILL_LAYER,
          type: 'fill',
          source: SHAPE_SRC,
          filter: ['!', ['has', 'rode']],
          paint: { 'fill-color': watchColor(paint), 'fill-opacity': FILL_OPACITY * opacity },
        };
        map.addLayer(layer, before);
      }
      if (!map.getLayer(RING_LAYER)) {
        const layer: LineLayerSpecification = {
          id: RING_LAYER,
          type: 'line',
          source: SHAPE_SRC,
          filter: ['!', ['has', 'rode']],
          paint: {
            'line-color': watchColor(paint),
            'line-width': ['case', ['get', 'dragging'], 3, 2],
          },
        };
        map.addLayer(layer, before);
      }
      if (!map.getLayer(RODE_LAYER)) {
        const layer: LineLayerSpecification = {
          id: RODE_LAYER,
          type: 'line',
          source: SHAPE_SRC,
          filter: ['has', 'rode'],
          paint: {
            'line-color': watchColor(paint),
            'line-width': 1.5,
            'line-dasharray': [1, 2],
          },
        };
        map.addLayer(layer, before);
      }
      if (!map.getLayer(MARKER_LAYER)) {
        const layer: CircleLayerSpecification = {
          id: MARKER_LAYER,
          type: 'circle',
          source: POINT_SRC,
          paint: {
            'circle-radius': 7,
            'circle-color': watchColor(paint),
            'circle-stroke-color': paint.markerGlyph,
            'circle-stroke-width': 1.5,
          },
        };
        map.addLayer(layer, before);
      }
      // Force a redraw so a reattach after a base-style swap repopulates the emptied sources.
      needsRedraw = true;

      if (!onMoved || handlersAttached) return;
      handlersAttached = true;
      const commitMove = onMoved;
      function endDrag(e: MapMouseEvent | MapTouchEvent): void {
        if (!canInteract()) {
          cancelDrag();
          return;
        }
        map.off('mousemove', onPointerMove);
        map.off('touchmove', onPointerMove);
        map.off('mouseup', endDrag);
        map.off('touchend', endDrag);
        map.off('touchcancel', cancelDrag);
        const committed = dragPreview ?? { latitude: e.lngLat.lat, longitude: e.lngLat.lng };
        dragPreview = undefined;
        needsRedraw = true;
        commitMove(committed);
      }
      // A canceled touch (a system gesture, palm rejection) must abandon the drag: discard the
      // preview without committing, and detach the move and end handlers so a later pan plus
      // touchend cannot silently relocate the anchor.
      function cancelDrag(): void {
        map.off('mousemove', onPointerMove);
        map.off('touchmove', onPointerMove);
        map.off('mouseup', endDrag);
        map.off('touchend', endDrag);
        map.off('touchcancel', cancelDrag);
        dragPreview = undefined;
        needsRedraw = true;
      }
      cancelActiveDrag = cancelDrag;
      const onMarkerMouseDown = (e: MapLayerMouseEvent): void => {
        if (!canInteract()) return;
        e.preventDefault();
        map.on('mousemove', onPointerMove);
        // No mouse cancel path: MapLibre tracks an in-flight mouse drag at the window level, so
        // mouseup reaches endDrag even when the button is released off the canvas.
        void map.once('mouseup', endDrag);
      };
      const onMarkerTouchStart = (e: MapLayerTouchEvent): void => {
        if (e.points.length !== 1 || !canInteract()) return;
        e.preventDefault();
        map.on('touchmove', onPointerMove);
        void map.once('touchend', endDrag);
        void map.once('touchcancel', cancelDrag);
      };
      const onMarkerEnter = (): void => {
        if (canInteract()) map.getCanvas().style.cursor = 'move';
      };
      const onMarkerLeave = (): void => {
        map.getCanvas().style.cursor = '';
      };
      map.on('mousedown', MARKER_LAYER, onMarkerMouseDown);
      map.on('touchstart', MARKER_LAYER, onMarkerTouchStart);
      map.on('mouseenter', MARKER_LAYER, onMarkerEnter);
      map.on('mouseleave', MARKER_LAYER, onMarkerLeave);
      detachMarkerDrag = () => {
        map.off('mousedown', MARKER_LAYER, onMarkerMouseDown);
        map.off('touchstart', MARKER_LAYER, onMarkerTouchStart);
        map.off('mouseenter', MARKER_LAYER, onMarkerEnter);
        map.off('mouseleave', MARKER_LAYER, onMarkerLeave);
        // Drop any in-flight drag listeners too, so a teardown mid-drag leaves nothing attached.
        map.off('mousemove', onPointerMove);
        map.off('touchmove', onPointerMove);
        // And the pending pointer-up end handlers a drag-in-progress registered with once(), so a
        // teardown mid-drag cannot later fire endDrag against the gone overlay and commit a stale
        // anchor position.
        map.off('mouseup', endDrag);
        map.off('touchend', endDrag);
        map.off('touchcancel', cancelDrag);
      };
    },
    sync(ctx) {
      if (!canInteract()) cancelActiveDrag?.();
      const anchorPos = dragPreview ?? anchor.position;
      const vesselPos = vessel.position;
      const radius = anchor.radiusMeters;
      const dragging = anchor.dragging;
      if (
        !needsRedraw &&
        anchorPos === lastAnchor &&
        vesselPos === lastVessel &&
        radius === lastRadius &&
        dragging === lastDragging
      ) {
        return;
      }
      needsRedraw = false;
      lastAnchor = anchorPos;
      lastVessel = vesselPos;
      lastRadius = radius;
      lastDragging = dragging;
      setSourceData(ctx.map, SHAPE_SRC, shapeFeatures(anchorPos, radius, vesselPos, dragging));
      setSourceData(ctx.map, POINT_SRC, pointFeatures(anchorPos, dragging));
    },
    setVisible(ctx, next) {
      visible = next;
      if (!canInteract()) {
        cancelActiveDrag?.();
        if (ctx.map.getCanvas().style.cursor === 'move') ctx.map.getCanvas().style.cursor = '';
      }
      setLayersVisibility(ctx.map, LAYERS, next);
    },
    // Both mutators guard on getLayer: an opacity or theme change can land in the window before
    // add() has attached the layers, and setPaintProperty throws on a missing layer. Skipping is
    // safe because the new value is kept here and add() bakes it into the layer specification, and
    // the LayerManager re-applies both right after add() resolves.
    setOpacity(ctx, next) {
      opacity = next;
      if (!canInteract()) {
        cancelActiveDrag?.();
        if (ctx.map.getCanvas().style.cursor === 'move') ctx.map.getCanvas().style.cursor = '';
      }
      const { map } = ctx;
      if (map.getLayer(FILL_LAYER)) {
        map.setPaintProperty(FILL_LAYER, 'fill-opacity', FILL_OPACITY * opacity);
      }
      if (map.getLayer(RING_LAYER)) map.setPaintProperty(RING_LAYER, 'line-opacity', opacity);
      if (map.getLayer(RODE_LAYER)) map.setPaintProperty(RODE_LAYER, 'line-opacity', opacity);
      if (map.getLayer(MARKER_LAYER)) {
        map.setPaintProperty(MARKER_LAYER, 'circle-opacity', opacity);
        map.setPaintProperty(MARKER_LAYER, 'circle-stroke-opacity', opacity);
      }
    },
    applyTheme(ctx, next) {
      paint = next;
      const { map } = ctx;
      if (map.getLayer(FILL_LAYER)) {
        map.setPaintProperty(FILL_LAYER, 'fill-color', watchColor(paint));
      }
      if (map.getLayer(RING_LAYER)) {
        map.setPaintProperty(RING_LAYER, 'line-color', watchColor(paint));
      }
      if (map.getLayer(RODE_LAYER)) {
        map.setPaintProperty(RODE_LAYER, 'line-color', watchColor(paint));
      }
      if (map.getLayer(MARKER_LAYER)) {
        map.setPaintProperty(MARKER_LAYER, 'circle-color', watchColor(paint));
        map.setPaintProperty(MARKER_LAYER, 'circle-stroke-color', paint.markerGlyph);
      }
    },
    remove(ctx) {
      detachMarkerDrag?.();
      detachMarkerDrag = undefined;
      cancelActiveDrag = undefined;
      handlersAttached = false;
      removeLayersAndSources(ctx.map, LAYERS, [SHAPE_SRC, POINT_SRC]);
    },
  };
}
