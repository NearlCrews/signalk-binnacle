<script lang="ts">
import type { Map as MapLibreMap } from 'maplibre-gl';
import type { AisTargets } from '$entities/ais';
import type { AnchorWatch } from '$entities/anchor';
import type { CollisionAssessment } from '$entities/collision';
import type { CourseGuidance } from '$entities/course';
import type { MeasureStore } from '$entities/measure';
import type { MobStore } from '$entities/mob';
import type { ActiveNotification, NotificationsStore } from '$entities/notifications';
import type { NotePoint, PoiViewState } from '$entities/poi';
import type { RouteStore } from '$entities/route';
import type { SymbolsStore } from '$entities/symbols';
import type { TidesStore } from '$entities/tides';
import type { TrackRecorder } from '$entities/track';
import type { UnitsStore } from '$entities/units';
import type { UserCharts } from '$entities/user-charts';
import type { OwnVessel } from '$entities/vessel';
import type { WaypointsStore } from '$entities/waypoint';
import type { WeatherStore } from '$entities/weather';
import { loadAisListPanel } from '$features/ais-list';
import { AnchorPanel, AnchorStrip } from '$features/anchor-watch';
import { AuthBanner } from '$features/auth-banner';
import { loadChartsManagementPanel } from '$features/charts-management';
import { LayersPanel, type LayersView } from '$features/layers-panel';
import type { ShallowMonitorSnapshot } from '$features/lookout';
import { AlarmStrip, AlarmsPanel, DangerStrip } from '$features/lookout';
import { loadRadarControls } from '$features/marine-radar';
import { loadMeasureStrip } from '$features/measure';
import { MobStrip } from '$features/mob';
import { NavStrip, type RouteProgress } from '$features/navigation';
import { type NoteDetailLoader, NoteDetailPanel, type NoteSelection } from '$features/notes';
import { type Poi, PoiSearchPanel } from '$features/poi-search';
import { loadRegionsPanel } from '$features/prewarm';
import { RoutesPanel } from '$features/routing';
import {
  loadTidesPanel,
  type TideStationSelectionEvent,
  type TidesController,
} from '$features/tides';
import { loadHistoryStrip, type TimeTravelController } from '$features/time-travel';
import { TracksPanel } from '$features/tracks';
import { loadTrendsPanel } from '$features/trends';
import { WaypointsPanel } from '$features/waypoints';
import type { WeatherProvider } from '$features/weather';
import type { Bbox4, LatLon } from '$shared/geo';
import type { LayerSettings } from '$shared/map';
import { etaSeconds } from '$shared/nav';
import type { OnlineStatus } from '$shared/pwa';
import type {
  AuthController,
  HistoryProviders,
  ServerFeatures,
  SignalKStore,
} from '$shared/signalk';
import { isInsecureTransportOrigin } from '$shared/signalk';
import {
  type PanelId,
  registerDismiss,
  SlideOver,
  type Theme,
  type ThemeController,
} from '$shared/ui';
import { ChartCanvas, type MapCommands, type UserChartRegistrar } from '$widgets/chart-canvas';
import { loadWeatherMap } from '$widgets/weather-map';

type AnchorController = ReturnType<typeof import('$features/anchor-watch').createAnchorController>;
type MobController = ReturnType<typeof import('$features/mob').createMobController>;
type RouteController = ReturnType<typeof import('$features/routing').createRouteController>;
type WaypointsController = ReturnType<
  typeof import('$features/waypoints').createWaypointsController
>;
type TrackController = ReturnType<typeof import('$features/tracks').createTrackController>;
type RadarController = ReturnType<
  typeof import('$features/marine-radar').createMarineRadarController
>;

interface FlatProps {
  // Core services
  origin: string;
  store: SignalKStore;
  vessel: OwnVessel;
  aisTargets: AisTargets;
  units: UnitsStore;
  auth: AuthController;
  net: OnlineStatus;
  theme: ThemeController;

  // Controllers
  anchorController: AnchorController;
  mobController: MobController;
  routeController: RouteController;
  waypointsController: WaypointsController;
  trackController: TrackController;
  marineRadar: RadarController;
  tidesController: TidesController;

  // Entity stores
  anchor: AnchorWatch;
  mob: MobStore;
  measure: MeasureStore;
  collision: CollisionAssessment;
  courseGuidance: CourseGuidance;
  recorder: TrackRecorder;
  routeStore: RouteStore;
  tidesStore: TidesStore;
  waypointsStore: WaypointsStore;
  symbolsStore: SymbolsStore;
  userCharts: UserCharts;
  weather: WeatherStore;
  timeTravel: TimeTravelController;
  notificationsStore: NotificationsStore;

  // Additional services and loaders
  trends: import('$features/trends').TrendsController;
  weatherLoader: ReturnType<typeof import('$features/weather').createWeatherLoader>;
  pointConditionsLoader: ReturnType<typeof import('$features/weather').createPointConditionsLoader>;
  planningSpeedKn: import('$shared/settings').PersistedValue<number>;
  thresholds: import('$shared/settings').PersistedValue<import('$shared/settings').Thresholds>;
  routeDistanceToGoMeters: number | undefined;

  // Chart state
  chartsToken: string | undefined;
  savedView: import('$shared/settings').MapView | undefined;
  currentView: import('$shared/settings').MapView | undefined;
  layerSettings: LayerSettings;
  layerOrder: string[];
  layersInitialMode: 'charts' | 'overlays';
  weatherLayerSettings: LayerSettings;
  trackSettings: import('$shared/settings').PersistedValue<
    import('$shared/settings').TrackSettings
  >;
  trackPersistenceDegraded: boolean;
  categoriesOpen: import('$shared/settings').PersistedValue<Record<string, boolean>>;

  // Panel state
  activePanel: PanelId | null;
  selectedAisId: string | undefined;
  tidesOpenedFrom: 'menu' | 'chart';
  menuOpen: boolean;
  layersView: LayersView | undefined;
  noteLoader: NoteDetailLoader | undefined;
  selectedNote: NoteSelection | undefined;
  onBackFromNote?: () => void;
  weatherPanelOpen: boolean;
  radarControlsOpen: boolean;
  radarOpenedFrom: 'menu' | 'layers';
  radarDraftDirty: boolean;
  radarCloseRequested: boolean;
  mapInstance: MapLibreMap | undefined;
  companionBase: string | null;
  chartLockerAccessUrl: string;
  chartLockerState: import('$features/prewarm').CompanionState;
  chartLockerAdminAccess: boolean;
  arrivalBanner: string | undefined;
  toastMessage: string | undefined;
  hoveredPoi: Poi | undefined;
  poiInView: Poi[];
  poiViewState: PoiViewState;
  historyProviders: HistoryProviders | undefined;
  serverFeatures: ServerFeatures | undefined;
  notificationsApi: boolean;
  weatherProvider: WeatherProvider | undefined;
  collisionMute: { active: boolean };
  collisionMuteRemainingMin: number | undefined;
  alarmActionError: string | undefined;
  genericAlarms: ActiveNotification[];
  genericSounding: boolean;
  genericLocallyMuted: boolean;
  shallowMonitor: ShallowMonitorSnapshot;
  arrivalMuted: import('$shared/settings').PersistedValue<boolean>;

  // Callbacks for state mutations
  onViewChange: (view: import('$shared/settings').MapView) => void;
  onLayersChange: (settings: LayerSettings) => void;
  onOrderChange: (order: string[]) => void;
  onWeatherLayersChange: (settings: LayerSettings) => void;
  onLayersReady: (view: LayersView) => void;
  onMapReady: (recolor: (theme: Theme) => void) => void;
  onCommandsReady: (commands: MapCommands) => void;
  onUserChartsReady: (registrar: UserChartRegistrar) => void;
  onMapInstance: (m: MapLibreMap) => void;
  onMapDestroyed: () => void;
  onUserPan: () => void;
  onNoteSelect: (selection: NoteSelection | undefined) => void;
  onAisSelect: (id: string | undefined) => void;
  onTideStationSelect: (selection: TideStationSelectionEvent) => void;
  onNotes: (notes: NotePoint[]) => void;
  onPoiStatus: (state: PoiViewState) => void;
  onWeatherLayersReady: (apply: (settings: LayerSettings) => void) => void;

  // Panel actions
  closePanel: () => void;
  backToMenu: () => void;
  closeTrendsPanel: () => void;
  backFromTrendsPanel: () => void;
  openInstalledCharts: () => void;
  backToOfflineCharts: () => void;
  openLayersPanel: (mode: 'charts' | 'overlays') => void;
  setLayerVisible: (id: string, visible: boolean) => void;
  onRetryHistoryProviders: () => void;
  onRetryChartLocker: () => void;
  // Arms the measure tool (shows the layer and resets prior points); owned by the shell so the
  // menu tile and the chart's context action share one meaning.
  armMeasure: (reset?: boolean) => boolean;
  // Keyboard-equivalent Measure movement after the navigator pans the chart with MapLibre's
  // keyboard controls.
  moveSelectedMeasureToCenter: () => void;
  toggleCollisionMute: () => void;
  onSilenceNotification: (notification: ActiveNotification) => void;
  onAcknowledgeNotification: (notification: ActiveNotification) => void;
  muteGenericHere: () => void;
  openAlarmsPanel: () => void;
  selectPoi: (poi: Poi) => void;
  flyToPosition: (position: LatLon) => void;
  onShowChartBounds: (bounds: Bbox4) => void;
  onHighlightLeg: (index: number) => void;
  closeRoutesPanel: () => void;
  backFromRoutesPanel: () => void;
  closeTracksPanel: () => void;
  backFromTracksPanel: () => void;
  closeWaypointsPanel: () => void;
  backFromWaypointsPanel: () => void;
  onStartRouteHere: (position: LatLon) => void;
  closeNote: () => void;
  closePoiSearch: () => void;
  backFromPoiSearch: () => void;
  onSetRadarPower: (status: import('$features/marine-radar').RadarStatus) => void;
}

type ServiceKey =
  | 'origin'
  | 'store'
  | 'vessel'
  | 'aisTargets'
  | 'units'
  | 'auth'
  | 'net'
  | 'theme'
  | 'trends'
  | 'weatherLoader'
  | 'pointConditionsLoader'
  | 'planningSpeedKn'
  | 'thresholds'
  | 'trackSettings'
  | 'categoriesOpen'
  | 'arrivalMuted';
type ControllerKey =
  | 'anchorController'
  | 'mobController'
  | 'routeController'
  | 'waypointsController'
  | 'trackController'
  | 'marineRadar'
  | 'tidesController';
type EntityKey =
  | 'anchor'
  | 'mob'
  | 'measure'
  | 'collision'
  | 'courseGuidance'
  | 'recorder'
  | 'routeStore'
  | 'tidesStore'
  | 'waypointsStore'
  | 'symbolsStore'
  | 'userCharts'
  | 'weather'
  | 'timeTravel'
  | 'notificationsStore';
type ActionKey =
  | 'onViewChange'
  | 'onLayersChange'
  | 'onOrderChange'
  | 'onWeatherLayersChange'
  | 'onLayersReady'
  | 'onMapReady'
  | 'onCommandsReady'
  | 'onUserChartsReady'
  | 'onMapInstance'
  | 'onMapDestroyed'
  | 'onUserPan'
  | 'onNoteSelect'
  | 'onAisSelect'
  | 'onTideStationSelect'
  | 'onNotes'
  | 'onPoiStatus'
  | 'onWeatherLayersReady'
  | 'closePanel'
  | 'backToMenu'
  | 'closeTrendsPanel'
  | 'backFromTrendsPanel'
  | 'openInstalledCharts'
  | 'backToOfflineCharts'
  | 'openLayersPanel'
  | 'setLayerVisible'
  | 'onRetryHistoryProviders'
  | 'onRetryChartLocker'
  | 'armMeasure'
  | 'moveSelectedMeasureToCenter'
  | 'toggleCollisionMute'
  | 'onSilenceNotification'
  | 'onAcknowledgeNotification'
  | 'muteGenericHere'
  | 'openAlarmsPanel'
  | 'selectPoi'
  | 'flyToPosition'
  | 'onShowChartBounds'
  | 'onHighlightLeg'
  | 'closeRoutesPanel'
  | 'backFromRoutesPanel'
  | 'closeTracksPanel'
  | 'backFromTracksPanel'
  | 'closeWaypointsPanel'
  | 'backFromWaypointsPanel'
  | 'onStartRouteHere'
  | 'closeNote'
  | 'closePoiSearch'
  | 'backFromPoiSearch'
  | 'onSetRadarPower';

interface Props extends Omit<FlatProps, ServiceKey | ControllerKey | EntityKey | ActionKey> {
  services: Pick<FlatProps, ServiceKey>;
  controllers: Pick<FlatProps, ControllerKey>;
  entities: Pick<FlatProps, EntityKey>;
  actions: Pick<FlatProps, ActionKey>;
}

let {
  services,
  controllers,
  entities,
  routeDistanceToGoMeters,
  chartsToken,
  savedView,
  currentView,
  layerSettings,
  layerOrder,
  layersInitialMode,
  weatherLayerSettings,
  trackPersistenceDegraded,
  activePanel,
  selectedAisId,
  tidesOpenedFrom,
  menuOpen = $bindable(),
  layersView,
  noteLoader,
  selectedNote = $bindable(),
  onBackFromNote,
  weatherPanelOpen = $bindable(),
  radarControlsOpen = $bindable(),
  radarOpenedFrom = $bindable(),
  radarDraftDirty = $bindable(),
  radarCloseRequested = $bindable(),
  mapInstance = $bindable(),
  companionBase,
  chartLockerAccessUrl,
  chartLockerState,
  chartLockerAdminAccess,
  arrivalBanner,
  toastMessage,
  hoveredPoi = $bindable(),
  poiInView,
  poiViewState,
  historyProviders,
  serverFeatures,
  notificationsApi,
  weatherProvider,
  collisionMute,
  collisionMuteRemainingMin,
  alarmActionError,
  genericAlarms,
  genericSounding,
  genericLocallyMuted,
  shallowMonitor,
  actions,
}: Props = $props();

const {
  origin,
  store,
  vessel,
  aisTargets,
  units,
  auth,
  net,
  theme,
  trends,
  weatherLoader,
  pointConditionsLoader,
  planningSpeedKn,
  thresholds,
  trackSettings,
  categoriesOpen,
  arrivalMuted,
} = $derived(services);
const insecureTransport = $derived(isInsecureTransportOrigin(origin));
const {
  anchorController,
  mobController,
  routeController,
  waypointsController,
  trackController,
  marineRadar,
  tidesController,
} = $derived(controllers);
const {
  anchor,
  mob,
  measure,
  collision,
  courseGuidance,
  recorder,
  routeStore,
  tidesStore,
  waypointsStore,
  symbolsStore,
  userCharts,
  weather,
  timeTravel,
  notificationsStore,
} = $derived(entities);
const {
  onViewChange,
  onLayersChange,
  onOrderChange,
  onWeatherLayersChange,
  onLayersReady,
  onMapReady,
  onCommandsReady,
  onUserChartsReady,
  onMapInstance,
  onMapDestroyed,
  onUserPan,
  onNoteSelect,
  onAisSelect,
  onTideStationSelect,
  onNotes,
  onPoiStatus,
  onWeatherLayersReady,
  closePanel,
  backToMenu,
  closeTrendsPanel,
  backFromTrendsPanel,
  openInstalledCharts,
  backToOfflineCharts,
  openLayersPanel,
  setLayerVisible,
  onRetryHistoryProviders,
  onRetryChartLocker,
  armMeasure,
  moveSelectedMeasureToCenter,
  toggleCollisionMute,
  onSilenceNotification,
  onAcknowledgeNotification,
  muteGenericHere,
  openAlarmsPanel,
  selectPoi,
  flyToPosition,
  onShowChartBounds,
  onHighlightLeg,
  closeRoutesPanel,
  backFromRoutesPanel,
  closeTracksPanel,
  backFromTracksPanel,
  closeWaypointsPanel,
  backFromWaypointsPanel,
  onStartRouteHere,
  closeNote,
  closePoiSearch,
  backFromPoiSearch,
  onSetRadarPower,
} = $derived(actions);

let mapCommands = $state<MapCommands | undefined>();
let serverChartsStatus = $state<'loading' | 'ready' | 'partial' | 'error'>('loading');
let retryServerCharts = $state<(() => void) | undefined>();
let criticalOverlayError = $state<string | undefined>();
let lazyPanelAttempt = $state(0);
let radarDiscardRequested = $state(false);
let pendingRadarPanelAction = $state<
  | { kind: 'close' }
  | { kind: 'back' }
  | { kind: 'overlays' }
  | { kind: 'select'; radarId: string }
  | undefined
>(undefined);

const CRITICAL_OVERLAY_LABELS: Record<string, string> = {
  'own-vessel': 'vessel position',
  collision: 'collision warnings',
  mob: 'man-overboard marker',
  'anchor-watch': 'anchor watch',
  course: 'active course',
  routes: 'routes',
};

function retryLazyPanel(): void {
  lazyPanelAttempt += 1;
}

function regionsPanelForAttempt() {
  void lazyPanelAttempt;
  return loadRegionsPanel();
}

function chartsPanelForAttempt() {
  void lazyPanelAttempt;
  return loadChartsManagementPanel();
}

function radarControlsForAttempt() {
  void lazyPanelAttempt;
  return loadRadarControls();
}

function runRadarPanelAction(action: NonNullable<typeof pendingRadarPanelAction>): void {
  switch (action.kind) {
    case 'back':
      radarControlsOpen = false;
      backToMenu();
      break;
    case 'overlays':
      radarControlsOpen = false;
      openLayersPanel('overlays');
      break;
    case 'select':
      marineRadar.selectRadar(action.radarId);
      break;
    default:
      radarControlsOpen = false;
  }
}

function requestRadarPanelAction(action: NonNullable<typeof pendingRadarPanelAction>): void {
  if (!radarDraftDirty) {
    runRadarPanelAction(action);
    return;
  }
  pendingRadarPanelAction = action;
  radarDiscardRequested = true;
}

function resolveRadarDraftDiscard(discarded: boolean): void {
  const action = pendingRadarPanelAction;
  radarDiscardRequested = false;
  pendingRadarPanelAction = undefined;
  if (discarded && action) runRadarPanelAction(action);
}

function weatherMapForAttempt() {
  void lazyPanelAttempt;
  return loadWeatherMap();
}

function trendsPanelForAttempt() {
  void lazyPanelAttempt;
  return loadTrendsPanel();
}

function tidesPanelForAttempt() {
  void lazyPanelAttempt;
  return loadTidesPanel();
}

function aisListPanelForAttempt() {
  void lazyPanelAttempt;
  return loadAisListPanel();
}

function historyStripForAttempt() {
  void lazyPanelAttempt;
  return loadHistoryStrip();
}

function measureStripForAttempt() {
  void lazyPanelAttempt;
  return loadMeasureStrip();
}

const accessRequestsUrl = $derived(`${origin}/admin/#/security/access/requests`);
const radarEchoShown = $derived(layerSettings['marine-radar']?.visible ?? false);
const routeProgress = $derived.by<RouteProgress | undefined>(() => {
  const distanceToGoMeters = routeDistanceToGoMeters;
  if (distanceToGoMeters == null) return undefined;
  const sog = vessel.sogStale ? undefined : vessel.sogMps;
  return {
    distanceToGoMeters,
    timeToGoSeconds: sog == null ? undefined : etaSeconds(distanceToGoMeters, sog),
  };
});

$effect(() => {
  mapCommands?.highlightPoi(hoveredPoi?.position ?? selectedNote?.position);
});

$effect(() => {
  if (radarControlsOpen) return;
  radarDraftDirty = false;
  radarDiscardRequested = false;
  pendingRadarPanelAction = undefined;
});

$effect(() => {
  if (!radarCloseRequested) return;
  radarCloseRequested = false;
  if (radarControlsOpen) requestRadarPanelAction({ kind: 'close' });
});

$effect(() => {
  if (mapCommands) onCommandsReady(mapCommands);
});

$effect(() => {
  if (timeTravel.active) return registerDismiss(() => timeTravel.exit());
});
</script>

<section class="chart-host" aria-label="Chart">
  <ChartCanvas
    {origin}
    {units}
    waypoints={waypointsStore}
    symbols={symbolsStore}
    onDropWaypoint={waypointsController.onDropWaypoint}
    aisTrailsAvailable={() => serverFeatures?.plugins.has('tracks') ?? false}
    isOnline={() => net.online}
    historyProviders={() => historyProviders}
    {timeTravel}
    {store}
    {vessel}
    {aisTargets}
    {selectedAisId}
    onAisSelect={(id) => onAisSelect(id)}
    {anchor}
    {mob}
    {measure}
    {collision}
    guidance={courseGuidance}
    {recorder}
    {routeStore}
    tides={tidesStore}
    theme={theme.theme}
    {trackSettings}
    savedTracks={trackController.savedSource}
    {userCharts}
    {chartsToken}
    initialView={savedView}
    savedLayers={layerSettings}
    {onLayersChange}
    savedOrder={layerOrder}
    {onOrderChange}
    onReady={onLayersReady}
    {onMapReady}
    onCommandsReady={(commands) => (mapCommands = commands)}
    {onUserChartsReady}
    onServerChartsReady={(retry) => (retryServerCharts = retry)}
    onServerChartsStatus={(status) => (serverChartsStatus = status)}
    onCriticalOverlayError={(ids) => {
      criticalOverlayError =
        ids.length === 0
          ? undefined
          : `Navigation overlays failed to load (${ids.map((id) => CRITICAL_OVERLAY_LABELS[id] ?? id).join(', ')}). Reload Binnacle before navigating.`;
    }}
    {onViewChange}
    {onNoteSelect}
    {onTideStationSelect}
    {onNotes}
    {onPoiStatus}
    {onUserPan}
    onGoToHere={(position) => void routeController.onGoToHere(position)}
    onStartRoute={onStartRouteHere}
    onMeasureFrom={(position) => {
      if (armMeasure(true)) measure.add(position);
    }}
    onRouteEditorError={() => routeController.flagEditorLoadFailed()}
    onAnchorMoved={(position) => void anchorController.onAnchorMoved(position)}
    marineRadarLayer={marineRadar.layer}
    {onMapInstance}
    {onMapDestroyed}
  />
  <div class="banner-slot">
    <AuthBanner {auth} requestsUrl={accessRequestsUrl} {insecureTransport} />
  </div>
  <div class="top-banner-stack">
    {#if criticalOverlayError}
      <div class="alert-note alert-note--filled toast-banner" role="alert">
        {criticalOverlayError}
      </div>
    {/if}
    {#if arrivalBanner}
      <div class="arrival-banner" role="status">Arrived at {arrivalBanner}</div>
    {/if}
    {#if toastMessage}
      <div class="alert-note alert-note--filled toast-banner" role="status">{toastMessage}</div>
    {/if}
  </div>
  <div class="bottom-stack" class:above-weather={weatherPanelOpen}>
    <div class="secondary-strips">
      {#if timeTravel.active}
        {#await historyStripForAttempt()}
          <div class="bottom-strip bottom-strip--accent">
            <div class="head">
              <span class="title">Time travel</span>
              <button type="button" class="ack" onclick={() => timeTravel.exit()}>Exit</button>
            </div>
            <div class="row">
              <span class="muted-note" role="status">Loading time travel controls…</span>
            </div>
          </div>
        {:then module}
          <module.default controller={timeTravel} {units} onExit={() => timeTravel.exit()} />
        {:catch}
          <div class="bottom-strip bottom-strip--accent" role="alert">
            <div class="row">
              <span class="alert-note">Time travel controls could not load.</span>
              <button type="button" class="ack" onclick={retryLazyPanel}>Retry</button>
              <button type="button" class="ack" onclick={() => timeTravel.exit()}>Exit</button>
            </div>
          </div>
        {/await}
      {/if}
      <NavStrip
        guidance={courseGuidance}
        {routeProgress}
        onStop={() => routeController.onStopCourse()}
        onSkip={routeStore.activeId !== undefined ? routeController.onSkipPoint : undefined}
      />
      {#if measure.active}
        {#await measureStripForAttempt()}
          <aside class="bottom-strip bottom-strip--accent" aria-label="Measure">
            <div class="head">
              <span class="title">Measure</span>
              <span class="note" role="status">Loading Measure controls…</span>
              <button type="button" class="ack" onclick={() => measure.stop()}>Done</button>
            </div>
          </aside>
        {:then module}
          <module.default {measure} {units} onMoveSelectedToCenter={moveSelectedMeasureToCenter} />
        {:catch}
          <div class="bottom-strip bottom-strip--accent" aria-label="Measure" role="alert">
            <div class="row">
              <span class="alert-note">Measure controls could not load.</span>
              <button type="button" class="ack" onclick={retryLazyPanel}>Retry</button>
              <button type="button" class="ack" onclick={() => measure.stop()}>Done</button>
            </div>
          </div>
        {/await}
      {/if}
    </div>
    <div class="safety-strips">
      <AnchorStrip {anchor} {units} onRaise={() => void anchorController.onRaise()} />
      <DangerStrip {collision} muted={collisionMute.active} onToggleMute={toggleCollisionMute} />
      <MobStrip {mob} {units} onSteer={mobController.onSteer} onCancel={mobController.onCancel} />
      <AlarmStrip
        notifications={genericAlarms}
        sounding={genericSounding}
        locallyMuted={genericLocallyMuted}
        writeBlocked={auth.writeBlocked}
        onSilence={notificationsApi ? onSilenceNotification : undefined}
        onAcknowledge={notificationsApi ? onAcknowledgeNotification : undefined}
        onMuteHere={muteGenericHere}
        onOpenAlarms={openAlarmsPanel}
      />
    </div>
  </div>
  {#if selectedNote && noteLoader}
    <div class="panel-slot panel-slot--end">
      <NoteDetailPanel
        selection={selectedNote}
        load={noteLoader.load}
        onClose={closeNote}
        onBack={onBackFromNote}
        onLocate={() => selectedNote && flyToPosition(selectedNote.position)}
      />
    </div>
  {/if}
  {#if activePanel && activePanel !== 'profiles'}
    <div class="panel-slot" id={activePanel === 'layers' ? 'layers-panel' : undefined}>
      {#if activePanel === 'layers' && layersView}
        <LayersPanel
          view={layersView}
          initialMode={layersInitialMode}
          {auth}
          chartsLoadState={serverChartsStatus}
          onRetryCharts={retryServerCharts}
          {userCharts}
          {categoriesOpen}
          onClose={closePanel}
          onBack={backToMenu}
          {onShowChartBounds}
          onManageLayer={(id) => {
            if (id === 'marine-radar') {
              radarOpenedFrom = 'layers';
              radarControlsOpen = true;
            }
          }}
        />
      {:else if activePanel === 'routes'}
        <RoutesPanel
          {auth}
          routes={routeStore.routes}
          shownIds={routeStore.shownIds}
          working={routeStore.working}
          activeId={routeStore.activeId}
          refreshing={routeController.refreshing}
          loadState={routeController.loadState}
          busy={routeController.busy}
          highlight={routeStore.highlight}
          {onHighlightLeg}
          error={routeController.routeError}
          editorLoadFailed={routeController.editorLoadFailed}
          onRetryEditor={routeController.retryRouteEdit}
          onRetry={() => void routeController.refreshRoutes()}
          onNew={routeController.beginNewRoute}
          onEditRoute={routeController.onEditRoute}
          onSave={routeController.onSaveRoute}
          onCancelEdit={routeController.onCancelRouteEdit}
          onToggleShown={routeController.onToggleRouteShown}
          onLocate={routeController.showRoute}
          onActivate={routeController.onActivateRoute}
          onStop={routeController.onStopCourse}
          onReverse={routeController.onReverseRoute}
          onExportGpx={routeController.onExportRouteGpx}
          onImportGpx={routeController.onImportRouteGpx}
          planningSpeed={planningSpeedKn}
          onDelete={routeController.onDeleteRoute}
          onClose={closeRoutesPanel}
          onBack={backFromRoutesPanel}
        />
      {:else if activePanel === 'tracks'}
        <TracksPanel
          {auth}
          {recorder}
          settings={trackSettings}
          saved={trackController.savedTracks}
          shown={trackController.shownSaved}
          loadState={trackController.loadState}
          provisioning={trackController.provisioning}
          busy={trackController.busy}
          routeBusy={routeController.busy}
          persistenceDegraded={trackPersistenceDegraded}
          onRetry={() => void trackController.refreshSavedTracks()}
          onSave={trackController.onSaveTrack}
          onSaveAsRoute={routeController.onSaveTrackAsRoute}
          onTrackHome={routeController.onTrackHome}
          onDelete={trackController.onDeleteSavedTrack}
          onToggleSaved={trackController.onToggleSaved}
          onExport={trackController.onExportSavedTrack}
          onClose={closeTracksPanel}
          onBack={backFromTracksPanel}
        />
      {:else if activePanel === 'waypoints'}
        <WaypointsPanel
          {auth}
          {vessel}
          {units}
          waypoints={waypointsStore.waypoints}
          loadState={waypointsController.loadState}
          busy={waypointsController.busy}
          routeBusy={routeController.busy}
          onRetry={() => void waypointsController.refreshWaypoints()}
          onLocate={(waypoint) => flyToPosition(waypoint.position)}
          onGoTo={(waypoint) => void routeController.onGoToWaypoint(waypoint)}
          onEdit={waypointsController.onOpenEditWaypoint}
          onDelete={waypointsController.onDeleteWaypoint}
          onClose={closeWaypointsPanel}
          onBack={backFromWaypointsPanel}
        />
      {:else if activePanel === 'tides'}
        {#await tidesPanelForAttempt()}
          <div class="slide-over slide-over--dock-left panel-loading" role="status">
            Loading tide predictions…
          </div>
        {:then module}
          <module.default
            store={tidesStore}
            controller={tidesController}
            {units}
            stationsShown={layerSettings.tides?.visible ?? false}
            onToggleStations={(shown) => setLayerVisible('tides', shown)}
            onClose={closePanel}
            onBack={tidesOpenedFrom === 'menu' ? backToMenu : undefined}
          />
        {:catch}
          <div class="slide-over slide-over--dock-left panel-load-error" role="alert">
            Tide predictions could not load.
            <button type="button" class="btn btn-ghost" onclick={retryLazyPanel}>Retry</button>
          </div>
        {/await}
      {:else if activePanel === 'trends'}
        {#await trendsPanelForAttempt()}
          <div class="slide-over slide-over--dock-left panel-loading" role="status">
            Loading data trends…
          </div>
        {:then module}
          <module.default
            controller={trends}
            onRetryProvider={onRetryHistoryProviders}
            mode={units.mode}
            theme={theme.theme}
            onClose={closeTrendsPanel}
            onBack={backFromTrendsPanel}
          />
        {:catch}
          <div class="slide-over slide-over--dock-left panel-load-error" role="alert">
            Data trends could not load.
            <button type="button" class="btn btn-ghost" onclick={retryLazyPanel}>Retry</button>
          </div>
        {/await}
      {:else if activePanel === 'ais'}
        {#await aisListPanelForAttempt()}
          <div class="slide-over slide-over--dock-left panel-loading" role="status">
            Loading AIS targets…
          </div>
        {:then module}
          <module.default
            {units}
            {aisTargets}
            {vessel}
            {collision}
            selectedId={selectedAisId}
            onSelect={onAisSelect}
            connectionPhase={store.connection.phase}
            onLocate={flyToPosition}
            onClose={closePanel}
            onBack={backToMenu}
          />
        {:catch}
          <div class="slide-over slide-over--dock-left panel-load-error" role="alert">
            AIS targets could not load.
            <button type="button" class="btn btn-ghost" onclick={retryLazyPanel}>Retry</button>
          </div>
        {/await}
      {:else if activePanel === 'poi-search'}
        <PoiSearchPanel
          pois={poiInView}
          {vessel}
          {units}
          viewState={poiViewState}
          selectedId={selectedNote?.id}
          placesShown={layerSettings.notes?.visible ?? false}
          onTogglePlaces={(shown) => setLayerVisible('notes', shown)}
          onSelect={selectPoi}
          onHover={(poi) => (hoveredPoi = poi)}
          onClose={closePoiSearch}
          onBack={backFromPoiSearch}
        />
      {:else if activePanel === 'anchor'}
        <AnchorPanel
          {auth}
          {units}
          {anchor}
          {vessel}
          error={anchorController.anchorError}
          busy={anchorController.busy}
          onDrop={() => void anchorController.onDrop()}
          onRaise={() => void anchorController.onRaise()}
          onSetRadius={(meters) => void anchorController.onSetRadius(meters)}
          onClose={closePanel}
          onBack={backToMenu}
        />
      {:else if activePanel === 'alarms'}
        <AlarmsPanel
          {auth}
          connectionPhase={store.connection.phase}
          {thresholds}
          {units}
          collisionMuted={collisionMute.active}
          {collisionMuteRemainingMin}
          onToggleCollisionMute={toggleCollisionMute}
          arrivalMuted={arrivalMuted.value}
          onToggleArrivalMute={() => arrivalMuted.set(!arrivalMuted.value)}
          notifications={notificationsStore}
          error={alarmActionError}
          onSilence={notificationsApi ? onSilenceNotification : undefined}
          onAcknowledge={notificationsApi ? onAcknowledgeNotification : undefined}
          shallow={shallowMonitor}
          onClose={closePanel}
          onBack={backToMenu}
        />
      {:else if activePanel === 'regions' && companionBase !== null && mapInstance}
        {#await regionsPanelForAttempt()}
          <div class="slide-over slide-over--dock-left panel-loading" role="status">
            Loading offline charts…
          </div>
        {:then module}
          <module.default
            adminAccess={chartLockerAdminAccess}
            accessUrl={chartLockerAccessUrl}
            accessState={chartLockerState}
            map={mapInstance}
            {units}
            {companionBase}
            onClose={closePanel}
            onBack={backToMenu}
            onOpenCharts={openInstalledCharts}
            onRetryAccess={onRetryChartLocker}
          />
        {:catch}
          <div class="slide-over slide-over--dock-left panel-load-error" role="alert">
            Offline charts could not load.
            <button type="button" class="btn btn-ghost" onclick={retryLazyPanel}>Retry</button>
          </div>
        {/await}
      {:else if activePanel === 'charts-management' && companionBase !== null}
        {#await chartsPanelForAttempt()}
          <div class="slide-over slide-over--dock-left panel-loading" role="status">
            Loading installed charts…
          </div>
        {:then module}
          <module.default
            adminAccess={chartLockerAdminAccess}
            accessUrl={chartLockerAccessUrl}
            accessState={chartLockerState}
            {companionBase}
            onClose={closePanel}
            onBack={backToOfflineCharts}
            onRetryAccess={onRetryChartLocker}
          />
        {:catch}
          <div class="slide-over slide-over--dock-left panel-load-error" role="alert">
            Installed charts could not load.
            <button type="button" class="btn btn-ghost" onclick={retryLazyPanel}>Retry</button>
          </div>
        {/await}
      {/if}
    </div>
  {/if}
  {#if radarControlsOpen}
    <div class="panel-slot">
      <SlideOver
        title="Radar controls"
        closeLabel="Close radar controls"
        bodyFlex
        onClose={() => requestRadarPanelAction({ kind: 'close' })}
        onBack={radarOpenedFrom === 'menu'
          ? () => requestRadarPanelAction({ kind: 'back' })
          : undefined}
      >
        {#await radarControlsForAttempt()}
          <div class="panel-loading" role="status">Loading radar controls…</div>
        {:then module}
          <module.default
            store={marineRadar.store}
            unitsMode={units.mode}
            onSetControl={(id, value) => void marineRadar.setControl(id, { value })}
            onSetAuto={(id, auto) => void marineRadar.setControl(id, { auto })}
            onSetZoneControl={(id, value) => void marineRadar.setZoneControl(id, value)}
            onSelectRadar={(id) => requestRadarPanelAction({ kind: 'select', radarId: id })}
            onSetPower={onSetRadarPower}
            echoShown={radarEchoShown}
            onToggleEcho={(shown) => setLayerVisible('marine-radar', shown)}
            discardRequested={radarDiscardRequested}
            onDraftDirtyChange={(dirty) => (radarDraftDirty = dirty)}
            onDiscardResolved={resolveRadarDraftDiscard}
            onOpenOverlaySettings={layersView
              ? () => requestRadarPanelAction({ kind: 'overlays' })
              : undefined}
          />
        {:catch}
          <div class="panel-load-error" role="alert">
            Radar controls could not load.
            <button type="button" class="btn btn-ghost" onclick={retryLazyPanel}>Retry</button>
          </div>
        {/await}
      </SlideOver>
    </div>
  {/if}
  {#if weatherPanelOpen}
    {#await weatherMapForAttempt()}
      <div class="panel-loading panel-loading--cover" role="status">Loading weather…</div>
    {:then module}
      <module.default
        store={weather}
        {origin}
        {units}
        loader={weatherLoader}
        theme={theme.theme}
        initialView={currentView}
        savedLayers={weatherLayerSettings}
        onLayersChange={onWeatherLayersChange}
        onLayersReady={onWeatherLayersReady}
        token={chartsToken}
        {weatherProvider}
        position={vessel.position}
        positionStale={vessel.positionStale}
        pointLoader={pointConditionsLoader}
        online={net.online}
        onClose={() => (weatherPanelOpen = false)}
        onBack={() => {
          weatherPanelOpen = false;
          menuOpen = true;
        }}
      />
    {:catch}
      <div class="panel-load-error panel-load-error--cover" role="alert">
        Weather view could not load.
        <button type="button" class="btn btn-ghost" onclick={retryLazyPanel}>Retry</button>
        <button type="button" class="btn btn-ghost" onclick={() => (weatherPanelOpen = false)}>
          Close
        </button>
      </div>
    {/await}
  {/if}
</section>

<style>
.chart-host {
  position: relative;
  block-size: 100%;
}
.banner-slot {
  position: absolute;
  inset-block-start: 0;
  inset-inline: 0;
  z-index: var(--z-overlay);
}
/* Positions the arrival banner and the toast in the same top-center slot, stacked when both are
   showing at once. The wrapper spans the full width so it can center either child, but stays
   pointer-events: none so it never blocks map taps; each banner opts back into pointer-events:
   auto for its own content-sized box. */
.top-banner-stack {
  position: absolute;
  inset-block-start: var(--space-3);
  inset-inline: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  pointer-events: none;
  z-index: var(--z-safety-strips);
}
.arrival-banner {
  pointer-events: auto;
  inline-size: fit-content;
  max-inline-size: calc(100% - var(--space-6));
  padding: var(--space-2) var(--space-4);
  background: var(--accent-tint);
  border: 1px solid var(--accent);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-overlay);
  /* --accent-tint-text stays the ordinary body color except in night-red, where it borrows
     --accent instead (tokens.css): plain --text fails AA on this accent-tinted fill there. */
  color: var(--accent-tint-text);
  font-weight: 600;
}
/* The toast reuses the shared .alert-note--filled treatment; only sizing and shadow are local. */
.toast-banner {
  pointer-events: auto;
  inline-size: fit-content;
  max-inline-size: calc(100% - var(--space-6));
  padding: var(--space-2) var(--space-4);
  box-shadow: var(--shadow-overlay);
}
/* Keep safety strips pinned above the reachable bottom edge. Lower-priority review, navigation, and
   tool strips scroll in their own tier, so a pileup can never clip MOB, collision, or anchor actions
   behind History or Measure. */
.bottom-stack {
  position: absolute;
  inset-block-end: var(--space-3);
  inset-inline: var(--space-3);
  inline-size: min(calc(28rem + 2 * var(--space-3)), calc(100% - 2 * var(--space-3)));
  margin-inline: auto;
  max-block-size: min(60dvh, calc(100% - 2 * var(--space-3)));
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  overflow: hidden;
  pointer-events: auto;
  z-index: var(--z-safety-strips);
}
.secondary-strips,
.safety-strips {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  inline-size: 100%;
}
.secondary-strips {
  min-block-size: 0;
  overflow-y: auto;
}
.safety-strips {
  flex: none;
}
.bottom-stack.above-weather {
  inset-block-end: calc(var(--control-size) + 2 * var(--space-2) + var(--weather-panel-height));
}
</style>
