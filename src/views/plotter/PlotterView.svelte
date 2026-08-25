<script lang="ts">
import type { Map as MapLibreMap } from 'maplibre-gl';
import type { AisTargets } from '$entities/ais';
import type { AnchorWatch } from '$entities/anchor';
import type { CollisionAssessment } from '$entities/collision';
import type { CourseGuidance } from '$entities/course';
import type { MeasureStore } from '$entities/measure';
import type { MobStore } from '$entities/mob';
import type { ActiveNotification, NotificationsStore } from '$entities/notifications';
import type { NotePoint, PersonalNotesStore, PoiViewState } from '$entities/poi';
import type { RouteStore, RouteWaypoint } from '$entities/route';
import type { SymbolsStore } from '$entities/symbols';
import type { TidesStore } from '$entities/tides';
import type { TrackRecorder } from '$entities/track';
import type { UnitsStore } from '$entities/units';
import type { UserCharts } from '$entities/user-charts';
import type { OwnVessel } from '$entities/vessel';
import type { WaypointsStore } from '$entities/waypoint';
import type { WeatherStore } from '$entities/weather';
import { loadAisListPanel } from '$features/ais-list';
import { loadAnchorPanel } from '$features/anchor-watch';
import { AuthBanner } from '$features/auth-banner';
import { loadChartsManagementPanel } from '$features/charts-management';
import { loadHandoffPanel } from '$features/handoff';
import { loadHelpPanel } from '$features/help';
import { type LayersView, loadLayersPanel } from '$features/layers-panel';
import type { ShallowMonitorSnapshot } from '$features/lookout';
import { loadAlarmsPanel } from '$features/lookout';
import {
  loadRadarControls,
  MARINE_RADAR_OVERLAY_ID,
  radarAreaChartInstruction,
} from '$features/marine-radar';
import { loadMeasureStrip } from '$features/measure';
import { NavStrip, type RouteProgress } from '$features/navigation';
import { type NoteDetailLoader, NoteDetailPanel, type NoteSelection } from '$features/notes';
import { loadPoiSearchPanel, type Poi } from '$features/poi-search';
import { loadRegionsPanel } from '$features/prewarm';
import { loadRoutesPanel, RouteEditStrip } from '$features/routing';
import {
  loadTidesPanel,
  TIDES_OVERLAY_ID,
  type TideStationSelectionEvent,
  type TidesController,
} from '$features/tides';
import { loadHistoryStrip, type TimeTravelController } from '$features/time-travel';
import { loadTracksPanel } from '$features/tracks';
import { loadTrendsPanel } from '$features/trends';
import { loadWaypointsPanel } from '$features/waypoints';
import type { WeatherProvider } from '$features/weather';
import type { Bbox4, LatLon } from '$shared/geo';
import { hasVisibleNavigationChart, type LayerSettings } from '$shared/map';
import { etaSeconds } from '$shared/nav';
import type { OnlineStatus, PwaStatus } from '$shared/pwa';
import type {
  AuthController,
  HistoryProviders,
  ServerFeatures,
  SignalKStore,
} from '$shared/signalk';
import { isInsecureTransportOrigin } from '$shared/signalk';
import {
  createPanelMinimize,
  dialog,
  ErrorBoundary,
  LazyPanelState,
  type PanelId,
  registerDismiss,
  SlideOver,
  type Theme,
  type ThemeController,
} from '$shared/ui';
import {
  ChartCanvas,
  CRITICAL_OVERLAY_LABELS,
  type MapCommands,
  type UserChartRegistrar,
} from '$widgets/chart-canvas';
import { SafetyAlertStack } from '$widgets/safety-alert-stack';
import { loadWeatherMap } from '$widgets/weather-map';

type AnchorController = ReturnType<typeof import('$features/anchor-watch').createAnchorController>;
type MobController = ReturnType<typeof import('$features/mob').createMobController>;
type RouteController = ReturnType<typeof import('$features/routing').createRouteController>;
type WaypointsController = ReturnType<
  typeof import('$features/waypoints').createWaypointsController
>;
type PersonalNotesController = ReturnType<
  typeof import('$features/notes').createPersonalNotesController
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
  // The app-wide 1 Hz clock, shared by the surfaces that pace themselves off it.
  clock: import('$shared/lib').ReactiveClock;
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
  personalNotesController: PersonalNotesController;
  trackController: TrackController;
  marineRadar: RadarController;
  tidesController: TidesController;
  handoff: import('$features/handoff').HandoffController;

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
  personalNotesStore: PersonalNotesStore;
  symbolsStore: SymbolsStore;
  userCharts: UserCharts;
  weather: WeatherStore;
  timeTravel: TimeTravelController;
  notificationsStore: NotificationsStore;

  // Additional services and loaders
  trends: import('$features/trends').TrendsController;
  weatherLoader: ReturnType<typeof import('$features/weather').createWeatherLoader>;
  pointConditionsLoader: ReturnType<typeof import('$features/weather').createPointConditionsLoader>;
  planningSpeedMps: import('$shared/settings').PersistedValue<number>;
  thresholds: import('$shared/settings').PersistedValue<import('$shared/settings').Thresholds>;
  routeDistanceToGoMeters: number | undefined;

  // Chart state
  chartsToken: string | undefined;
  savedView: import('$shared/settings').MapView | undefined;
  currentView: import('$shared/settings').MapView | undefined;
  layerSettings: LayerSettings;
  layerOrder: string[];
  layersOpenRequest: { mode: 'charts' | 'overlays' };
  weatherLayerSettings: LayerSettings;
  trackSettings: import('$shared/settings').PersistedValue<
    import('$shared/settings').TrackSettings
  >;
  trackPersistenceDegraded: boolean;
  categoriesOpen: import('$shared/settings').PersistedValue<Record<string, boolean>>;

  // Panel state
  activePanel: PanelId | null;
  selectedAisId: string | undefined;
  selectedWaypointId: string | undefined;
  // A waypoint just saved with "Save and navigate", whose navigation confirm the panel arms once.
  armNavigateWaypointId?: string;
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
  radarPanelRequest: 'close' | 'instruments' | undefined;
  // The measured safety-rail clearance ('0px' while no alerts are up), bound out so App-level
  // surfaces the rail can float over (the full-screen instrument dock) can reserve the space.
  safetyRailClearance: string;
  mapInstance: MapLibreMap | undefined;
  companionBase: string | null;
  // Read as a getter, not captured: the companion is re-probed once real credentials arrive, so a
  // value taken at mount is the pre-auth answer for the whole session.
  companionTiles: () => string | null;
  chartLockerAccessUrl: string;
  chartLockerState: import('$features/prewarm').CompanionState;
  chartLockerAdminAccess: boolean;
  pwaStatus: PwaStatus;
  arrivalBanner: string | undefined;
  toastMessage: string | undefined;
  hoveredPoi: Poi | undefined;
  poiInView: Poi[];
  poiViewState: PoiViewState;
  historyProviders: HistoryProviders | undefined;
  serverFeatures: ServerFeatures | undefined;
  notificationsApi: boolean;
  // Alarm audio cannot sound while a watch is armed (no priming gesture since load).
  audioBlocked?: boolean;
  // The full audio grade, for the surfaces that must also state a failed or unsupported device.
  audioState?: import('$shared/audio').AlarmAudioState;
  // The first-run orientation has not been dismissed on this device yet.
  helpFirstRun?: boolean;
  // Show the compact first-run welcome banner inviting the safety orientation.
  showHelpWelcome?: boolean;
  showEncPrompt?: boolean;
  insecureNoteDismissed?: boolean;
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
  onWaypointSelect: (id: string) => void;
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
  // The latest route-coverage result from the Offline charts panel, threaded up so a watch-handoff
  // snapshot can state whether the corridor was checked.
  onRouteCoverageReport: (report: import('$features/prewarm').RouteCoverageReport | null) => void;
  openAlarmsPanel: () => void;
  selectPoi: (poi: Poi) => void;
  flyToPosition: (position: LatLon) => void;
  onShowChartBounds: (bounds: Bbox4) => void;
  onHighlightLeg: (index: number) => void;
  closeRoutesPanel: () => void;
  backFromRoutesPanel: () => void;
  // Reopen the Routes panel from the persistent route-edit strip when another panel replaced it.
  openRoutesPanel: () => void;
  // Help panel setup routes and hooks.
  openProfilesPanel: () => void;
  openHelpPanel: () => void;
  enableAlarmSound: () => void;
  resetChartHints: () => void;
  dismissHelpOrientation: () => void;
  // The region-aware chart offer's two answers: turn NOAA ENC on, or never ask again here.
  onEnableNoaaEnc: () => void;
  onDismissEncPrompt: () => void;
  onDismissInsecureNote: () => void;
  closeTracksPanel: () => void;
  backFromTracksPanel: () => void;
  closeWaypointsPanel: () => void;
  backFromWaypointsPanel: () => void;
  onStartRouteHere: (position: LatLon) => void;
  closeNote: () => void;
  closePoiSearch: () => void;
  backFromPoiSearch: () => void;
  onSetRadarPower: (status: import('$features/marine-radar').RadarStatus) => void;
  openInstrumentsPanel: () => void;
}

type ServiceKey =
  | 'origin'
  | 'store'
  | 'vessel'
  | 'clock'
  | 'aisTargets'
  | 'units'
  | 'auth'
  | 'net'
  | 'theme'
  | 'trends'
  | 'weatherLoader'
  | 'pointConditionsLoader'
  | 'planningSpeedMps'
  | 'thresholds'
  | 'trackSettings'
  | 'categoriesOpen'
  | 'arrivalMuted';
type ControllerKey =
  | 'anchorController'
  | 'mobController'
  | 'routeController'
  | 'waypointsController'
  | 'personalNotesController'
  | 'trackController'
  | 'marineRadar'
  | 'tidesController'
  | 'handoff';
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
  | 'personalNotesStore'
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
  | 'onWaypointSelect'
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
  | 'onRouteCoverageReport'
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
  | 'openRoutesPanel'
  | 'openProfilesPanel'
  | 'openHelpPanel'
  | 'enableAlarmSound'
  | 'resetChartHints'
  | 'dismissHelpOrientation'
  | 'onEnableNoaaEnc'
  | 'onDismissEncPrompt'
  | 'onDismissInsecureNote'
  | 'closeTracksPanel'
  | 'backFromTracksPanel'
  | 'closeWaypointsPanel'
  | 'backFromWaypointsPanel'
  | 'onStartRouteHere'
  | 'closeNote'
  | 'closePoiSearch'
  | 'backFromPoiSearch'
  | 'onSetRadarPower'
  | 'openInstrumentsPanel';

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
  layersOpenRequest,
  weatherLayerSettings,
  trackPersistenceDegraded,
  activePanel,
  selectedAisId,
  selectedWaypointId,
  armNavigateWaypointId,
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
  radarPanelRequest = $bindable(),
  safetyRailClearance = $bindable('0px'),
  mapInstance = $bindable(),
  companionBase,
  companionTiles,
  chartLockerAccessUrl,
  chartLockerState,
  chartLockerAdminAccess,
  pwaStatus,
  arrivalBanner,
  toastMessage,
  hoveredPoi = $bindable(),
  poiInView,
  poiViewState,
  historyProviders,
  serverFeatures,
  notificationsApi,
  audioBlocked = false,
  audioState = 'ready',
  helpFirstRun = false,
  showHelpWelcome = false,
  showEncPrompt = false,
  insecureNoteDismissed = false,
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
  clock,
  aisTargets,
  units,
  auth,
  net,
  theme,
  trends,
  weatherLoader,
  pointConditionsLoader,
  planningSpeedMps,
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
  personalNotesController,
  trackController,
  marineRadar,
  tidesController,
  handoff,
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
  personalNotesStore,
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
  onWaypointSelect,
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
  onRouteCoverageReport,
  openAlarmsPanel,
  selectPoi,
  flyToPosition,
  onShowChartBounds,
  onHighlightLeg,
  closeRoutesPanel,
  backFromRoutesPanel,
  openRoutesPanel,
  openProfilesPanel,
  openHelpPanel,
  enableAlarmSound,
  resetChartHints,
  dismissHelpOrientation,
  onEnableNoaaEnc,
  onDismissEncPrompt,
  onDismissInsecureNote,
  closeTracksPanel,
  backFromTracksPanel,
  closeWaypointsPanel,
  backFromWaypointsPanel,
  onStartRouteHere,
  closeNote,
  closePoiSearch,
  backFromPoiSearch,
  onSetRadarPower,
  openInstrumentsPanel,
} = $derived(actions);

let mapCommands = $state<MapCommands | undefined>();
let serverChartsStatus = $state<'loading' | 'ready' | 'partial' | 'error'>('loading');
let retryServerCharts = $state<(() => void) | undefined>();
let criticalOverlayError = $state<string | undefined>();
let lazyPanelAttempt = $state(0);
let radarDiscardRequested = $state(false);
const radarMinimize = createPanelMinimize();
let radarChartEditing = $state(false);
let pendingRadarPanelAction = $state<
  | { kind: 'close' }
  | { kind: 'back' }
  | { kind: 'overlays' }
  | { kind: 'select'; radarId: string }
  | { kind: 'tides'; selection: TideStationSelectionEvent }
  | { kind: 'instruments' }
  | undefined
>(undefined);

function retryLazyPanel(): void {
  lazyPanelAttempt += 1;
}

// The secondary bottom stack sits directly above the emergency rail, whose height depends on the
// active conditions, so the stack's bottom offset tracks the measured rail height.
let railHeight = $state(0);
const railClearance = $derived(railHeight > 0 ? `calc(${railHeight}px + var(--space-2))` : '0px');
// Mirror the clearance to the bindable prop for App-level consumers outside the chart host.
$effect(() => {
  safetyRailClearance = railClearance;
});

function closeWeatherPanel(): void {
  weatherPanelOpen = false;
}

function backFromWeatherPanel(): void {
  weatherPanelOpen = false;
  menuOpen = true;
}

// Retry a lazy panel import when the navigator taps Retry. The bare read of lazyPanelAttempt is
// the dependency that makes the {#await} re-run: the loaders are cached, so re-awaiting a settled
// rejection would otherwise hand back the same failure forever. One generic wrapper rather than
// eighteen identical ones, each of which was a chance to forget the dependency read.
function forAttempt<T>(load: () => Promise<T>): Promise<T> {
  void lazyPanelAttempt;
  return load();
}

function startRadarAreaChartEdit(controlId: string): string | undefined {
  const error = marineRadar.startAreaChartEdit(controlId);
  if (!error) setLayerVisible(MARINE_RADAR_OVERLAY_ID, true);
  return error;
}

function runRadarPanelAction(action: NonNullable<typeof pendingRadarPanelAction>): void {
  switch (action.kind) {
    case 'close':
      radarControlsOpen = false;
      break;
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
    case 'tides':
      radarControlsOpen = false;
      onTideStationSelect(action.selection);
      break;
    case 'instruments':
      radarControlsOpen = false;
      openInstrumentsPanel();
      break;
  }
}

function requestRadarPanelAction(action: NonNullable<typeof pendingRadarPanelAction>): void {
  if (!radarDraftDirty) {
    runRadarPanelAction(action);
    return;
  }
  radarMinimize.expand();
  pendingRadarPanelAction = action;
  radarDiscardRequested = true;
}

function resolveRadarDraftDiscard(discarded: boolean): void {
  const action = pendingRadarPanelAction;
  radarDiscardRequested = false;
  pendingRadarPanelAction = undefined;
  if (discarded && action) runRadarPanelAction(action);
}

function requestTideStationSelection(selection: TideStationSelectionEvent): void {
  if (!radarControlsOpen) {
    onTideStationSelect(selection);
    return;
  }
  // Radar and ordinary leading panels share one dock. Route this transition through the same
  // discard guard as Close and Back so Tides cannot mount underneath Radar or drop an area draft.
  requestRadarPanelAction({ kind: 'tides', selection });
}

const accessRequestsUrl = $derived(`${origin}/admin/#/security/access/requests`);

// The route being navigated, for the Offline charts route-coverage check. A function, not a value,
// so the panel and its controller always read the live route.
function activeRouteForCoverage(): { name: string; waypoints: RouteWaypoint[] } | undefined {
  const id = routeStore.activeId;
  if (id === undefined) return undefined;
  const route = routeStore.routeById(id);
  return route === undefined ? undefined : { name: route.name, waypoints: route.waypoints };
}
const radarEchoShown = $derived(layerSettings[MARINE_RADAR_OVERLAY_ID]?.visible ?? false);
// Whole-route time: the active leg's own estimate (server timeToGo, else positive-VMG) plus the
// explicit planning speed across the legs ahead. Never cross-track SOG for the whole route: an
// off-course five knots would promise an arrival the boat is not making. Any missing input leaves
// the estimate unavailable rather than optimistic.
const routeProgress = $derived.by<RouteProgress | undefined>(() => {
  const distanceToGoMeters = routeDistanceToGoMeters;
  if (distanceToGoMeters == null) return undefined;
  const legTtg = courseGuidance.timeToGoSeconds;
  const legDistance = courseGuidance.distanceToNextMeters;
  const planSpeed = planningSpeedMps.value;
  const remainingMeters =
    legDistance == null ? undefined : Math.max(0, distanceToGoMeters - legDistance);
  const remainingSeconds =
    remainingMeters == null || !(planSpeed > 0)
      ? undefined
      : etaSeconds(remainingMeters, planSpeed);
  const timeToGoSeconds =
    legTtg == null || remainingSeconds == null ? undefined : legTtg + remainingSeconds;
  return {
    distanceToGoMeters,
    timeToGoSeconds,
    basis:
      timeToGoSeconds === undefined
        ? undefined
        : courseGuidance.timeToGoBasis === 'server'
          ? 'server-plan'
          : 'vmg-plan',
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
  const editing = marineRadar.store.areaDraft?.chartEditing === true;
  if (editing) radarMinimize.collapse();
  else if (radarChartEditing) radarMinimize.expand();
  radarChartEditing = editing;
});

$effect(() => {
  const request = radarPanelRequest;
  if (!request) return;
  radarPanelRequest = undefined;
  if (radarControlsOpen) requestRadarPanelAction({ kind: request });
});

$effect(() => {
  if (mapCommands) onCommandsReady(mapCommands);
});

$effect(() => {
  if (timeTravel.active) return registerDismiss(() => timeTravel.exit());
});
</script>

{#snippet radarPlacementFooter()}
  {#if marineRadar.store.areaDraft?.chartEditing}
    <span class="radar-placement-instruction" role="status" aria-live="polite">
      {radarAreaChartInstruction(marineRadar.store.areaDraft)}
    </span>
    <button type="button" class="btn btn-ghost" onclick={marineRadar.stopAreaChartEdit}>
      Stop chart edit
    </button>
  {/if}
{/snippet}

<!-- --rail-clearance is published on the host root, not on .bottom-stack, so every piece of
     floating chart chrome (the chart badge, MapLibre's bottom-right controls, the bottom stack
     by inheritance) can yield to the measured safety-rail height with one variable. It resolves
     to 0px while no alerts are up, so consumers apply it unconditionally. -->
<section
  class="chart-host"
  class:chart-host--end-panel={selectedNote !== undefined && noteLoader !== undefined}
  style:--rail-clearance={railClearance}
  aria-label="Chart"
>
  <ChartCanvas
    {origin}
    {units}
    waypoints={waypointsStore}
    personalNotes={personalNotesStore}
    symbols={symbolsStore}
    onDropWaypoint={waypointsController.onDropWaypoint}
    onAddNote={personalNotesController.openAdd}
    aisTrailsAvailable={() => serverFeatures?.plugins.has('tracks') ?? false}
    isOnline={() => net.online}
    historyProviders={() => historyProviders}
    {timeTravel}
    {store}
    {vessel}
    {aisTargets}
    {selectedAisId}
    onAisSelect={(id) => onAisSelect(id)}
    onWaypointSelect={(id) => onWaypointSelect(id)}
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
    {companionTiles}
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
    onOpenChartLayers={() => openLayersPanel('charts')}
    onCriticalOverlayError={(ids) => {
      criticalOverlayError =
        ids.length === 0
          ? undefined
          : `Navigation overlays failed to load (${ids.map((id) => CRITICAL_OVERLAY_LABELS[id] ?? id).join(', ')}). Reload Binnacle before navigating.`;
    }}
    {onViewChange}
    {onNoteSelect}
    onTideStationSelect={requestTideStationSelection}
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
    <AuthBanner
      {auth}
      requestsUrl={accessRequestsUrl}
      insecureTransport={insecureTransport && !insecureNoteDismissed}
      onDismissInsecure={onDismissInsecureNote}
    />
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
    {#if showHelpWelcome}
      <!-- A compact invitation, never a panel forced over the chart: a helm display must come
           back to the chart on every boot. Dismiss persists on this device. -->
      <div class="alert-note toast-banner action-note action-note--wrap" role="status">
        <span>First time with Binnacle? Read the short safety orientation, or set up charts.</span>
        <button type="button" class="btn btn-compact" onclick={openHelpPanel}>Open Help</button>
        <!-- The new navigator's actual first question is where the charts are, and the reference
             base map alone never answers it. -->
        <button type="button" class="btn btn-compact" onclick={() => openLayersPanel('charts')}>
          Set up charts
        </button>
        <button type="button" class="btn btn-compact" onclick={dismissHelpOrientation}>
          Dismiss
        </button>
      </div>
    {/if}
    {#if showEncPrompt}
      <!-- The boat is inside NOAA's published chart coverage with no nautical chart on, which is
           the one case the app can fix in a tap. Dismiss persists on this device. -->
      <div class="alert-note toast-banner action-note action-note--wrap" role="status">
        <span>The official US nautical charts (NOAA ENC) cover these waters.</span>
        <button type="button" class="btn btn-compact" onclick={onEnableNoaaEnc}>
          Turn on NOAA ENC
        </button>
        <button type="button" class="btn btn-compact" onclick={onDismissEncPrompt}>Dismiss</button>
      </div>
    {/if}
    <!-- The toast channel carries failures and refusals only (see Toast), so it announces as an
      alert, matching the alarm styling it already wears. -->
    {#if toastMessage}
      <div class="alert-note alert-note--filled toast-banner" role="alert">{toastMessage}</div>
    {/if}
  </div>
  <div class="bottom-stack" class:above-weather={weatherPanelOpen}>
    <div class="secondary-strips">
      {#if timeTravel.active}
        {#await forAttempt(loadHistoryStrip)}
          <div class="bottom-strip bottom-strip--accent">
            <div class="head">
              <span class="title">Playback</span>
              <button type="button" class="ack" onclick={() => timeTravel.exit()}>Exit</button>
            </div>
            <div class="row">
              <span class="muted-note" role="status">Loading time travel controls…</span>
            </div>
          </div>
        {:then module}
          <ErrorBoundary>
            <module.default controller={timeTravel} {units} onExit={() => timeTravel.exit()} />

            {#snippet fallback(_error, reset)}
              <div class="bottom-strip bottom-strip--accent" role="alert">
                <div class="row">
                  <span class="alert-note">Playback controls stopped unexpectedly.</span>
                  <button type="button" class="ack" onclick={reset}>Retry</button>
                  <button type="button" class="ack" onclick={() => timeTravel.exit()}>Exit</button>
                </div>
              </div>
            {/snippet}
          </ErrorBoundary>
        {:catch}
          <div class="bottom-strip bottom-strip--accent" role="alert">
            <div class="row">
              <span class="alert-note">Playback controls could not load.</span>
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
      {#if routeStore.working}
        <RouteEditStrip
          working={routeStore.working}
          editorOpen={activePanel === 'routes'}
          onOpenEditor={openRoutesPanel}
          onSave={() => void routeController.onSaveRoute('')}
          canSave={routeStore.working.waypoints.length >= 2 && !routeController.busy}
          onCancel={routeController.onCancelRouteEdit}
        />
      {/if}
      {#if measure.active}
        {#await forAttempt(loadMeasureStrip)}
          <aside class="bottom-strip bottom-strip--accent" aria-label="Measure">
            <div class="head">
              <span class="title">Measure</span>
              <span class="note" role="status">Loading Measure controls…</span>
              <button type="button" class="ack" onclick={() => measure.stop()}>Done</button>
            </div>
          </aside>
        {:then module}
          <ErrorBoundary>
            <module.default
              {measure}
              {units}
              onMoveSelectedToCenter={moveSelectedMeasureToCenter}
            />

            {#snippet fallback(_error, reset)}
              <div class="bottom-strip bottom-strip--accent" aria-label="Measure" role="alert">
                <div class="row">
                  <span class="alert-note">Measure controls stopped unexpectedly.</span>
                  <button type="button" class="ack" onclick={reset}>Retry</button>
                  <button type="button" class="ack" onclick={() => measure.stop()}>Done</button>
                </div>
              </div>
            {/snippet}
          </ErrorBoundary>
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
  </div>
  <!-- The emergency rail: outside the capped bottom stack, never clipped, never lifted by the
       Forecast panel, and above it in the z-order, so Forecast yields to safety chrome instead of
       displacing it. -->
  <div class="safety-rail" bind:clientHeight={railHeight}>
    <SafetyAlertStack
      {units}
      {anchor}
      onAnchorRaise={() => void anchorController.onRaise()}
      {collision}
      collisionMuted={collisionMute.active}
      onToggleCollisionMute={toggleCollisionMute}
      onSelectAisTarget={onAisSelect}
      {mob}
      onMobSteer={mobController.onSteer}
      onMobCancel={mobController.onCancel}
      mobPublishWarning={mobController.mobPublishWarning}
      mobActiveCourse={courseGuidance.active
        ? (courseGuidance.nextPointName ?? 'the current destination')
        : undefined}
      {genericAlarms}
      {genericSounding}
      {genericLocallyMuted}
      writeBlocked={auth.writeBlocked}
      onSilence={notificationsApi ? onSilenceNotification : undefined}
      onAcknowledge={notificationsApi ? onAcknowledgeNotification : undefined}
      onMuteGenericHere={muteGenericHere}
      onOpenAlarms={openAlarmsPanel}
    />
  </div>
  {#if selectedNote && noteLoader}
    <div class="panel-slot panel-slot--end">
      <NoteDetailPanel
        selection={selectedNote}
        load={noteLoader.load}
        onClose={closeNote}
        onBack={onBackFromNote}
        onLocate={() => selectedNote && flyToPosition(selectedNote.position)}
        onEdit={selectedNote.ownedByBinnacle
          ? () => selectedNote && personalNotesController.openEdit(selectedNote)
          : undefined}
        onDelete={selectedNote.ownedByBinnacle
          ? () => selectedNote && void personalNotesController.remove(selectedNote)
          : undefined}
        writeBlocked={auth.writeBlocked}
        onRequestWriteAccess={() => void auth.requestWriteAccess()}
        requestingWriteAccess={auth.upgrading}
        writeOutcome={auth.upgradeOutcome}
        busy={personalNotesController.busy}
        mutationError={personalNotesController.error}
        onDismissMutationError={personalNotesController.clearError}
      />
    </div>
  {/if}
  {#if activePanel && activePanel !== 'profiles'}
    <div class="panel-slot" id={activePanel === 'layers' ? 'layers-panel' : undefined}>
      {#if activePanel === 'layers' && layersView}
        {#await forAttempt(loadLayersPanel)}
          <LazyPanelState
            title="Layers and charts"
            closeLabel="Close layers and charts"
            state="loading"
            message="Loading Layers and charts controls…"
            onClose={closePanel}
            onBack={backToMenu}
          />
        {:then module}
          <ErrorBoundary>
            <module.default
              view={layersView}
              request={layersOpenRequest}
              {auth}
              chartsLoadState={serverChartsStatus}
              onRetryCharts={retryServerCharts}
              {userCharts}
              {categoriesOpen}
              onClose={closePanel}
              onBack={backToMenu}
              {onShowChartBounds}
              onManageLayer={(id) => {
                if (id === MARINE_RADAR_OVERLAY_ID) {
                  radarOpenedFrom = 'layers';
                  radarControlsOpen = true;
                }
              }}
            />

            {#snippet fallback(_error, reset)}
              <LazyPanelState
                title="Layers and charts"
                closeLabel="Close layers and charts"
                state="error"
                message="Layers and charts controls stopped unexpectedly."
                onClose={closePanel}
                onBack={backToMenu}
                onRetry={reset}
              />
            {/snippet}
          </ErrorBoundary>
        {:catch}
          <LazyPanelState
            title="Layers and charts"
            closeLabel="Close layers and charts"
            state="error"
            message="Layers and charts controls could not load."
            onClose={closePanel}
            onBack={backToMenu}
            onRetry={retryLazyPanel}
          />
        {/await}
      {:else if activePanel === 'routes'}
        {#await forAttempt(loadRoutesPanel)}
          <LazyPanelState
            title="Routes"
            closeLabel="Close routes panel"
            state="loading"
            message="Loading Routes controls…"
            onClose={closeRoutesPanel}
            onBack={backFromRoutesPanel}
          />
        {:then module}
          <ErrorBoundary>
            <module.default
              {auth}
              routes={routeStore.routes}
              shownIds={routeStore.shownIds}
              working={routeStore.working}
              activeId={routeStore.activeId}
              refreshing={routeController.refreshing}
              loadState={routeController.loadState}
              provisioning={routeController.provisioning}
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
              onRename={routeController.onRenameRoute}
              onOpenOfflineCharts={companionBase !== null ? backToOfflineCharts : undefined}
              onCancelEdit={routeController.onCancelRouteEdit}
              onToggleShown={routeController.onToggleRouteShown}
              onLocate={routeController.showRoute}
              onActivate={routeController.onActivateRoute}
              onStop={routeController.onStopCourse}
              onReverse={routeController.onReverseRoute}
              onExportGpx={routeController.onExportRouteGpx}
              onImportGpx={routeController.onImportRouteGpx}
              planningSpeed={planningSpeedMps}
              onDelete={routeController.onDeleteRoute}
              onClose={closeRoutesPanel}
              onBack={backFromRoutesPanel}
            />

            {#snippet fallback(_error, reset)}
              <LazyPanelState
                title="Routes"
                closeLabel="Close routes panel"
                state="error"
                message="Routes controls stopped unexpectedly."
                onClose={closeRoutesPanel}
                onBack={backFromRoutesPanel}
                onRetry={reset}
              />
            {/snippet}
          </ErrorBoundary>
        {:catch}
          <LazyPanelState
            title="Routes"
            closeLabel="Close routes panel"
            state="error"
            message="Routes controls could not load."
            onClose={closeRoutesPanel}
            onBack={backFromRoutesPanel}
            onRetry={retryLazyPanel}
          />
        {/await}
      {:else if activePanel === 'tracks'}
        {#await forAttempt(loadTracksPanel)}
          <LazyPanelState
            title="Tracks"
            closeLabel="Close tracks panel"
            state="loading"
            message="Loading Tracks controls…"
            onClose={closeTracksPanel}
            onBack={backFromTracksPanel}
          />
        {:then module}
          <ErrorBoundary>
            <module.default
              {auth}
              {recorder}
              positionStale={vessel.positionStale}
              hasPosition={vessel.position !== undefined}
              {clock}
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

            {#snippet fallback(_error, reset)}
              <LazyPanelState
                title="Tracks"
                closeLabel="Close tracks panel"
                state="error"
                message="Tracks controls stopped unexpectedly."
                onClose={closeTracksPanel}
                onBack={backFromTracksPanel}
                onRetry={reset}
              />
            {/snippet}
          </ErrorBoundary>
        {:catch}
          <LazyPanelState
            title="Tracks"
            closeLabel="Close tracks panel"
            state="error"
            message="Tracks controls could not load."
            onClose={closeTracksPanel}
            onBack={backFromTracksPanel}
            onRetry={retryLazyPanel}
          />
        {/await}
      {:else if activePanel === 'waypoints'}
        {#await forAttempt(loadWaypointsPanel)}
          <LazyPanelState
            title="Waypoints"
            closeLabel="Close waypoints panel"
            state="loading"
            message="Loading Waypoints controls…"
            onClose={closeWaypointsPanel}
            onBack={backFromWaypointsPanel}
          />
        {:then module}
          <ErrorBoundary>
            <module.default
              {auth}
              {vessel}
              {units}
              selectedId={selectedWaypointId}
              waypoints={waypointsStore.waypoints}
              loadState={waypointsController.loadState}
              provisioning={waypointsController.provisioning}
              busy={waypointsController.busy}
              routeBusy={routeController.busy}
              onRetry={() => void waypointsController.refreshWaypoints()}
              onLocate={(waypoint) => flyToPosition(waypoint.position)}
              onGoTo={(waypoint) => void routeController.onGoToWaypoint(waypoint)}
              armNavigateId={armNavigateWaypointId}
              onEdit={waypointsController.onOpenEditWaypoint}
              onDelete={waypointsController.onDeleteWaypoint}
              onClose={closeWaypointsPanel}
              onBack={backFromWaypointsPanel}
            />

            {#snippet fallback(_error, reset)}
              <LazyPanelState
                title="Waypoints"
                closeLabel="Close waypoints panel"
                state="error"
                message="Waypoints controls stopped unexpectedly."
                onClose={closeWaypointsPanel}
                onBack={backFromWaypointsPanel}
                onRetry={reset}
              />
            {/snippet}
          </ErrorBoundary>
        {:catch}
          <LazyPanelState
            title="Waypoints"
            closeLabel="Close waypoints panel"
            state="error"
            message="Waypoints controls could not load."
            onClose={closeWaypointsPanel}
            onBack={backFromWaypointsPanel}
            onRetry={retryLazyPanel}
          />
        {/await}
      {:else if activePanel === 'tides'}
        {#await forAttempt(loadTidesPanel)}
          <LazyPanelState
            title="Tides and currents"
            closeLabel="Close tides panel"
            state="loading"
            message="Loading Tides controls…"
            onClose={closePanel}
            onBack={tidesOpenedFrom === 'menu' ? backToMenu : undefined}
          />
        {:then module}
          <ErrorBoundary>
            <module.default
              store={tidesStore}
              controller={tidesController}
              {units}
              stationsShown={layerSettings[TIDES_OVERLAY_ID]?.visible ?? false}
              onToggleStations={(shown) => setLayerVisible(TIDES_OVERLAY_ID, shown)}
              onClose={closePanel}
              onBack={tidesOpenedFrom === 'menu' ? backToMenu : undefined}
            />

            {#snippet fallback(_error, reset)}
              <LazyPanelState
                title="Tides and currents"
                closeLabel="Close tides panel"
                state="error"
                message="Tides controls stopped unexpectedly."
                onClose={closePanel}
                onBack={tidesOpenedFrom === 'menu' ? backToMenu : undefined}
                onRetry={reset}
              />
            {/snippet}
          </ErrorBoundary>
        {:catch}
          <LazyPanelState
            title="Tides and currents"
            closeLabel="Close tides panel"
            state="error"
            message="Tides controls could not load. Check the connection, then retry."
            onClose={closePanel}
            onBack={tidesOpenedFrom === 'menu' ? backToMenu : undefined}
            onRetry={retryLazyPanel}
          />
        {/await}
      {:else if activePanel === 'trends'}
        {#await forAttempt(loadTrendsPanel)}
          <LazyPanelState
            title="Data trends"
            closeLabel="Close trends, return to chart"
            state="loading"
            message="Loading Data trends controls…"
            onClose={closeTrendsPanel}
            onBack={backFromTrendsPanel}
            backLabel={trends.focusedId !== undefined
              ? 'Back to instrument details'
              : 'Back to menu'}
          />
        {:then module}
          <ErrorBoundary>
            <module.default
              controller={trends}
              onRetryProvider={onRetryHistoryProviders}
              mode={units.mode}
              theme={theme.theme}
              onClose={closeTrendsPanel}
              onBack={backFromTrendsPanel}
            />

            {#snippet fallback(_error, reset)}
              <LazyPanelState
                title="Data trends"
                closeLabel="Close trends, return to chart"
                state="error"
                message="Data trends controls stopped unexpectedly."
                onClose={closeTrendsPanel}
                onBack={backFromTrendsPanel}
                backLabel={trends.focusedId !== undefined
                  ? 'Back to instrument details'
                  : 'Back to menu'}
                onRetry={reset}
              />
            {/snippet}
          </ErrorBoundary>
        {:catch}
          <LazyPanelState
            title="Data trends"
            closeLabel="Close trends, return to chart"
            state="error"
            message="Data trends controls could not load."
            onClose={closeTrendsPanel}
            onBack={backFromTrendsPanel}
            backLabel={trends.focusedId !== undefined
              ? 'Back to instrument details'
              : 'Back to menu'}
            onRetry={retryLazyPanel}
          />
        {/await}
      {:else if activePanel === 'ais'}
        {#await forAttempt(loadAisListPanel)}
          <LazyPanelState
            title="Nearby vessels (AIS)"
            closeLabel="Close nearby vessels"
            state="loading"
            message="Loading AIS targets…"
            onClose={closePanel}
            onBack={backToMenu}
          />
        {:then module}
          <ErrorBoundary>
            <module.default
              {units}
              {aisTargets}
              {vessel}
              {clock}
              {collision}
              selectedId={selectedAisId}
              onSelect={onAisSelect}
              connectionPhase={store.connection.phase}
              onLocate={flyToPosition}
              onClose={closePanel}
              onBack={backToMenu}
            />

            {#snippet fallback(_error, reset)}
              <LazyPanelState
                title="Nearby vessels (AIS)"
                closeLabel="Close nearby vessels"
                state="error"
                message="AIS targets stopped unexpectedly."
                onClose={closePanel}
                onBack={backToMenu}
                onRetry={reset}
              />
            {/snippet}
          </ErrorBoundary>
        {:catch}
          <LazyPanelState
            title="Nearby vessels (AIS)"
            closeLabel="Close nearby vessels"
            state="error"
            message="AIS targets could not load."
            onClose={closePanel}
            onBack={backToMenu}
            onRetry={retryLazyPanel}
          />
        {/await}
      {:else if activePanel === 'poi-search'}
        {#await forAttempt(loadPoiSearchPanel)}
          <LazyPanelState
            title="Find places"
            closeLabel="Close find places"
            state="loading"
            message="Loading Find places controls…"
            onClose={closePoiSearch}
            onBack={backFromPoiSearch}
          />
        {:then module}
          <ErrorBoundary>
            <module.default
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

            {#snippet fallback(_error, reset)}
              <LazyPanelState
                title="Find places"
                closeLabel="Close find places"
                state="error"
                message="Find places controls stopped unexpectedly."
                onClose={closePoiSearch}
                onBack={backFromPoiSearch}
                onRetry={reset}
              />
            {/snippet}
          </ErrorBoundary>
        {:catch}
          <LazyPanelState
            title="Find places"
            closeLabel="Close find places"
            state="error"
            message="Find places controls could not load."
            onClose={closePoiSearch}
            onBack={backFromPoiSearch}
            onRetry={retryLazyPanel}
          />
        {/await}
      {:else if activePanel === 'anchor'}
        {#await forAttempt(loadAnchorPanel)}
          <LazyPanelState
            title="Anchor watch"
            closeLabel="Close anchor watch"
            state="loading"
            message="Loading Anchor watch controls…"
            onClose={closePanel}
            onBack={backToMenu}
          />
        {:then module}
          <ErrorBoundary>
            <module.default
              {auth}
              {units}
              {anchor}
              {vessel}
              error={anchorController.anchorError}
              busy={anchorController.busy}
              onDrop={() => void anchorController.onDrop()}
              onRaise={() => void anchorController.onRaise()}
              onSetRadius={(meters) => void anchorController.onSetRadius(meters)}
              {audioState}
              onClose={closePanel}
              onBack={backToMenu}
            />

            {#snippet fallback(_error, reset)}
              <LazyPanelState
                title="Anchor watch"
                closeLabel="Close anchor watch"
                state="error"
                message="Anchor watch controls stopped unexpectedly."
                onClose={closePanel}
                onBack={backToMenu}
                onRetry={reset}
              />
            {/snippet}
          </ErrorBoundary>
        {:catch}
          <LazyPanelState
            title="Anchor watch"
            closeLabel="Close anchor watch"
            state="error"
            message="Anchor watch controls could not load."
            onClose={closePanel}
            onBack={backToMenu}
            onRetry={retryLazyPanel}
          />
        {/await}
      {:else if activePanel === 'alarms'}
        {#await forAttempt(loadAlarmsPanel)}
          <LazyPanelState
            title="Alarms"
            closeLabel="Close alarms panel"
            state="loading"
            message="Loading Alarms controls…"
            onClose={closePanel}
            onBack={backToMenu}
          />
        {:then module}
          <ErrorBoundary>
            <module.default
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
              {audioState}
              shallow={shallowMonitor}
              onClose={closePanel}
              onBack={backToMenu}
            />

            {#snippet fallback(_error, reset)}
              <LazyPanelState
                title="Alarms"
                closeLabel="Close alarms panel"
                state="error"
                message="Alarms controls stopped unexpectedly."
                onClose={closePanel}
                onBack={backToMenu}
                onRetry={reset}
              />
            {/snippet}
          </ErrorBoundary>
        {:catch}
          <LazyPanelState
            title="Alarms"
            closeLabel="Close alarms panel"
            state="error"
            message="Alarms controls could not load."
            onClose={closePanel}
            onBack={backToMenu}
            onRetry={retryLazyPanel}
          />
        {/await}
      {:else if activePanel === 'help'}
        {#await forAttempt(loadHelpPanel)}
          <LazyPanelState
            title="Help and helm setup"
            closeLabel="Close help"
            state="loading"
            message="Loading Help…"
            onClose={closePanel}
            onBack={backToMenu}
          />
        {:then module}
          <ErrorBoundary>
            <module.default
              firstRun={helpFirstRun}
              onDismissOrientation={dismissHelpOrientation}
              writeBlocked={auth.writeBlocked}
              requestingWrite={auth.upgrading}
              onRequestWrite={() => void auth.requestWriteAccess()}
              writeOutcome={auth.upgradeOutcome}
              chartOn={layersView !== undefined && hasVisibleNavigationChart(layersView.items)}
              gpsSeen={vessel.positionReceived}
              savedDataProvisioned={waypointsController.provisioning === 'unknown'
                ? undefined
                : waypointsController.provisioning === 'provisioned'}
              {audioBlocked}
              onEnableSound={enableAlarmSound}
              onOpenLayers={() => openLayersPanel('charts')}
              onOpenProfiles={openProfilesPanel}
              onOpenAlarms={openAlarmsPanel}
              onResetHints={resetChartHints}
              onClose={closePanel}
              onBack={backToMenu}
            />

            {#snippet fallback(_error, reset)}
              <LazyPanelState
                title="Help and helm setup"
                closeLabel="Close help"
                state="error"
                message="Help stopped unexpectedly."
                onClose={closePanel}
                onBack={backToMenu}
                onRetry={reset}
              />
            {/snippet}
          </ErrorBoundary>
        {:catch}
          <LazyPanelState
            title="Help and helm setup"
            closeLabel="Close help"
            state="error"
            message="Help could not load."
            onClose={closePanel}
            onBack={backToMenu}
            onRetry={retryLazyPanel}
          />
        {/await}
      {:else if activePanel === 'handoff'}
        {#await forAttempt(loadHandoffPanel)}
          <LazyPanelState
            title="Watch handoff"
            closeLabel="Close watch handoff"
            state="loading"
            message="Loading Watch handoff…"
            onClose={closePanel}
            onBack={backToMenu}
          />
        {:then module}
          <ErrorBoundary>
            <module.default controller={handoff} onClose={closePanel} onBack={backToMenu} />

            {#snippet fallback(_error, reset)}
              <LazyPanelState
                title="Watch handoff"
                closeLabel="Close watch handoff"
                state="error"
                message="Watch handoff stopped unexpectedly."
                onClose={closePanel}
                onBack={backToMenu}
                onRetry={reset}
              />
            {/snippet}
          </ErrorBoundary>
        {:catch}
          <LazyPanelState
            title="Watch handoff"
            closeLabel="Close watch handoff"
            state="error"
            message="Watch handoff could not load."
            onClose={closePanel}
            onBack={backToMenu}
            onRetry={retryLazyPanel}
          />
        {/await}
      {:else if activePanel === 'regions' && companionBase !== null && mapInstance}
        {#await forAttempt(loadRegionsPanel)}
          <LazyPanelState
            title="Offline charts"
            closeLabel="Close offline charts"
            state="loading"
            message="Loading Offline charts controls…"
            onClose={closePanel}
            onBack={backToMenu}
          />
        {:then module}
          <ErrorBoundary>
            <module.default
              adminAccess={chartLockerAdminAccess}
              {pwaStatus}
              accessUrl={chartLockerAccessUrl}
              accessState={chartLockerState}
              map={mapInstance}
              {units}
              {companionBase}
              activeRoute={activeRouteForCoverage}
              onCoverageReport={onRouteCoverageReport}
              onClose={closePanel}
              onBack={backToMenu}
              onOpenCharts={openInstalledCharts}
              onRetryAccess={onRetryChartLocker}
            />

            {#snippet fallback(_error, reset)}
              <LazyPanelState
                title="Offline charts"
                closeLabel="Close offline charts"
                state="error"
                message="Offline charts controls stopped unexpectedly."
                onClose={closePanel}
                onBack={backToMenu}
                onRetry={reset}
              />
            {/snippet}
          </ErrorBoundary>
        {:catch}
          <LazyPanelState
            title="Offline charts"
            closeLabel="Close offline charts"
            state="error"
            message="Offline charts controls could not load."
            onClose={closePanel}
            onBack={backToMenu}
            onRetry={retryLazyPanel}
          />
        {/await}
      {:else if activePanel === 'charts-management' && companionBase !== null}
        {#await forAttempt(loadChartsManagementPanel)}
          <LazyPanelState
            title="Installed charts"
            closeLabel="Close installed charts panel"
            state="loading"
            message="Loading Installed charts controls…"
            onClose={closePanel}
            onBack={backToOfflineCharts}
            backLabel="Back to offline charts"
          />
        {:then module}
          <ErrorBoundary>
            <module.default
              adminAccess={chartLockerAdminAccess}
              accessUrl={chartLockerAccessUrl}
              accessState={chartLockerState}
              {companionBase}
              onClose={closePanel}
              onBack={backToOfflineCharts}
              onRetryAccess={onRetryChartLocker}
            />

            {#snippet fallback(_error, reset)}
              <LazyPanelState
                title="Installed charts"
                closeLabel="Close installed charts panel"
                state="error"
                message="Installed charts controls stopped unexpectedly."
                onClose={closePanel}
                onBack={backToOfflineCharts}
                backLabel="Back to offline charts"
                onRetry={reset}
              />
            {/snippet}
          </ErrorBoundary>
        {:catch}
          <LazyPanelState
            title="Installed charts"
            closeLabel="Close installed charts panel"
            state="error"
            message="Installed charts controls could not load."
            onClose={closePanel}
            onBack={backToOfflineCharts}
            backLabel="Back to offline charts"
            onRetry={retryLazyPanel}
          />
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
        minimize={{
          collapsed: radarMinimize.collapsed,
          onToggle: radarMinimize.onToggle,
        }}
        onClose={() => requestRadarPanelAction({ kind: 'close' })}
        onBack={radarOpenedFrom === 'menu'
          ? () => requestRadarPanelAction({ kind: 'back' })
          : undefined}
        footer={marineRadar.store.areaDraft?.chartEditing ? radarPlacementFooter : undefined}
      >
        {#await forAttempt(loadRadarControls)}
          <div class="panel-loading" role="status">Loading radar controls…</div>
        {:then module}
          <ErrorBoundary>
            <module.default
              store={marineRadar.store}
              unitsMode={units.mode}
              onSetControl={(id, value) => void marineRadar.setControl(id, { value })}
              onSetAuto={(id, auto) => void marineRadar.setControl(id, { auto })}
              onSetAreaControl={(id, value) => void marineRadar.setStructuredControl(id, value)}
              onSetAreaDraft={marineRadar.setAreaDraft}
              onStartAreaChartEdit={startRadarAreaChartEdit}
              onStopAreaChartEdit={marineRadar.stopAreaChartEdit}
              onSelectRadar={(id) => requestRadarPanelAction({ kind: 'select', radarId: id })}
              onSetPower={onSetRadarPower}
              echoShown={radarEchoShown}
              onToggleEcho={(shown) => setLayerVisible(MARINE_RADAR_OVERLAY_ID, shown)}
              discardRequested={radarDiscardRequested}
              onDraftDirtyChange={(dirty) => (radarDraftDirty = dirty)}
              onDiscardResolved={resolveRadarDraftDiscard}
              onOpenOverlaySettings={layersView
                ? () => requestRadarPanelAction({ kind: 'overlays' })
                : undefined}
            />

            {#snippet fallback(_error, reset)}
              <div class="panel-load-error" role="alert">
                Radar controls stopped unexpectedly.
                <button type="button" class="btn btn-ghost" onclick={reset}>Retry</button>
              </div>
            {/snippet}
          </ErrorBoundary>
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
    {#await forAttempt(loadWeatherMap)}
      <div class="panel-loading panel-loading--cover" tabindex="-1" use:dialog={closeWeatherPanel}>
        <span role="status">Loading weather view…</span>
        <div class="panel-controls">
          <button type="button" class="btn btn-ghost" onclick={backFromWeatherPanel}>
            Back to menu
          </button>
          <button type="button" class="btn btn-ghost" onclick={closeWeatherPanel}>Close</button>
        </div>
      </div>
    {:then module}
      <ErrorBoundary>
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
          routes={routeStore}
          position={vessel.position}
          positionStale={vessel.positionStale}
          pointLoader={pointConditionsLoader}
          online={net.online}
          onClose={closeWeatherPanel}
          onBack={backFromWeatherPanel}
        />

        {#snippet fallback(_error, reset)}
          <div
            class="panel-load-error panel-load-error--cover"
            role="alert"
            tabindex="-1"
            use:dialog={closeWeatherPanel}
          >
            Weather view stopped unexpectedly.
            <button type="button" class="btn btn-ghost" onclick={reset}>Retry</button>
            <button type="button" class="btn btn-ghost" onclick={backFromWeatherPanel}>
              Back to menu
            </button>
            <button type="button" class="btn btn-ghost" onclick={closeWeatherPanel}>Close</button>
          </div>
        {/snippet}
      </ErrorBoundary>
    {:catch}
      <div
        class="panel-load-error panel-load-error--cover"
        role="alert"
        tabindex="-1"
        use:dialog={closeWeatherPanel}
      >
        Weather view could not load.
        <button type="button" class="btn btn-ghost" onclick={retryLazyPanel}>Retry</button>
        <button type="button" class="btn btn-ghost" onclick={backFromWeatherPanel}>
          Back to menu
        </button>
        <button type="button" class="btn btn-ghost" onclick={closeWeatherPanel}>Close</button>
      </div>
    {/await}
  {/if}
</section>

<style>
.chart-host {
  position: relative;
  block-size: 100%;
}
.radar-placement-instruction {
  flex: 1;
  min-inline-size: 12rem;
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
/* A wrapped action row centers under this centered banner rather than hanging at the inline start.
   The width cap is load-bearing, not cosmetic: as a flex row the banner's max-content is its text
   plus every button on one line, so a bare fit-content resolves to the whole stack width and the
   banner reaches across a docked panel, swallowing that panel's controls. The stack's contract is
   that each banner stays a content-sized box, and 32rem keeps the text on one line while leaving
   an edge-docked panel (22rem) clear at desktop widths. */
.toast-banner.action-note {
  justify-content: center;
  max-inline-size: min(32rem, calc(100% - var(--space-6)));
}
.toast-banner {
  pointer-events: auto;
  inline-size: fit-content;
  max-inline-size: calc(100% - var(--space-6));
  padding: var(--space-2) var(--space-4);
  box-shadow: var(--shadow-overlay);
}
/* The review, navigation, and tool strips scroll in their own capped tier; the emergency rail
   below is a separate uncapped surface, so a pileup here can never clip MOB, collision, or anchor
   actions. */
.bottom-stack {
  position: absolute;
  inset-block-end: calc(var(--space-3) + var(--rail-clearance, 0px));
  inset-inline: var(--space-3);
  inline-size: min(calc(28rem + 2 * var(--space-3)), calc(100% - 2 * var(--space-3)));
  margin-inline: auto;
  max-block-size: min(calc(60 * var(--dvh)), calc(100% - 2 * var(--space-3)));
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  overflow: hidden;
  pointer-events: auto;
  z-index: var(--z-safety-strips);
}
.secondary-strips {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  inline-size: 100%;
  min-block-size: 0;
  overflow-y: auto;
}
.bottom-stack.above-weather {
  inset-block-end: calc(var(--control-size) + 2 * var(--space-2) + var(--weather-panel-height));
}
/* The emergency rail: viewport-fixed at the reachable bottom edge, deliberately without a height
   cap or overflow clipping, and NOT lifted while Forecast is open; it stacks above the Forecast
   panel instead, so safety chrome is never displaced off-screen. The status strip below the chart
   host absorbs the bottom safe-area inset, and the inline insets absorb the side ones. */
.safety-rail {
  position: absolute;
  inset-block-end: var(--space-3);
  inset-inline: calc(var(--space-3) + env(safe-area-inset-left, 0px))
    calc(var(--space-3) + env(safe-area-inset-right, 0px));
  inline-size: min(calc(28rem + 2 * var(--space-3)), calc(100% - 2 * var(--space-3)));
  max-inline-size: calc(
    100% -
    2 *
    var(--space-3) -
    env(safe-area-inset-left, 0px) -
    env(safe-area-inset-right, 0px)
  );
  margin-inline: auto;
  pointer-events: auto;
  z-index: var(--z-safety-strips);
}
</style>
