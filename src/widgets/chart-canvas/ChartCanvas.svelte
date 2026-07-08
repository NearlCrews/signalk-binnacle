<script lang="ts">
import type { Map as MapLibreMap } from 'maplibre-gl';
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
import { createNotesOverlay, type NotePoint, type NoteSelection } from '$features/notes';
import { buildOceanSources, createOceanOverlay } from '$features/ocean-conditions';
import type { RouteEditor } from '$features/route-edit';
import { createWorkingRouteOverlay, type WorkingRouteOverlay } from '$features/route-layer';
import { createSeamarkOverlay, SEAMARK_SOURCES } from '$features/seamark-overlay';
import type { TimeTravelStore } from '$features/time-travel';
import type { SavedTracksSource } from '$features/track-layer';
import { OWN_VESSEL_OVERLAY_ID } from '$features/vessel-layer';
import type { LatLon } from '$shared/geo';
import { lengthUnit } from '$shared/lib';
import {
  chartSourceId,
  createChartOverlay,
  createThemedMap,
  type LayerManager,
  type LayerSettings,
  type ThemedMapHandle,
} from '$shared/map';
import { detectCompanion, proxiedSources } from '$shared/map/companion';
import type { MapView, PersistedValue, TrackSettings } from '$shared/settings';
import type { HistoryProviders, SignalKStore } from '$shared/signalk';
import type { Theme } from '$shared/ui';
import { buildBathymetryOverlays } from './build-bathymetry-overlays';
import { buildMapCommands } from './build-commands';
import { buildDynamicOverlays } from './build-overlays';
import ChartContextMenu from './ChartContextMenu.svelte';
import type { MapCommands, UserChartRegistrar } from './commands';

interface Props {
  store: SignalKStore;
  // The Signal K server origin, resolved once by the host and passed down rather than re-read from
  // window.location here, so the widget stays testable without a real location.
  origin: string;
  vessel: OwnVessel;
  aisTargets: AisTargets;
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
  onViewChange?: (view: MapView) => void;
  onNoteSelect?: (selection: NoteSelection | undefined) => void;
  // The on-screen POI set, forwarded from the notes overlay to the POI search.
  onNotes?: (notes: NotePoint[]) => void;
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
  // The time-travel store, drawn as the scrub marker and read by the review-mode effect that dims
  // the live vessel and forces the history track on while scrubbing.
  timeTravel: TimeTravelStore;
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
  onViewChange,
  onNoteSelect,
  onNotes,
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
// The layer manager, captured from onLoad so the time-travel review effect can dim the live vessel
// and force the history track on while scrubbing. $state so the effect re-runs once it is assigned.
let manager = $state<LayerManager | undefined>();
// Captured from onLoad alongside manager, so the units effect below can reach
// map.setGlobalStateProperty once the map exists. $state so the effect re-runs once it is assigned.
let mapRef = $state<MapLibreMap | undefined>();
// The open "go to here" menu, anchored at the press point in chart pixels with the chart size
// captured for edge clamping, or undefined when closed.
let chartMenu = $state<
  { x: number; y: number; lat: number; lon: number; width: number; height: number } | undefined
>();

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

// The live vessel dims to this opacity during time-travel review so the scrub marker stands out.
const REVIEW_DIM_OPACITY = 0.35;

// Time-travel review mode: dim the live vessel and force the 24 h history track on while scrubbing.
// The prior state is captured as closure locals and restored in the teardown, which Svelte runs on
// exit, on a manager swap, and on unmount, so review can never leave the vessel dimmed or the track
// forced on. The active guard means the initial inactive run registers no teardown and touches
// nothing.
$effect(() => {
  const mgr = manager;
  if (!mgr || !timeTravel.active) return;
  const layers = mgr.layers();
  const priorTrackVisible = layers.find((l) => l.id === 'track-history')?.visible ?? false;
  const priorVesselOpacity = layers.find((l) => l.id === OWN_VESSEL_OVERLAY_ID)?.opacity ?? 1;
  mgr.toggle('track-history', true);
  mgr.setOpacity(OWN_VESSEL_OVERLAY_ID, REVIEW_DIM_OPACITY);
  return () => {
    mgr.toggle('track-history', priorTrackVisible);
    mgr.setOpacity(OWN_VESSEL_OVERLAY_ID, priorVesselOpacity);
  };
});

onMount(async () => {
  // Detect Chart Locker before the map is built: the basemap style URL is read
  // synchronously at map construction, so detection must precede it. The same result routes the
  // raster overlays in onLoad below, so it is detected once here.
  const companionBase = await detectCompanion(origin);
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
      // While the measure tool is armed, plain taps append measurement points. Route editing wins
      // when both are somehow active, since Terra Draw owns the chart taps then.
      map.on('click', (e) => {
        if (!measure.active || routeStore.working) return;
        measure.add({ latitude: e.lngLat.lat, longitude: e.lngLat.lng });
      });
      // While a working route is up, a tap on a waypoint dot lights it and the legs it joins; a tap
      // on empty water clears the highlight. Terra Draw still owns the tap for selecting and dragging
      // the vertex underneath, so this only drives the cross-highlight. A generous box makes a small
      // dot tappable with a glove.
      map.on('click', (e) => {
        if (!routeStore.working) return;
        const index = workingRouteOverlay?.hitTestWaypoint(e.point);
        if (index !== undefined) routeStore.setHighlight({ kind: 'waypoint', index });
        else routeStore.clearHighlight();
      });
      // A URL chart this device synced to the server comes back from the charts API with the same id
      // as its local user-chart descriptor. Drop those server entries so the chart registers once,
      // from the local descriptor (the manageable version); other devices, with no local descriptor,
      // still see it as a server chart.
      const localChartIds = new Set((userCharts?.sources ?? []).map((source) => source.id));
      // undefined is a transient failure; there are no server charts registered yet to keep, so this
      // session shows none (a reachable-empty server is the same []). Charts are registered once at
      // load, so a reconnect does not currently re-fetch them.
      const charts = ((await fetchCharts(origin, chartsToken)) ?? []).filter(
        (chart) => !localChartIds.has(chart.identifier),
      );
      if (isDestroyed()) return;

      // Build every overlay, then register the whole stack in one batch so the layer order is
      // applied once instead of restacking after each. The inter-band order comes from Z_ORDER (own
      // vessel and collision pinned on top, then the navigator's routes and track, then AIS and the
      // safety overlays, the ocean fields, and the charts at the base); the order below sets only the
      // order within a band.
      const notesOverlay = createNotesOverlay(origin, () => chartsToken, onNoteSelect, symbols, {
        isOnline: isOnline ?? (() => true),
        onNotes,
      });
      // One list feeds both registration and the per-frame tick, so the two cannot drift. The order
      // sets z within each band (tides under the safety overlays, the own vessel on top).
      const dynamicOverlays = buildDynamicOverlays({
        origin,
        getToken: () => chartsToken,
        store,
        vessel,
        aisTargets,
        anchor,
        mob,
        measure,
        collision,
        guidance,
        recorder,
        routeStore,
        tides,
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
      // Route the remote raster overlays through the Chart Locker tile proxy when it is installed,
      // so the boat shares one cache and works offline. When it is absent, the sources keep their direct
      // upstream URLs (a standalone install is unchanged). The NASA GIBS ocean fields stay direct: they
      // are date-dynamic and not yet in the companion allowlist.
      // The bathymetry band (Seascape's DEM pair, the existing STREAMING_CHART_SOURCES rasters, and
      // Seascape's vector pair, in that registration order) is built by buildBathymetryOverlays; see
      // its own comment for why that relative order is load-bearing.
      await mgr.registerAll([
        ...charts.map((chart) => createChartOverlay(chart, origin, 'basemap', () => chartsToken)),
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
        ...dynamicOverlays,
      ]);
      // Capture the manager so the time-travel review effect can dim the vessel and toggle history.
      manager = mgr;
      mapRef = map;
      if (isDestroyed()) return;

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
            onRouteEditorError?.();
            return undefined;
          });
        return editorLoading;
      };

      const view = new LayersView(mgr);
      view.refresh();
      onReady?.(view);

      const userChartRegistrar: UserChartRegistrar = {
        register: async (chart) => {
          if (isDestroyed()) return;
          await mgr.register(createChartOverlay(chart, origin, 'bathymetry', () => chartsToken));
          view.refresh();
        },
        unregister: (identifier) => {
          mgr.unregister(chartSourceId(identifier));
          view.refresh();
        },
      };
      onUserChartsReady?.(userChartRegistrar);

      onMapReady?.(recolor);

      onCommandsReady?.(
        buildMapCommands({
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
        }),
      );
      onMapInstance?.(map);

      // The working-route overlay rides the same tick but is not registered with the manager (it is
      // not a user-toggleable layer); its editVersion dirty-check gates its work. The initial theme
      // colors it up front so it does not flash the day palette before the theme effect runs.
      workingRouteOverlay = createWorkingRouteOverlay(routeStore, theme);
      workingRouteOverlay.add(ctx);
      runTick([...dynamicOverlays, workingRouteOverlay]);
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
</style>
