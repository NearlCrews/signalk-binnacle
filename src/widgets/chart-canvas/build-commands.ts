import type { Map as MapLibreMap } from 'maplibre-gl';
import type { RouteStore } from '$entities/route';
import type { OwnVessel } from '$entities/vessel';
import type { LayersView } from '$features/layers-panel';
import type { NotesOverlay } from '$features/notes';
import type { RouteEditor } from '$features/route-edit';
import type { WorkingRouteOverlay } from '$features/route-layer';
import { lngLatBoundsToBbox4, normalizeBounds } from '$shared/geo';
import { prefersReducedMotion } from '$shared/lib';
import type { LayerManager, OverlayContext } from '$shared/map';
import type { MapCommands } from './commands';

export interface MapCommandsDeps {
  map: MapLibreMap;
  ctx: OverlayContext;
  view: LayersView;
  manager: LayerManager;
  vessel: OwnVessel;
  routeStore: RouteStore;
  notesOverlay: NotesOverlay;
  // The lazily-imported on-chart route editor, loaded on first use; resolves undefined on a
  // chunk-load failure so route editing degrades rather than throwing.
  loadRouteEditor: () => Promise<RouteEditor | undefined>;
  // The host's working-route overlay binding, read live because it is created after the commands
  // are wired (and after a base-style swap it may be re-created).
  getWorkingRouteOverlay: () => WorkingRouteOverlay | undefined;
  // The latest route editor, read live because loadRouteEditor sets it asynchronously.
  getRouteEditor: () => RouteEditor | undefined;
  // The route-edit generation counter lives in the host so its theme effect and click handler share
  // it. nextEditGeneration starts a new edit (and returns its token), cancelEditGeneration retires
  // any in-flight edit, and currentEditGeneration reads the live token so a stale load bails.
  nextEditGeneration: () => number;
  cancelEditGeneration: () => void;
  currentEditGeneration: () => number;
}

// The imperative map actions the chart exposes to the app shell, built once the map is ready. Pure
// wiring over the injected map, overlays, and route-edit accessors; it owns no state of its own.
export function buildMapCommands(deps: MapCommandsDeps): MapCommands {
  const {
    map,
    ctx,
    view,
    manager,
    vessel,
    routeStore,
    notesOverlay,
    loadRouteEditor,
    getWorkingRouteOverlay,
    getRouteEditor,
    nextEditGeneration,
    cancelEditGeneration,
    currentEditGeneration,
  } = deps;
  // Fly to a point, holding the current zoom unless it is below `floor`, in which case it zooms in
  // to `target`; a reduced-motion preference drops the animation. Shared by centerOnVessel and flyTo.
  const flyToMinZoom = (lngLat: [number, number], floor: number, target: number): void => {
    const zoom = map.getZoom();
    map.flyTo({
      center: lngLat,
      zoom: zoom < floor ? target : zoom,
      ...(prefersReducedMotion() ? { duration: 0 } : {}),
    });
  };
  return {
    centerOnVessel: () => {
      const position = vessel.position;
      if (!position || vessel.positionStale) return;
      flyToMinZoom([position.longitude, position.latitude], 12, 14);
    },
    recenterOnVessel: (latitude, longitude, lookAheadPx = 0) => {
      if (lookAheadPx > 0) {
        // easeTo at zero duration, not setCenter: only the ease path takes the offset that places
        // the vessel low on a rotated screen so the water ahead gets the pixels. Bounded by the
        // caller; no animation, matching the plain recenter.
        map.easeTo({ center: [longitude, latitude], offset: [0, lookAheadPx], duration: 0 });
        return;
      }
      map.setCenter([longitude, latitude]);
    },
    setMapBearing: (bearingDeg) => {
      // Coalesce sub-degree jitter: a compass wanders tenths of a degree at rest, and easing the
      // camera for each tick would keep the map perpetually in motion.
      const delta = Math.abs(((bearingDeg - map.getBearing() + 540) % 360) - 180);
      if (delta < 0.75) return;
      map.easeTo({
        bearing: bearingDeg,
        ...(prefersReducedMotion() ? { duration: 0 } : { duration: 300 }),
      });
    },
    flyTo: (latitude, longitude) => {
      flyToMinZoom([longitude, latitude], 11, 12);
    },
    fitBounds: (bounds) => {
      // normalizeBounds rejects a malformed (non-finite or inverted) descriptor, unwraps an
      // antimeridian crossing, and pads a degenerate box, so the widget just issues the move.
      const corners = normalizeBounds(bounds);
      if (!corners) return;
      map.fitBounds(corners, {
        padding: 40,
        maxZoom: 16,
        duration: prefersReducedMotion() ? 0 : 800,
      });
    },
    getBounds: () => lngLatBoundsToBbox4(map.getBounds()),
    highlightPoi: (position) => notesOverlay.highlight(ctx, position),
    startRouteEdit: (route, initialPoint) => {
      const generation = nextEditGeneration();
      void loadRouteEditor().then((editor) => {
        if (generation !== currentEditGeneration()) return;
        editor?.start(route, initialPoint);
        // The editor's Terra Draw line was just added at the top of the routes band; lift the
        // working-route dots and highlight back above it.
        getWorkingRouteOverlay()?.raise(ctx);
      });
    },
    stopRouteEdit: () => {
      cancelEditGeneration();
      getRouteEditor()?.stop();
    },
    applyLayers: (settings, order) => {
      manager.applySnapshot(settings, order);
      view.refresh();
      // applySnapshot restacks the routes band, so re-lift the working overlay above the editor
      // line while a route is being edited.
      if (routeStore.working) getWorkingRouteOverlay()?.raise(ctx);
    },
  };
}
