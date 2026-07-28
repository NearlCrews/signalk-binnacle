<script lang="ts">
import type { Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl';
import { onDestroy, onMount } from 'svelte';
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
import type { UserCharts } from '$entities/user-charts';
import type { OwnVessel } from '$entities/vessel';
import type { WaypointsStore } from '$entities/waypoint';
import { BOUNDARY_SOURCES, createBoundaryOverlay } from '$features/boundaries-overlay';
import { fetchCharts } from '$features/charts';
import { LayersView } from '$features/layers-panel';
import { COLLISION_OVERLAY_ID } from '$features/lookout';
import type { PpiLayer } from '$features/marine-radar';
import { MOB_OVERLAY_ID } from '$features/mob';
import { createMpaOverlay, MPA_SOURCES } from '$features/mpa-overlays';
import {
  createNotesOverlay,
  type NotePoint,
  type NoteSelection,
  type PoiViewState,
} from '$features/notes';
import { buildOceanSources, createOceanOverlay } from '$features/ocean-conditions';
import type { RouteEditor } from '$features/route-edit';
import { createWorkingRouteOverlay, type WorkingRouteOverlay } from '$features/route-layer';
import { createSeamarkOverlay, SEAMARK_SOURCES } from '$features/seamark-overlay';
import type { TideStationSelectionEvent } from '$features/tides';
import type { TimeTravelController } from '$features/time-travel';
import type { SavedTracksSource } from '$features/track-layer';
import { OWN_VESSEL_OVERLAY_ID } from '$features/vessel-layer';
import type { LatLon } from '$shared/geo';
import { lengthUnit } from '$shared/lib';
import {
  chartSourceId,
  createChartOverlay,
  createThemedMap,
  detectCompanion,
  type LayerSettings,
  proxiedSources,
  type ThemedMapHandle,
} from '$shared/map';
import { binnacleStorageKey } from '$shared/persistence';
import type { MapView, PersistedValue, TrackSettings } from '$shared/settings';
import type { HistoryProviders, SignalKStore } from '$shared/signalk';
import type { Theme } from '$shared/ui';
import { buildBathymetryOverlays } from './build-bathymetry-overlays';
import { buildMapCommands } from './build-commands';
import { buildDynamicOverlays } from './build-overlays';
import ChartContextMenu from './ChartContextMenu.svelte';
import type { MapCommands, UserChartRegistrar } from './commands';
import VesselOffScreenIndicator from './VesselOffScreenIndicator.svelte';

interface Props {
  store: SignalKStore;
  // The Signal K server origin, resolved once by the host and passed down rather than re-read from
  // window.location here, so the widget stays testable without a real location.
  origin: string;
  vessel: OwnVessel;
  aisTargets: AisTargets;
  selectedAisId?: string;
  onAisSelect?: (id: string) => void;
  // The anchor watch, drawn as the swing circle, rode line, and draggable drop-point marker.
  anchor: AnchorWatch;
  // The man-overboard mark, pinned with the collision ring so nothing can hide it.
  mob: MobStore;
  // The measure tool; while armed, chart taps append measurement points.
  measure: MeasureStore;
  collision: CollisionAssessment;
  // Active-navigation guidance, drawn as the vessel-to-destination course line and destination
  // marker so a single-point "go to here" and an active route's current leg show on the chart.
  guidance: CourseGuidance;
  recorder: TrackRecorder;
  // The route store, drawn by the route overlay and edited on the chart via Terra Draw.
  routeStore: RouteStore;
  // The tides store, drawn as nearest-station markers and fed by the tides loader in App.
  tides: TidesStore;
  // The display-unit preference, threaded into the overlays that label distances and heights.
  units: UnitsStore;
  // Standard server waypoints, drawn as named markers in the routes band.
  waypoints: WaypointsStore;
  // Provided chart symbols (signalk-symbol-manager), empty on a stock server.
  symbols?: SymbolsStore;
  // The active theme, so the on-chart route editor restyles its draw layers per theme.
  theme: Theme;
  trackSettings: PersistedValue<TrackSettings>;
  // Saved tracks to draw, pulled each frame so show/hide and edits reflect without a remount.
  savedTracks?: SavedTracksSource;
  // The user's imported charts, so a server chart that is also a local user chart (a URL chart this
  // device synced to the server) is registered once, from the local descriptor, not twice.
  userCharts?: UserCharts;
  chartsToken?: string;
  // The view to open at, restored from the last visit; defaults to a world view.
  initialView?: MapView;
  // Saved per-layer visibility and opacity, and a sink for changes to persist.
  savedLayers?: LayerSettings;
  onLayersChange?: (settings: LayerSettings) => void;
  // Saved bottom-to-top order of non-pinned layers, and a sink for reorder changes.
  savedOrder?: string[];
  onOrderChange?: (order: string[]) => void;
  onReady?: (view: LayersView) => void;
  onMapReady?: (recolor: (theme: Theme) => void) => void;
  onCommandsReady?: (commands: MapCommands) => void;
  onUserChartsReady?: (registrar: UserChartRegistrar) => void;
  onServerChartsReady?: (retry: () => void) => void;
  onServerChartsStatus?: (status: 'loading' | 'ready' | 'partial' | 'error') => void;
  // Critical navigation overlays failed to mount. The host surfaces this instead of leaving a
  // navigator with an apparently healthy chart that is missing the vessel or a safety mark.
  onCriticalOverlayError?: (overlayIds: string[]) => void;
  onViewChange?: (view: MapView) => void;
  onNoteSelect?: (selection: NoteSelection | undefined) => void;
  onTideStationSelect?: (selection: TideStationSelectionEvent) => void;
  // The on-screen POI set, forwarded from the notes overlay to the POI search.
  onNotes?: (notes: NotePoint[]) => void;
  onPoiStatus?: (state: PoiViewState) => void;
  // Fired when the user pans the map by hand (a drag), so a follow lock can release.
  onUserPan?: () => void;
  // Set a single "go to here" destination at a chart point the user long-pressed or right-clicked.
  onGoToHere?: (position: LatLon) => void;
  // Open the routes panel and start a new route in drawing mode, from the chart context menu.
  onStartRoute?: (position: LatLon) => void;
  // Drop a standard waypoint at a long-pressed chart position; a refused save surfaces in the
  // Waypoints panel (write access is unknowable client-side).
  onDropWaypoint?: (position: LatLon) => void;
  // Arm the measure tool seeded with the long-pressed chart position as its first point.
  onMeasureFrom?: (position: LatLon) => void;
  // The lazily-imported route editor chunk failed to load, so the app can surface it.
  onRouteEditorError?: () => void;
  // Whether the server runs the tracks plugin, read per tick so trails light up when known.
  aisTrailsAvailable?: () => boolean;
  // Connectivity, so the notes overlay can serve expired cached POIs while offline instead of
  // blanking them at TTL expiry.
  isOnline?: () => boolean;
  // The known history providers, for the 24 h track history overlay; undefined gates its fetches.
  historyProviders?: () => HistoryProviders | undefined;
  // The time-travel controller drives its own synchronized track and marker. Dynamic overlays read
  // its active state to dim the live vessel and hide the separate 24-hour history layer transiently.
  timeTravel: TimeTravelController;
  // Commit a drag-to-adjust of the anchor marker (the app PUTs it server-side or moves it locally).
  onAnchorMoved?: (position: LatLon) => void;
  // The marine radar echo layer, built by its controller in the host and woven into the overlay stack.
  marineRadarLayer?: PpiLayer;
  // The raw MapLibre map instance, handed up once after load for features that need direct map access
  // (for example, a Terra Draw tool that is not part of the route editor).
  onMapInstance?: (map: MapLibreMap) => void;
  // Fired when the map handle is destroyed, so the host can clear any reference it holds (for
  // example, clearing mapInstance so the regions panel never mounts Terra Draw against a stale map).
  onMapDestroyed?: () => void;
}

const {
  store,
  origin,
  vessel,
  aisTargets,
  selectedAisId,
  onAisSelect,
  anchor,
  mob,
  measure,
  units,
  waypoints,
  symbols,
  collision,
  guidance,
  recorder,
  routeStore,
  tides,
  theme,
  trackSettings,
  savedTracks,
  userCharts,
  chartsToken,
  initialView,
  savedLayers,
  onLayersChange,
  savedOrder,
  onOrderChange,
  onReady,
  onMapReady,
  onCommandsReady,
  onUserChartsReady,
  onServerChartsReady,
  onServerChartsStatus,
  onCriticalOverlayError,
  onViewChange,
  onNoteSelect,
  onTideStationSelect,
  onNotes,
  onPoiStatus,
  onUserPan,
  onGoToHere,
  onStartRoute,
  onDropWaypoint,
  onMeasureFrom,
  onRouteEditorError,
  aisTrailsAvailable,
  isOnline,
  historyProviders,
  timeTravel,
  onAnchorMoved,
  marineRadarLayer,
  onMapInstance,
  onMapDestroyed,
}: Props = $props();

let container: HTMLDivElement;
let mapHandle: ThemedMapHandle | undefined;
// onMount now awaits companion detection before building the map; this guards against the component
// unmounting during that await, which would otherwise build a map onDestroy never tears down.
let destroyed = false;
let routeEditor: RouteEditor | undefined;
// The unmanaged overlay that draws the working route's dots, labels, and cross-highlight. Like the
// editor, ChartCanvas owns its lifecycle (add, tick, recolor, raise) rather than the layer manager.
let workingRouteOverlay: WorkingRouteOverlay | undefined;
// Bumped on every start and stop so a route edit canceled before the lazily-loaded editor resolves
// does not start on a route that is no longer current.
let editGeneration = 0;
// Captured from onLoad so the units effect below can reach
// map.setGlobalStateProperty once the map exists. $state so the effect re-runs once it is assigned.
let mapRef = $state<MapLibreMap | undefined>();
// Captured from onLoad alongside mapRef, so the off-screen vessel indicator can reuse the exact
// same centerOnVessel behavior as the menu's Center action, rather than duplicating its fly-to math.
let commandsRef = $state<MapCommands | undefined>();
// The open "go to here" menu, anchored at the press point in chart pixels with the chart size
// captured for edge clamping, or undefined when closed.
let chartMenu = $state<
  { x: number; y: number; lat: number; lon: number; width: number; height: number } | undefined
>();
const CONTEXT_HINT_KEY = binnacleStorageKey('chartActionsHint');
let showContextHint = $state(false);

function dismissContextHint(): void {
  showContextHint = false;
  try {
    localStorage.setItem(CONTEXT_HINT_KEY, 'seen');
  } catch {
    // The hint remains session-only when local storage is unavailable.
  }
}

// Restyle the on-chart route editor and the working-route overlay whenever the theme changes (the
// saved-route overlay recolors through the layer manager; these two unmanaged pieces are restyled
// here). theme is a prop, so this effect tracks it in component scope.
$effect(() => {
  routeEditor?.setTheme(theme);
  workingRouteOverlay?.setTheme(theme);
});

// Seascape's contour and sounding labels switch between metric and imperial via MapLibre's
// global-state rather than rebuilding filters or paint, so this only needs to push the current
// mode whenever it changes; units is a prop backed by reactive state, so this effect tracks it.
// setGlobalStateProperty is the Map-level API (setGlobalState is an internal Style method, not
// exposed on Map in maplibre-gl 5.24).
$effect(() => {
  const map = mapRef;
  if (!map) return;
  map.setGlobalStateProperty('unit', lengthUnit(units.mode));
});

// A crosshair makes the chart's temporary tap mode visible before the first point exists. Restore
// MapLibre's prior cursor on exit, and let route editing keep ownership when the two states overlap.
$effect(() => {
  const map = mapRef;
  if (!map || !measure.active || routeStore.working) return;
  const canvas = map.getCanvas();
  const prior = canvas.style.cursor;
  canvas.style.cursor = 'crosshair';
  return () => {
    if (canvas.style.cursor === 'crosshair') canvas.style.cursor = prior;
  };
});

onMount(async () => {
  try {
    showContextHint =
      window.matchMedia('(pointer: coarse)').matches &&
      localStorage.getItem(CONTEXT_HINT_KEY) !== 'seen';
  } catch {
    showContextHint = window.matchMedia('(pointer: coarse)').matches;
  }
  // Detect Chart Locker before the map is built: the basemap style URL is read
  // synchronously at map construction, so detection must precede it. The same result routes the
  // raster overlays in onLoad below, so it is detected once here.
  const companionBase = await detectCompanion(origin, chartsToken);
  if (destroyed) return; // unmounted during the probe; do not build a map nothing will tear down
  // createThemedMap defaults to the world view ([0, 30], zoom 2) when no saved view is passed.
  mapHandle = createThemedMap({
    container,
    companionBase,
    getToken: () => chartsToken,
    view: initialView,
    managerOptions: {
      saved: savedLayers,
      onChange: onLayersChange,
      savedOrder,
      onOrderChange,
      // The own vessel, an active MOB mark, and active collision alarms stay pinned on top so a
      // chart or traffic can never hide them; bottom to top, collision, then the MOB mark, then
      // the vessel itself.
      pinned: [COLLISION_OVERLAY_ID, MOB_OVERLAY_ID, OWN_VESSEL_OVERLAY_ID],
    },
    onView: (view) => onViewChange?.(view),
    onUserPan: () => onUserPan?.(),
    onContextMenu: (point) => {
      // No context menu at all while drawing or editing a route, or while the measure tool is armed
      // (this suppresses every item, not just "Go to here"): Terra Draw and the measure tool own the
      // chart taps then.
      if (!onGoToHere || routeStore.working || measure.active) return;
      dismissContextHint();
      chartMenu = {
        x: point.x,
        y: point.y,
        lat: point.lat,
        lon: point.lng,
        width: container.clientWidth,
        height: container.clientHeight,
      };
    },
    onLoad: async ({ map, ctx, manager: mgr, recolor, isDestroyed, runTick }) => {
      // Seed the unit global-state before registerAll below adds Seascape's vector layers, so their
      // global-state-driven filters and text-fields never evaluate against an unset value; the
      // units effect (mapRef-gated, further down) keeps it live after this initial seed.
      map.setGlobalStateProperty('unit', lengthUnit(units.mode));
      // A pan or zoom moves the chart out from under the menu's pixel anchor, so dismiss it on move.
      map.on('movestart', () => {
        chartMenu = undefined;
      });
      // A single click handler dispatches to measure and route highlight based on active state.
      // Both guards are independent so they can coexist without interference.
      map.on('click', (e: MapMouseEvent) => {
        // While the measure tool is armed, plain taps append measurement points. Route editing wins
        // when both are somehow active, since Terra Draw owns the chart taps then.
        if (measure.active && !routeStore.working) {
          measure.add({ latitude: e.lngLat.lat, longitude: e.lngLat.lng });
          return;
        }
        // While a working route is up, a tap on a waypoint dot lights it and the legs it joins; a
        // tap on empty water clears the highlight. Terra Draw still owns the tap for selecting and
        // dragging the vertex underneath, so this only drives the cross-highlight. A generous box
        // makes a small dot tappable with a glove.
        if (routeStore.working) {
          const index = workingRouteOverlay?.hitTestWaypoint(e.point);
          if (index !== undefined) routeStore.setHighlight({ kind: 'waypoint', index });
          else routeStore.clearHighlight();
        }
      });
      // Build every overlay, then register the whole stack in one batch so the layer order is
      // applied once instead of restacking after each. The inter-band order comes from Z_ORDER (own
      // vessel and collision pinned on top, then the navigator's routes and track, then AIS and the
      // safety overlays, the ocean fields, and the charts at the base); the order below sets only the
      // order within a band.
      const notesOverlay = createNotesOverlay(origin, () => chartsToken, onNoteSelect, symbols, {
        isOnline: isOnline ?? (() => true),
        onNotes,
        onStatus: onPoiStatus,
      });
      // One list feeds both registration and the per-frame tick, so the two cannot drift. The order
      // sets z within each band (tides under the safety overlays, the own vessel on top).
      const dynamicOverlays = buildDynamicOverlays({
        origin,
        getToken: () => chartsToken,
        store,
        vessel,
        aisTargets,
        selectedAisId: () => selectedAisId,
        onAisSelect: (id) => {
          if (!measure.active && !routeStore.working) onAisSelect?.(id);
        },
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
        aisTrailsAvailable: aisTrailsAvailable ?? (() => false),
        historyProviders: historyProviders ?? (() => undefined),
        timeTravel,
        marineRadarLayer,
      });
      const criticalOverlayIds: readonly string[] = [
        OWN_VESSEL_OVERLAY_ID,
        COLLISION_OVERLAY_ID,
        MOB_OVERLAY_ID,
        'anchor-watch',
        'course',
        'routes',
      ];
      const criticalOverlays = dynamicOverlays.filter((overlay) =>
        criticalOverlayIds.includes(overlay.id),
      );
      let criticalFailureIds: string[] = [];
      const reportCriticalFailures = (): void => {
        onCriticalOverlayError?.([...criticalFailureIds]);
      };
      const onOverlaySyncStatus = (id: string | undefined, error: unknown | undefined): void => {
        if (!id || !criticalOverlayIds.includes(id)) return;
        if (error === undefined)
          criticalFailureIds = criticalFailureIds.filter((value) => value !== id);
        else if (!criticalFailureIds.includes(id)) criticalFailureIds.push(id);
        reportCriticalFailures();
      };
      const supportingOverlays = dynamicOverlays.filter(
        (overlay) => !criticalOverlayIds.includes(overlay.id),
      );
      const criticalResults = await mgr.registerBatch(criticalOverlays);
      if (isDestroyed()) return;
      const criticalFailures = criticalResults.filter((result) => result.status === 'failed');
      for (const failure of criticalFailures) {
        if (!criticalFailureIds.includes(failure.id)) criticalFailureIds.push(failure.id);
      }
      for (const result of criticalResults) {
        if (result.status === 'failed') {
          console.warn(`Could not register overlay "${result.id}".`, result.error);
        }
      }
      reportCriticalFailures();
      if (isDestroyed()) return;
      // Start live vessel, course, collision, MOB, anchor, and route synchronization immediately.
      // Optional overlays and remote providers can take longer to register and must not hold it up.
      const registeredDynamicIds = criticalResults
        .filter((result) => result.status === 'registered')
        .map((result) => result.id);
      runTick(
        criticalOverlays.filter((overlay) => registeredDynamicIds.includes(overlay.id)),
        onOverlaySyncStatus,
      );
      if (isDestroyed()) return;

      const supportingResults = await mgr.registerBatch(supportingOverlays);
      if (isDestroyed()) return;
      for (const result of supportingResults) {
        if (result.status === 'registered') registeredDynamicIds.push(result.id);
        else console.warn(`Could not register overlay "${result.id}".`, result.error);
      }
      // Expand the live set before any optional remote provider registration begins.
      runTick(
        dynamicOverlays.filter((overlay) => registeredDynamicIds.includes(overlay.id)),
        onOverlaySyncStatus,
      );
      if (isDestroyed()) return;

      // Route the remote raster overlays through the Chart Locker tile proxy when it is installed,
      // so the boat shares one cache and works offline. When it is absent, the sources keep their direct
      // upstream URLs (a standalone install is unchanged). The NASA GIBS ocean fields stay direct: they
      // are date-dynamic and not yet in the companion allowlist.
      // The bathymetry band (Seascape's DEM pair, the existing STREAMING_CHART_SOURCES rasters, and
      // Seascape's vector pair, in that registration order) is built by buildBathymetryOverlays; see
      // its own comment for why that relative order is load-bearing.
      // eslint-disable-next-line svelte/prefer-svelte-reactivity -- local async accumulator
      const serverChartIds = new Set<string>();
      const providerResults = await mgr.registerBatch([
        ...buildBathymetryOverlays({ companionBase }),
        ...buildOceanSources().map((source) => createOceanOverlay(source)),
        // Within the safety band, registration order is z, so the seamark navigation aids draw over
        // the reference area fills and boundary lines beneath them.
        ...proxiedSources(BOUNDARY_SOURCES, companionBase).map((source) =>
          createBoundaryOverlay(source),
        ),
        ...proxiedSources(MPA_SOURCES, companionBase).map((source) => createMpaOverlay(source)),
        ...proxiedSources(SEAMARK_SOURCES, companionBase).map((source) =>
          createSeamarkOverlay(source),
        ),
      ]);
      if (isDestroyed()) return;
      for (const result of providerResults) {
        if (result.status === 'failed') {
          console.warn(`Could not register overlay "${result.id}".`, result.error);
        }
      }
      if (isDestroyed()) return;
      mapRef = map;

      // The Terra Draw route editor draws into its own layers anchored in the routes band. It writes
      // edits back into the working route, which the panel reads for its live distance and count.
      // Loaded on first use, not at startup: Terra Draw and its adapter are a few hundred kB that
      // route editing alone needs, so deferring them cuts cold-load parse on Pi-class clients.
      const editorBeforeId = ctx.beforeIdFor('routes');
      let editorLoading: Promise<RouteEditor | undefined> | undefined;
      const loadRouteEditor = (): Promise<RouteEditor | undefined> => {
        editorLoading ??= import('$features/route-edit')
          .then(({ createRouteEditor }) => {
            if (isDestroyed()) return undefined;
            routeEditor = createRouteEditor({
              map,
              beforeId: editorBeforeId,
              theme,
              onChange: (waypoints) => {
                const working = routeStore.working;
                if (working) routeStore.setWorking({ ...working, waypoints });
              },
            });
            return routeEditor;
          })
          .catch((error) => {
            // A chunk-load failure (offline, a cache miss over a flaky link) must not leave a
            // permanently rejected memoized promise that kills route editing for the session;
            // clear it so a later attempt re-imports, and surface the failure.
            console.error('Route editor failed to load', error);
            editorLoading = undefined;
            if (!isDestroyed()) onRouteEditorError?.();
            return undefined;
          });
        return editorLoading;
      };

      const view = new LayersView(mgr);
      view.refresh();
      onReady?.(view);
      if (isDestroyed()) return;

      let serverChartsGeneration = 0;
      let serverChartsQueue = Promise.resolve();

      async function loadServerCharts(generation: number): Promise<void> {
        const next = await fetchCharts(origin, chartsToken);
        if (isDestroyed() || generation !== serverChartsGeneration) return;
        if (next === undefined) {
          onServerChartsStatus?.('error');
          return;
        }
        // A URL chart synced by this device can also be returned by the server. Keep the local,
        // manageable descriptor and omit its duplicate server entry.
        const localIds = new Set((userCharts?.sources ?? []).map((source) => source.id));
        const wanted = next.filter((chart) => !localIds.has(chart.identifier));
        for (const id of serverChartIds) mgr.unregister(chartSourceId(id));
        serverChartIds.clear();
        const results = await mgr.registerBatch(
          wanted.map((chart) => createChartOverlay(chart, origin, 'basemap', () => chartsToken)),
        );
        if (isDestroyed()) return;
        if (generation !== serverChartsGeneration) {
          // A newer refresh can be queued while this async batch installs. These ids were never
          // admitted to serverChartIds, so remove the completed batch directly before yielding to
          // the newer generation or it would leave stale overlays and duplicate registrations.
          for (const result of results) {
            if (result.status === 'registered') mgr.unregister(result.id);
          }
          view.refresh();
          return;
        }
        for (const result of results) {
          const chart = wanted.find(
            (candidate) => chartSourceId(candidate.identifier) === result.id,
          );
          if (result.status === 'registered' && chart) serverChartIds.add(chart.identifier);
          if (result.status === 'failed') {
            console.warn(
              `Could not register server chart "${chart?.identifier ?? result.id}".`,
              result.error,
            );
          }
        }
        view.refresh();
        onServerChartsStatus?.(
          results.some((result) => result.status === 'failed') ? 'partial' : 'ready',
        );
      }

      function retryServerCharts(): Promise<void> {
        if (isDestroyed()) return Promise.resolve();
        const generation = ++serverChartsGeneration;
        onServerChartsStatus?.('loading');
        if (isDestroyed()) return Promise.resolve();
        serverChartsQueue = serverChartsQueue
          .catch(() => undefined)
          .then(() => loadServerCharts(generation))
          .catch((error) => {
            if (!isDestroyed() && generation === serverChartsGeneration) {
              console.warn('Could not refresh server charts.', error);
              onServerChartsStatus?.('error');
            }
          });
        return serverChartsQueue;
      }

      onServerChartsReady?.(() => void retryServerCharts());
      if (isDestroyed()) return;
      // Safety and vessel overlays are already live before optional chart discovery starts. A slow
      // or unavailable charts endpoint therefore cannot postpone navigation rendering or map tools.
      void retryServerCharts();

      const userChartRegistrar: UserChartRegistrar = {
        register: async (chart) => {
          if (isDestroyed()) return;
          try {
            await mgr.register(
              createChartOverlay(chart, origin, 'bathymetry', () => chartsToken, {
                source: 'user',
              }),
            );
          } catch (error) {
            if (isDestroyed()) return;
            throw error;
          }
          if (isDestroyed()) return;
          view.refresh();
        },
        replace: async (chart) => {
          if (isDestroyed()) return;
          try {
            await mgr.replace(
              createChartOverlay(chart, origin, 'bathymetry', () => chartsToken, {
                source: 'user',
              }),
            );
          } catch (error) {
            if (isDestroyed()) return;
            throw error;
          }
          if (isDestroyed()) return;
          view.refresh();
        },
        unregister: (identifier) => {
          if (isDestroyed()) return;
          mgr.unregister(chartSourceId(identifier));
          view.refresh();
        },
      };
      onUserChartsReady?.(userChartRegistrar);
      if (isDestroyed()) return;

      onMapReady?.(recolor);
      if (isDestroyed()) return;

      const commands = buildMapCommands({
        map,
        ctx,
        view,
        manager: mgr,
        vessel,
        routeStore,
        notesOverlay,
        loadRouteEditor,
        getWorkingRouteOverlay: () => workingRouteOverlay,
        getRouteEditor: () => routeEditor,
        nextEditGeneration: () => ++editGeneration,
        cancelEditGeneration: () => {
          editGeneration += 1;
        },
        currentEditGeneration: () => editGeneration,
      });
      commandsRef = commands;
      onCommandsReady?.(commands);
      if (isDestroyed()) return;
      onMapInstance?.(map);
      if (isDestroyed()) return;

      // The working-route overlay rides the same tick but is not registered with the manager (it is
      // not a user-toggleable layer); its editVersion dirty-check gates its work. The initial theme
      // colors it up front so it does not flash the day palette before the theme effect runs.
      workingRouteOverlay = createWorkingRouteOverlay(routeStore, theme);
      workingRouteOverlay.add(ctx);
      runTick(
        [
          ...dynamicOverlays.filter((overlay) => registeredDynamicIds.includes(overlay.id)),
          workingRouteOverlay,
        ],
        onOverlaySyncStatus,
      );
    },
  });
});

onDestroy(() => {
  // Stop the route editor before the map is removed so Terra Draw deregisters its adapter and
  // layers in the right order (start -> stop, before map.remove()); the guard makes it a no-op when
  // editing never started. Then tear the map down.
  destroyed = true;
  routeEditor?.stop();
  mapHandle?.destroy();
  onMapDestroyed?.();
});
</script>

<div class="chart-canvas" bind:this={container}>
  {#if showContextHint}
    <div class="context-hint popover-card" role="status">
      <span>Press and hold the chart for actions.</span>
      <button type="button" class="btn btn-ghost" onclick={dismissContextHint}>Got it</button>
    </div>
  {/if}
  {#if mapRef}
    <VesselOffScreenIndicator
      map={mapRef}
      position={vessel.position}
      onCenter={() => commandsRef?.centerOnVessel()}
    />
  {/if}
  {#if chartMenu}
    {@const menu = chartMenu}
    <ChartContextMenu
      x={menu.x}
      y={menu.y}
      width={menu.width}
      height={menu.height}
      onGoToHere={() => {
        onGoToHere?.({ latitude: menu.lat, longitude: menu.lon });
        chartMenu = undefined;
      }}
      onStartRoute={() => {
        onStartRoute?.({ latitude: menu.lat, longitude: menu.lon });
        chartMenu = undefined;
      }}
      onDropWaypoint={onDropWaypoint
        ? () => {
            onDropWaypoint({ latitude: menu.lat, longitude: menu.lon });
            chartMenu = undefined;
          }
        : undefined}
      onMeasureFrom={onMeasureFrom
        ? () => {
            onMeasureFrom({ latitude: menu.lat, longitude: menu.lon });
            chartMenu = undefined;
          }
        : undefined}
      onClose={() => {
        chartMenu = undefined;
      }}
    />
  {/if}
</div>

<style>
.chart-canvas {
  position: relative;
  inline-size: 100%;
  block-size: 100%;
}

.context-hint {
  position: absolute;
  inset-block-start: var(--space-2);
  inset-inline-start: 50%;
  z-index: var(--z-menu);
  display: flex;
  align-items: center;
  gap: var(--space-2);
  inline-size: max-content;
  max-inline-size: calc(100% - 2 * var(--space-4));
  padding: var(--space-1) var(--space-2);
  transform: translateX(-50%);
  font-size: var(--text-sm);
}
</style>
