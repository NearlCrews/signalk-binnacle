import type { AisTargets } from '$entities/ais';
import type { AnchorWatch } from '$entities/anchor';
import type { CollisionAssessment } from '$entities/collision';
import type { CourseGuidance } from '$entities/course';
import type { MeasureStore } from '$entities/measure';
import type { MobStore } from '$entities/mob';
import type { RouteStore } from '$entities/route';
import type { SymbolsStore } from '$entities/symbols';
import type { TidesStore } from '$entities/tides';
import type { TrackRecorder } from '$entities/track';
import type { UnitsStore } from '$entities/units';
import type { OwnVessel } from '$entities/vessel';
import type { WaypointsStore } from '$entities/waypoint';
import {
  createAisOverlay,
  createAisTrailsOverlay,
  createAisVectorsOverlay,
} from '$features/ais-layer';
import { createAnchorOverlay } from '$features/anchor-watch';
import { createCollisionOverlay } from '$features/lookout';
import type { PpiLayer } from '$features/marine-radar';
import { createMeasureOverlay } from '$features/measure';
import { createMobOverlay } from '$features/mob';
import type { NotesOverlay } from '$features/notes';
import { createCourseOverlay, createRouteOverlay } from '$features/route-layer';
import { createTidesOverlay, type TideStationSelectionEvent } from '$features/tides';
import {
  createTimeTravelOverlay,
  createTimeTravelTrackOverlay,
  type TimeTravelController,
} from '$features/time-travel';
import {
  createHistoryTrackOverlay,
  createTrackOverlay,
  type SavedTracksSource,
} from '$features/track-layer';
import { createVesselOverlay } from '$features/vessel-layer';
import { createWaypointOverlay } from '$features/waypoints';
import type { LatLon } from '$shared/geo';
import type { PersistedValue, TrackSettings } from '$shared/settings';
import type { HistoryProviders, SignalKStore } from '$shared/signalk';

export interface DynamicOverlaysDeps {
  // The server origin and a live read-token getter, shared by the AIS-trail and history-track
  // overlays. A getter, not a value: the map mounts before auth resolves on a secured server, so a
  // captured token would freeze at undefined and every fetch would stay unauthenticated.
  origin: string;
  getToken: () => string | undefined;
  store: SignalKStore;
  vessel: OwnVessel;
  aisTargets: AisTargets;
  onAisSelect?: (id: string) => void;
  selectedAisId?: () => string | undefined;
  anchor: AnchorWatch;
  mob: MobStore;
  measure: MeasureStore;
  collision: CollisionAssessment;
  guidance: CourseGuidance;
  recorder: TrackRecorder;
  routeStore: RouteStore;
  tides: TidesStore;
  onTideStationSelect?: (selection: TideStationSelectionEvent) => void;
  units: UnitsStore;
  waypoints: WaypointsStore;
  symbols?: SymbolsStore;
  trackSettings: PersistedValue<TrackSettings>;
  savedTracks?: SavedTracksSource;
  // The already-built notes overlay, woven into the stack at its band position.
  notesOverlay: NotesOverlay;
  onAnchorMoved?: (position: LatLon) => void;
  aisTrailsAvailable: () => boolean;
  historyProviders: () => HistoryProviders | undefined;
  timeTravel: TimeTravelController;
  // The marine radar echo layer, built by its controller (which owns the spokes worker) and woven in
  // at its traffic-band position. Absent until the controller is wired; the layer itself stays inert
  // until a radar provider is detected and streaming.
  marineRadarLayer?: PpiLayer;
}

// The store-driven overlay stack, in z order within each band (tides under the safety overlays, the
// own vessel on top). One list feeds both manager registration (OverlayModule) and the per-frame
// tick (Syncable), so the return type is left inferred as the concrete union that satisfies both,
// rather than widened to OverlayModule[], which would drop the sync method the tick requires.
export function buildDynamicOverlays(deps: DynamicOverlaysDeps) {
  const {
    origin,
    getToken,
    store,
    vessel,
    aisTargets,
    onAisSelect,
    selectedAisId,
    anchor,
    mob,
    measure,
    collision,
    guidance,
    recorder,
    routeStore,
    tides,
    onTideStationSelect,
    units,
    waypoints,
    symbols,
    trackSettings,
    savedTracks,
    notesOverlay,
    onAnchorMoved,
    aisTrailsAvailable,
    historyProviders,
    timeTravel,
    marineRadarLayer,
  } = deps;
  return [
    createTidesOverlay(tides, units, onTideStationSelect),
    createAnchorOverlay(anchor, vessel, onAnchorMoved),
    createMeasureOverlay(measure, units),
    createRouteOverlay(routeStore),
    createCourseOverlay(guidance, vessel),
    createWaypointOverlay(waypoints, symbols),
    notesOverlay,
    createAisTrailsOverlay(origin, getToken, aisTrailsAvailable, () => store.selfContext),
    createAisVectorsOverlay(aisTargets, () => collision.assessment),
    createAisOverlay(aisTargets, {
      onSelect: onAisSelect,
      selectedId: selectedAisId,
    }),
    createCollisionOverlay(collision),
    createMobOverlay(mob, vessel),
    createHistoryTrackOverlay(origin, getToken, historyProviders, () => timeTravel.active),
    createTrackOverlay(recorder, trackSettings, savedTracks),
    createTimeTravelTrackOverlay(timeTravel),
    createVesselOverlay(vessel, () => timeTravel.active),
    createTimeTravelOverlay(timeTravel),
    ...(marineRadarLayer ? [marineRadarLayer] : []),
  ];
}
