<script lang="ts">
import Anchor from '@lucide/svelte/icons/anchor';
import Bell from '@lucide/svelte/icons/bell';
import ChartLine from '@lucide/svelte/icons/chart-line';
import CircleHelp from '@lucide/svelte/icons/circle-help';
import ClipboardList from '@lucide/svelte/icons/clipboard-list';
import CloudSun from '@lucide/svelte/icons/cloud-sun';
import Compass from '@lucide/svelte/icons/compass';
import DownloadCloud from '@lucide/svelte/icons/download-cloud';
import ExternalLink from '@lucide/svelte/icons/external-link';
import Gauge from '@lucide/svelte/icons/gauge';
import History from '@lucide/svelte/icons/history';
import Layers from '@lucide/svelte/icons/layers';
import LocateFixed from '@lucide/svelte/icons/locate-fixed';
import MapPin from '@lucide/svelte/icons/map-pin';
import Menu from '@lucide/svelte/icons/menu';
import Navigation from '@lucide/svelte/icons/navigation';
import Radar from '@lucide/svelte/icons/radar';
import Route from '@lucide/svelte/icons/route';
import Ruler from '@lucide/svelte/icons/ruler';
import Search from '@lucide/svelte/icons/search';
import Ship from '@lucide/svelte/icons/ship';
import Spline from '@lucide/svelte/icons/spline';
import UserCog from '@lucide/svelte/icons/user-cog';
import VolumeX from '@lucide/svelte/icons/volume-x';
import Waves from '@lucide/svelte/icons/waves';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { onDestroy, onMount, untrack } from 'svelte';
import { AisTargets } from '$entities/ais';
import { AnchorWatch } from '$entities/anchor';
import { CollisionAssessment } from '$entities/collision';
import { CourseGuidance } from '$entities/course';
import { type HandoffSnapshot, isHandoffSnapshot } from '$entities/handoff';
import { DEFAULT_TREND_INSTRUMENT_IDS } from '$entities/instrument-trend';
import { MeasureStore } from '$entities/measure';
import { MobStore } from '$entities/mob';
import { NotificationsStore } from '$entities/notifications';
import { PersonalNotesStore } from '$entities/poi';
import {
  MAX_PROFILES,
  type ProfileSettings,
  ProfileStore,
  SignalKProfileAdapter,
} from '$entities/profile';
import {
  routeDistanceToGoMeters as calculateRouteDistanceToGoMeters,
  RouteStore,
} from '$entities/route';
import { SymbolsStore } from '$entities/symbols';
import { TidesStore } from '$entities/tides';
import { type TrackPoint, TrackRecorder } from '$entities/track';
import { UnitsStore } from '$entities/units';
import { cleanUserChartSource, type UserChartSource, UserCharts } from '$entities/user-charts';
import { OwnVessel } from '$entities/vessel';
import { WaypointsStore } from '$entities/waypoint';
import { WeatherStore } from '$entities/weather';
import { loadAisListPanel } from '$features/ais-list';
import { ANCHOR_TONE, createAnchorController } from '$features/anchor-watch';
import { createUserChartsController } from '$features/charts';
import { NOAA_ENC_SOURCE_ID, shouldOfferNoaaEnc } from '$features/depth-charts';
import { createHandoffClient, createHandoffController } from '$features/handoff';
import {
  createInstrumentsController,
  DEFAULT_TILES,
  detectKip,
  KIP_URL,
  loadInstrumentsPanel,
} from '$features/instruments';
import type { LayersView } from '$features/layers-panel';
import {
  CollisionMute,
  createShallowController,
  GenericAlarm,
  isRaisedNotification,
  LookoutAlarm,
  worstRaisedNotification,
} from '$features/lookout';
import {
  createMarineRadarController,
  MARINE_RADAR_OVERLAY_ID,
  type RadarStatus,
  radarChartEditBlockedReason,
  radarHelmHealth,
} from '$features/marine-radar';
import { MEASURE_OVERLAY_ID } from '$features/measure';
import {
  AppMenu,
  DEFAULT_PINNED,
  type MenuItem,
  reorderPinned,
  resolvePinned,
  togglePinned,
} from '$features/menu';
import { createMobController, MOB_TONE, MobButton } from '$features/mob';
import { ARRIVAL_TONE, shouldSoundArrivalAlarm } from '$features/navigation';
import {
  createNoteDetailLoader,
  createPersonalNotesController,
  loadPersonalNoteDialog,
  type NoteDetailLoader,
  type NotePoint,
  type NoteSelection,
  type PoiViewState,
} from '$features/notes';
import type { Poi } from '$features/poi-search';
import { CompanionStatus, type RouteCoverageReport } from '$features/prewarm';
import {
  createProfileBindings,
  createProfilesController,
  downloadProfileJson,
  type ImportedProfile,
  loadProfilesPanel,
  ProfileSwitcher,
} from '$features/profiles';
import { createRouteController } from '$features/routing';
import { ThemeToggle } from '$features/theme-toggle';
import {
  createTidesController,
  createTidesLoader,
  fetchSignalkTidesReading,
  loadTidesPanel,
  SIGNALK_TIDES_PLUGIN_ID,
  TIDES_OVERLAY_ID,
  type TideStationSelectionEvent,
} from '$features/tides';
import { createTimeTravelController } from '$features/time-travel';
import { createTrackController } from '$features/tracks';
import { createTrendsController } from '$features/trends';
import { createWaypointsController, WaypointDialog } from '$features/waypoints';
import {
  createPointConditionsLoader,
  createWeatherLoader,
  defaultProvider,
  fetchWeatherProviders,
  WEATHER_LAYER_IDS,
  type WeatherProvider,
} from '$features/weather';
import {
  AlarmAudioGate,
  AlarmCoordinator,
  alarmAudioPrimed,
  GatedAlarm,
  primeAlarmAudio,
} from '$shared/audio';
import {
  type Bbox4,
  bboxContainsPoint,
  boundsOfPoints,
  type LatLon,
  padBbox,
  quantizeViewCellKey,
} from '$shared/geo';
import {
  Clock,
  createMediaQuery,
  formatClockTime,
  HeldFlag,
  hasControlCharacters,
  isRecord,
  Toast,
} from '$shared/lib';
import type { CompanionProbeResult, LayerSettings } from '$shared/map';
import { DEFAULT_OVERLAY_STATE, probeCompanion } from '$shared/map';
import { binnacleStorageKey } from '$shared/persistence';
import {
  BINNACLE_PRIVACY_CHANNEL,
  createBinnaclePrivacyRegistry,
  createBroadcastChannelBroadcaster,
  DevicePrivacyController,
  type EraseSafetyDecision,
  PrivacyActivityCoordinator,
  type PrivacyReport,
} from '$shared/privacy';
import { OnlineStatus, registerPwa } from '$shared/pwa';
import {
  booleanPersistedCodec,
  booleanRecordPersistedCodec,
  CHART_ORIENTATION_MODES,
  type ChartOrientationMode,
  createMapView,
  createPersistedCodec,
  createPlanningSpeed,
  createThresholds,
  createTrackSettings,
  enumPersistedCodec,
  isMapView,
  type MapView,
  type PersistedCodec,
  PersistedValue,
  stringArrayPersistedCodec,
} from '$shared/settings';
import type { ConnectionPhase, HistoryProviders } from '$shared/signalk';
import {
  AuthController,
  adminLoginUrl,
  createSignalKClient,
  fetchHistoryProviders,
  fetchServerFeatures,
  fetchSymbols,
  isConnectionDown,
  isConnectionOpen,
  recentSourceRefs,
  SELF_CONTEXT,
  type ServerFeatures,
  SignalKStore,
  SK_PATHS,
  serverOrigin,
  setWriteOutcomeListener,
} from '$shared/signalk';
import { createTrackStore } from '$shared/storage';
import {
  createThemeController,
  defaultSaveName,
  dialog,
  ErrorBoundary,
  LazyPanelState,
  PanelHeader,
  type PanelId,
  type Theme,
  trapFocus,
} from '$shared/ui';
import type { MapCommands } from '$widgets/chart-canvas';
import { PlotterView } from '../views';
import ChartLockerStatus from './ChartLockerStatus.svelte';
import { resolveOrientation } from './chart-orientation';
import { createFollowController } from './follow-controller.svelte';
import { collectHandoffFacts } from './handoff-facts';
import LiveRegions from './LiveRegions.svelte';
import { createNotificationsController } from './notifications-controller.svelte';
import StatusStrip from './StatusStrip.svelte';
import { createSafetyAnnunciator } from './safety-annunciator.svelte';
import { createStreamController } from './stream-controller.svelte';

// serverOrigin reads location, fixed for the page lifetime: capture once, not at every call site.
const origin = serverOrigin();
const chartLockerAccessUrl = adminLoginUrl(
  origin,
  `${location.pathname}${location.search}${location.hash}`,
);

const store = new SignalKStore();
// A one-second reactive clock drives every staleness check (a frozen GPS fix, a dropped feed), so
// they re-evaluate even while no data arrives. Disposed on teardown.
const clock = new Clock();
// Alarm audio readiness on the reactive clock. Every surface that can sound renders the grade as
// its own note: the status strip deliberately carries none, because a readout row is not where a
// browser-permission condition belongs, and on a boat with nothing audible armed the chip stated a
// silence that could not happen while costing the readouts a whole wrapped row.
const alarmAudioGate = new AlarmAudioGate(clock);
const audioState = $derived(alarmAudioGate.state);
const audioBlocked = $derived(alarmAudioGate.blocked);
const vessel = new OwnVessel(store, clock);
const aisTargets = new AisTargets(store);
// A worker that dies after connect fires no Comlink settle; the failure callback routes it into
// the stream controller's error state, whose retry restarts the worker. Deferred through a closure
// because the controller is constructed further down; the callback can only fire after connect.
const client = createSignalKClient(() => streamController.onWorkerFailure());
const auth = new AuthController(origin);
// The token in the shape the REST clients expect (string | undefined, not the controller's
// string | null), and whether access has resolved (an authenticated session or an unsecured server),
// derived once rather than re-spelled at every call site and effect guard.
const authToken = $derived(auth.token ?? undefined);
const accessResolved = $derived(auth.status === 'authenticated' || auth.status === 'unsecured');
const net = new OnlineStatus();
const thresholds = createThresholds();
// Anchored own vessel treats moored and swinging boats as non-hazards, silencing the busy-anchorage
// nuisance; the callback reads anchor (constructed below) lazily, only from inside the assessment.
const collision = new CollisionAssessment(vessel, aisTargets, thresholds, () => anchor.watching);
// Every Binnacle-owned tone routes through one coordinator, so simultaneous alarms cannot sum at
// the speaker and priority is deterministic: MOB and an escalating close-quarters collision are
// co-equal and interleave; emergency outranks alarm; arrival is a courtesy that never preempts a
// safety condition. Silencing stays at each call site.
const alarmCoordinator = new AlarmCoordinator();
const lookoutAlarm = new LookoutAlarm(
  alarmCoordinator.channel({ id: 'collision', rank: () => (collision.escalating ? 0 : 1) }),
);
// The collision mute is session-only with a bounded auto-expiring window (see CollisionMute): a mute
// set in a crowded anchorage must never carry silently into the next passage or across a reload, and
// a close, imminent contact escalates past it. Deliberately not a PersistedValue and not part of a
// profile bundle.
const collisionMute = new CollisionMute(clock);
// Server capability discovery: gates the v2 Notifications transport below; an older server
// falls back to the raw v1 delta publish.
let serverFeatures = $state<ServerFeatures | undefined>();
// Whether the KIP instrument webapp is installed on the server, so the menu can explain the missing
// capability instead of hiding the external launcher.
type ProviderProbeState = 'checking' | 'retrying' | 'available' | 'absent' | 'failed';
let kipPresent = $state<boolean | undefined>();
let kipProbeState = $state<ProviderProbeState>('checking');
let historyProviders = $state<HistoryProviders | undefined>();
let historyProviderState = $state<ProviderProbeState>('checking');
let historyProbeGeneration = 0;
const notificationsApi = $derived(serverFeatures?.apis.has('notifications') ?? false);

async function probeKip(retrying = false): Promise<void> {
  kipProbeState = retrying ? 'retrying' : 'checking';
  const present = await detectKip(origin, authToken);
  kipPresent = present;
  kipProbeState = present === undefined ? 'failed' : present ? 'available' : 'absent';
}

async function probeHistoryProviders(
  retrying = false,
  refreshOpenInstruments = false,
): Promise<void> {
  const generation = ++historyProbeGeneration;
  historyProviderState = retrying ? 'retrying' : 'checking';
  // This helper runs synchronously inside the auth effect. Keep the state it updates out of that
  // effect's dependency set, or assigning a fresh provider result retriggers the probe forever.
  const previousIds = untrack(() => historyProviders?.ids.join('\u0000') ?? '');
  const providers = await fetchHistoryProviders(origin, authToken);
  if (generation !== historyProbeGeneration) return;
  historyProviders = providers;
  historyProviderState =
    providers === undefined ? 'failed' : providers.ids.length > 0 ? 'available' : 'absent';
  const providerIdsChanged = (providers?.ids.join('\u0000') ?? '') !== previousIds;
  if (
    (refreshOpenInstruments || providerIdsChanged) &&
    untrack(() => instruments.open || trends.open)
  ) {
    // The refresh reads the provider state we just assigned. Keep those controller reads out of
    // any effect that initiated this async probe, or the probe becomes its own dependency.
    untrack(() => instruments.refreshCatalog());
  }
}

// Every notifications.* path on the stream, mirrored for the Alarms panel's active-alert list:
// engine, NMEA2000, autopilot, and plugin alarms all surface without Binnacle knowing any of them.
const notificationsStore = new NotificationsStore(store);

// The anchor watch: server-driven when the anchoralarm plugin answers, client-side otherwise. The
// drag alarm mirrors the collision split: an audible tone here, the strip and live region below.
const anchor = new AnchorWatch(store, vessel, clock);
const anchorAlarm = new GatedAlarm(
  ANCHOR_TONE,
  alarmCoordinator.channel({ id: 'anchor', rank: () => 1 }),
);

// Man overboard: one tap on the strip button marks the spot, publishes the boat-wide alarm, and
// raises the recovery strip; a remote station's notifications.mob raises it here too.
const mob = new MobStore(store, vessel, clock);
const mobAlarm = new GatedAlarm(MOB_TONE, alarmCoordinator.channel({ id: 'mob', rank: () => 0 }));

// The measure tool: armed from the menu, fed by chart taps, read by its overlay and strip.
const measure = new MeasureStore();

// Track recording: client-side from navigation.position, persisted whole-voyage in IndexedDB.
const trackSettings = createTrackSettings();
let trackPersistenceDegraded = $state(false);
const recorder = new TrackRecorder(
  trackSettings,
  createTrackStore<TrackPoint>(globalThis.indexedDB, () => {
    trackPersistenceDegraded = true;
  }),
);

// Routes: planned and stored as Signal K resources, drawn by the route overlay, edited on the chart.
const routeStore = new RouteStore();
// Active-navigation guidance: prefers the server Course API and computes the derived values
// client-side when the calcValues provider is absent. The arrival alarm sounds at the waypoint.
const courseGuidance = new CourseGuidance(store, vessel, clock);
const arrivalAlarm = new GatedAlarm(
  ARRIVAL_TONE,
  alarmCoordinator.channel({ id: 'arrival', rank: () => 5, courtesy: true }),
);
const arrivalMuted = new PersistedValue<boolean>(
  binnacleStorageKey('arrivalMuted'),
  false,
  undefined,
  booleanPersistedCodec,
);

// The first-run orientation: shown once per device after the shell is usable, dismissible from
// the Help panel, and reopenable there forever. Closing the auto-opened Help also counts as
// dismissal, so the orientation is skippable without hunting for the button.
const helpOrientationSeen = new PersistedValue<boolean>(
  binnacleStorageKey('helpOrientation'),
  false,
  undefined,
  booleanPersistedCodec,
);

function resetChartHints(): void {
  try {
    localStorage.removeItem(binnacleStorageKey('chartActionsHint'));
  } catch {
    // Storage unavailable (private mode): the hint state never persisted anyway.
  }
}
// The speed used to turn a planned route's distance into per-waypoint passage times. Stored in SI
// (m/s), migrating a pre-SI device's knots on first read; the route plan converts at its field.
const planningSpeedMps = createPlanningSpeed();

// Whole-route distance still to run across the legs ahead, for the passage arrival readout. Only when
// a multi-leg route is active and more than the current leg remains, so a single "go to" or the final
// leg leaves it undefined and the strip shows just the per-leg numbers. Kept separate from the time so
// the geodesy walk re-runs on a waypoint or route change, not on every SOG tick.
const routeDistanceToGoMeters = $derived.by<number | undefined>(() => {
  const idx = courseGuidance.activePointIndex;
  const total = courseGuidance.activePointTotal;
  const toNext = courseGuidance.distanceToNextMeters;
  const id = routeStore.activeId;
  if (id == null || idx == null || total == null || toNext == null || total - idx <= 1) {
    return undefined;
  }
  const route = routeStore.routeById(id);
  if (!route || total !== route.waypoints.length || idx >= route.waypoints.length) return undefined;
  return calculateRouteDistanceToGoMeters(
    route.waypoints,
    idx,
    toNext,
    courseGuidance.routeReversed,
  );
});

// Tides and tidal currents from NOAA CO-OPS (US waters). The store feeds the panel and the nearest
// station markers; the loader caches the station lists and predictions for the session.
const tidesStore = new TidesStore();
// Tide data prefers the signalk-tides plugin when the server runs it (worldwide coverage from
// its configured source), falling back to NOAA CO-OPS exactly as before; a stock server never
// sees a plugin call.
const tidesLoader = createTidesLoader({
  pluginAvailable: () => serverFeatures?.plugins.has(SIGNALK_TIDES_PLUGIN_ID) ?? false,
  pluginTides: (lat, lon) => fetchSignalkTidesReading(lat, lon, { origin, token: chartsToken }),
});

// Weather forecast, fetched browser-side from Open-Meteo. It lives in a dedicated mini-map panel
// (the Forecast button), not on the nav chart, so the chart stays clean and the weather can never
// be zoomed past its data resolution. The panel owns the fetch, keyed off its own viewport.
const weather = new WeatherStore();
// The cached weather loader (Open-Meteo plus RainViewer), constructed here and passed to the panel
// so it is swappable in tests and its in-memory cache lives for the session.
const weatherLoader = createWeatherLoader();
// The point-conditions loader, constructed once here (not per WeatherConditions mount) so reopening
// the weather panel reuses a single persisted-cache connection rather than opening a fresh one.
const pointConditionsLoader = createPointConditionsLoader();
let weatherPanelOpen = $state(false);
// The default Signal K weather provider's display name (for example AccuWeather), detected once the
// stream connects. When set, the weather panel prefers the provider for point data and falls back to
// the free grid; when undefined (no provider configured), the grid answers.
let weatherProvider = $state<WeatherProvider | undefined>();
// The panel's own weather-layer visibility, separate from the nav chart. Default wind and
// waves on so the first open shows something without hunting through toggles. The panel carries no
// persisted view of its own: it always opens where the nav chart is looking.
const layerSettingsCodec: PersistedCodec<LayerSettings> = {
  decode(value) {
    if (!isRecord(value)) return { state: 'invalid' };
    const entries = Object.entries(value);
    if (entries.length > 512) return { state: 'invalid' };
    const cleaned = Object.create(null) as LayerSettings;
    let migrated = Object.getPrototypeOf(value) !== Object.prototype;
    for (const [id, state] of entries) {
      if (
        id.length === 0 ||
        id.length > 256 ||
        id === '__proto__' ||
        id === 'prototype' ||
        id === 'constructor' ||
        hasControlCharacters(id) ||
        !isRecord(state) ||
        typeof state.visible !== 'boolean' ||
        typeof state.opacity !== 'number' ||
        !Number.isFinite(state.opacity) ||
        state.opacity < 0 ||
        state.opacity > 1
      ) {
        return { state: 'invalid' };
      }
      cleaned[id] = { visible: state.visible, opacity: state.opacity };
      migrated ||=
        Object.keys(state).length !== 2 ||
        !Object.hasOwn(state, 'visible') ||
        !Object.hasOwn(state, 'opacity');
    }
    return { state: migrated ? 'migrated' : 'valid', value: cleaned };
  },
};
const weatherLayerSettings = new PersistedValue<LayerSettings>(
  binnacleStorageKey('weatherLayers'),
  {
    [WEATHER_LAYER_IDS.wind]: { ...DEFAULT_OVERLAY_STATE },
    [WEATHER_LAYER_IDS.waves]: { visible: true, opacity: 0.7 },
  },
  undefined,
  layerSettingsCodec,
);

let layersView = $state<LayersView | undefined>();
// The edge-docked panels (routes, layers, tracks, collision thresholds) are mutually exclusive: one
// docks at the leading edge at a time. A single active-panel value enforces that structurally, so
// opening one closes whatever was open without each opener having to clear the others by hand.
let activePanel = $state<PanelId | null>(null);
let selectedAisId = $state<string | undefined>();
let selectedWaypointId = $state<string | undefined>();
let tidesOpenedFrom = $state<'menu' | 'chart'>('menu');
let profilesPanelAttempt = $state(0);
let personalNoteDialogAttempt = $state(0);
let instrumentsPanelAttempt = $state(0);
let layersInitialMode = $state<'charts' | 'overlays'>('charts');
// The hamburger's open state is owned here, not inside AppMenu, so a panel's back action can reopen
// the menu after it closed on selection.
let menuOpen = $state(false);
let menuEditing = $state(false);
// Closing a panel drops everything that panel put on the chart or armed inside it, so nothing it
// owned outlives it: a dismissed confirm cannot come back armed, and a hover ring cannot strand on
// the chart with no panel to clear it.
const closePanel = (): void => {
  if (activePanel === 'trends') {
    trends.setOpen(false);
    trends.setFocus(undefined);
    trendReturnInstrumentId = undefined;
  }
  if (activePanel === 'ais') selectedAisId = undefined;
  if (activePanel === 'waypoints') {
    selectedWaypointId = undefined;
    armNavigateWaypointId = undefined;
  }
  if (activePanel === 'poi-search') hoveredPoi = undefined;
  activePanel = null;
};
// Back returns to the menu: close the panel and reopen the hamburger in one update, so the navigator
// can move menu to panel to back to another panel without reopening the menu by hand. It delegates
// the teardown rather than restating it, so the two paths cannot drift.
const backToMenu = (): void => {
  closePanel();
  menuOpen = true;
};
function profilesPanelForAttempt() {
  void profilesPanelAttempt;
  return loadProfilesPanel();
}
function personalNoteDialogForAttempt() {
  void personalNoteDialogAttempt;
  return loadPersonalNoteDialog();
}
function instrumentsPanelForAttempt() {
  void instrumentsPanelAttempt;
  return loadInstrumentsPanel();
}
const openInstalledCharts = (): void => openPanel('charts-management');
const backToOfflineCharts = (): void => openPanel('regions');
// The phone breakpoint, in CSS pixels. A media query cannot reference this constant, so the same
// 600px literal is mirrored in the `@media (max-width: 600px)` blocks in styles/panels.css and the
// scoped styles of ChartLockerStatus, WeatherMap, AppMenu, WeatherConditions, and the
// scoped CSS below. This const is the source of truth; retune all of them together.
const NARROW_BREAKPOINT_PX = 600;
const INSTRUMENTS_FULLSCREEN_BREAKPOINT_PX = 900;
// On a phone the note detail and a leading panel both collapse to bottom sheets and would overlap,
// so at narrow widths opening one closes the other. On a wide screen they dock to opposite edges and
// coexist, so this exclusion only applies while the phone query matches.
const narrowQuery = createMediaQuery(`(max-width: ${NARROW_BREAKPOINT_PX}px)`);
const narrow = $derived(narrowQuery.matches);
let instrumentsFullScreen = $state(false);
// The safety rail's measured clearance, bound out of PlotterView so App-level fixed overlays (the
// full-screen dock) can reserve the space the rail floats over.
let safetyRailClearance = $state('0px');
const openPanel = (panel: PanelId): void => {
  if (instrumentsFullScreen && instruments.open) instruments.setOpen(false);
  if (activePanel === 'trends' && panel !== 'trends') {
    trends.setOpen(false);
    trends.setFocus(undefined);
    trendReturnInstrumentId = undefined;
  }
  if (panel !== 'ais') selectedAisId = undefined;
  if (panel !== 'waypoints') {
    selectedWaypointId = undefined;
    armNavigateWaypointId = undefined;
  }
  if (panel !== 'poi-search') hoveredPoi = undefined;
  activePanel = panel;
  if (panel === 'trends') trends.setOpen(true);
  if (narrow) selectedNote = undefined;
};
// Open the panel if it is closed, close it if it is already open, so a bar pill and a menu tile both
// toggle. Delegates to openPanel/closePanel to keep the narrow-width clear-selectedNote side effect.
const togglePanel = (panel: PanelId, onOpen?: () => void): void => {
  if (activePanel === panel) {
    closePanel();
  } else {
    openPanel(panel);
    onOpen?.();
  }
};

function finishOpeningInstrumentsPanel(): void {
  if (instrumentsFullScreen) {
    radarControlsOpen = false;
    weatherPanelOpen = false;
    closePanel();
    selectedNote = undefined;
    noteReturnsToPlaces = false;
  }
  instruments.setOpen(true);
}

function toggleInstrumentsPanel(): void {
  if (instruments.open) {
    instruments.setOpen(false);
    return;
  }
  if (instrumentsFullScreen) {
    if (radarControlsOpen) {
      if (radarDraftDirty) {
        radarPanelRequest = 'instruments';
        return;
      }
    }
  }
  finishOpeningInstrumentsPanel();
}
let recolorMap: ((theme: Theme) => void) | undefined;
let chartsToken = $state<string | undefined>();

// The selected POI and a cache-owning detail loader, both set once auth resolves.
let selectedNote = $state<NoteSelection | undefined>();
let noteReturnsToPlaces = $state(false);
let noteLoader = $state<NoteDetailLoader | undefined>();
let mapView = $state<MapView | undefined>();
// The on-screen POIs reported by the notes overlay, clipped to the live viewport for the POI search.
// Replace-only (reassigned wholesale from onNotes), so raw state skips the wasted deep proxy.
let poiNotes = $state.raw<NotePoint[]>([]);
let poiViewState = $state<PoiViewState>({ phase: 'idle', offline: false });
// The clip is gated behind the panel being open so it does not recompute while the POI search
// panel is hidden, and the viewport is quantized so the in-view clip re-runs when the chart
// meaningfully moves, not at GPS rate while follow recenters on every fix.
const poiViewCellKey = $derived(
  activePanel === 'poi-search' && mapView ? quantizeViewCellKey(mapView) : '',
);
const poiInView = $derived.by<Poi[]>(() => {
  if (activePanel !== 'poi-search') return [];
  void poiViewCellKey;
  const bounds = mapCommands?.getBounds();
  const source = bounds
    ? poiNotes.filter((note) => bboxContainsPoint(bounds, note.position))
    : poiNotes;
  return source.map((note) => ({
    id: note.id,
    name: note.name,
    position: note.position,
    category: note.category,
    description: note.description,
    skIcon: note.skIcon,
    ownedByBinnacle: note.ownedByBinnacle,
    source: note.source,
    attribution: note.attribution,
    url: note.url,
  }));
});

// The result the POI search panel is pointing at, ringed on the chart. A hovered row (pointer or
// keyboard) wins over the open selection, so moving down the list previews each marker; neither
// moves the map.
// PlotterView owns the highlight effect for this state (bound down via hoveredPoi/selectedNote).
let hoveredPoi = $state<Poi | undefined>();
let updateReady = $state(false);
const pwa = registerPwa(() => (updateReady = true));

const theme = createThemeController((next) => recolorMap?.(next));

// Profile state restored across visits: the last map view and the layer settings.
const mapViewStore = createMapView();
const savedView = isMapView(mapViewStore.value) ? mapViewStore.value : undefined;
// The live map view if one has been reported, else the persisted view: the fallback that the tides
// load and the weather map's initial view share.
const currentView = $derived(mapView ?? savedView);
const tidesController = createTidesController(tidesStore, tidesLoader, () => currentView);
const layerSettings = new PersistedValue<LayerSettings>(
  binnacleStorageKey('layers'),
  {},
  undefined,
  layerSettingsCodec,
);
const layerOrder = new PersistedValue<string[]>(
  binnacleStorageKey('layerOrder'),
  [],
  undefined,
  stringArrayPersistedCodec({ maxItems: 512 }),
);
// A one-shot, device-local latch: the first time a radar is discovered, the echo layer is turned on so
// "if they have radar, the radar layer is enabled". Latched so a later explicit toggle-off is never
// overridden. Not part of a profile: it is local device state, not portable layer configuration.
const radarAutoEnabled = new PersistedValue<boolean>(
  binnacleStorageKey('radarAutoEnabled'),
  false,
  undefined,
  booleanPersistedCodec,
);
const pinnedActions = new PersistedValue<string[]>(
  binnacleStorageKey('pinnedActions'),
  [...DEFAULT_PINNED],
  undefined,
  stringArrayPersistedCodec({ maxItems: 64, maxLength: 128 }),
);

// The instrument dock: tile selection rides profiles through this PersistedValue (the bindings
// entry reads and writes it), while the open flag stays local so a casual dock toggle never
// dirties the active profile and a profile switch never yanks the dock.
const instrumentTiles = new PersistedValue<string[]>(
  binnacleStorageKey('instrumentTiles'),
  [...DEFAULT_TILES],
  undefined,
  stringArrayPersistedCodec({ maxItems: 100, maxLength: 256 }),
);
// Chart orientation mode, profile-owned; the resolver and bearing effect live beside follow.
const chartOrientation = new PersistedValue<ChartOrientationMode>(
  binnacleStorageKey('chartOrientation'),
  'north',
  undefined,
  enumPersistedCodec(CHART_ORIENTATION_MODES),
);
const trendInstruments = new PersistedValue<string[]>(
  binnacleStorageKey('trendInstruments'),
  [...DEFAULT_TREND_INSTRUMENT_IDS],
  undefined,
  stringArrayPersistedCodec({ maxItems: 8, maxLength: 256 }),
);
const instrumentsOpen = new PersistedValue<boolean>(
  binnacleStorageKey('instrumentsOpen'),
  false,
  undefined,
  booleanPersistedCodec,
);
const instruments = createInstrumentsController({
  store,
  origin,
  getToken: () => authToken,
  getHistoryProviders: () => historyProviders,
  getHistoryProviderState: () => historyProviderState,
  subscribe: (entries) => void client.raw.subscribe(entries),
  unsubscribe: (paths) => void client.raw.unsubscribe(paths),
  tilesStore: instrumentTiles,
  openStore: instrumentsOpen,
});
const trends = createTrendsController({
  store,
  origin,
  getToken: () => authToken,
  getHistoryProviders: () => historyProviders,
  getHistoryProviderState: () => historyProviderState,
  subscribe: (entries) => void client.raw.subscribe(entries),
  unsubscribe: (paths) => void client.raw.unsubscribe(paths),
  selectionStore: trendInstruments,
  getCatalog: () => instruments.trendCatalog,
  getDescriptor: (id) => instruments.trendDescriptor(id),
  prepareDescriptors: (ids) => instruments.prepareTrendDescriptors(ids),
  refreshCatalog: () => instruments.refreshCatalog(),
  getDiscovering: () => instruments.discovering,
  isHistoricalOnly: (id) => instruments.isHistoricalOnly(id),
});
let trendReturnInstrumentId = $state<string | undefined>();

function openFocusedTrend(id: string): void {
  if (!trends.setFocus(id)) return;
  trendReturnInstrumentId = id;
  instruments.setOpen(false);
  openPanel('trends');
}

function closeTrendsPanel(): void {
  trends.setFocus(undefined);
  trendReturnInstrumentId = undefined;
  closePanel();
}

function backFromTrendsPanel(): void {
  const returnId = trends.focusedId ?? trendReturnInstrumentId;
  if (!returnId) {
    backToMenu();
    return;
  }
  trends.setOpen(false);
  trends.setFocus(undefined);
  activePanel = null;
  trendReturnInstrumentId = returnId;
  instruments.setOpen(true);
}
const onTogglePin = (id: string): void => {
  pinnedActions.set(togglePinned(pinnedActions.value, id));
};
const onReorderPinned = (id: string, slot: number): void => {
  pinnedActions.set(reorderPinned(pinnedActions.value, id, slot));
};
const onResetPinned = (): void => {
  pinnedActions.set([...DEFAULT_PINNED]);
};
// Which Layers-panel categories the navigator has left open or closed, so the panel reopens that way.
const layerCategoriesOpen = new PersistedValue<Record<string, boolean>>(
  binnacleStorageKey('layerCategories'),
  {},
  undefined,
  booleanRecordPersistedCodec({ maxEntries: 128 }),
);

// Profiles: named bundles of the portable settings (theme, layers, opacity, order, weather layers,
// thresholds, track and planning settings, alarm mutes) the navigator saves and switches between.
// The display-unit preference: follows the server's unit preferences when they resolve, with a
// locally persisted fallback that profiles can carry. The store stays SI; only readouts consult it.
const units = new UnitsStore();

// The raw MapLibre map instance, handed up once after the chart loads so the regions panel can mount
// its Terra Draw rectangle tool independently of the route editor.
let mapInstance = $state<MapLibreMap | undefined>();

// Companion feature-detect. Both the regions and chart-management panels receive the resolved
// base URL as a prop, so they mount ready without their own probe RTT.
let companionProbe = $state<CompanionProbeResult | undefined>();
const companionBase = $derived(
  companionProbe?.state === 'present' || companionProbe?.state === 'access-refused'
    ? companionProbe.base
    : null,
);
// The base the raster overlays may actually be ROUTED through, which is not the same question.
// companionBase deliberately keeps an access-refused base so the panels can offer the access
// request against it, but routing chart tiles through a route that refuses them would replace a
// working direct upstream chart with a broken proxied one.
const companionTileBase = $derived(
  companionProbe?.state === 'present' ? companionProbe.base : null,
);
let companionProbeGeneration = 0;

// Probed at mount (unauthenticated, so map init is never blocked on auth resolving) and retried
// wherever a stale credential could have been the reason it came back null: once real auth
// arrives, and again on a reconnect that could catch a companion started while the link was down.
function refreshCompanionProbe(): void {
  const generation = ++companionProbeGeneration;
  void probeCompanion(origin, authToken).then((result) => {
    if (generation !== companionProbeGeneration) return;
    companionProbe = result;
    void companionStatus.refresh();
  });
}

// The single owner of Chart Locker health, polled for the status strip's offline-charts chip. The
// base resolves after detectCompanion. Management access uses the browser's Signal K administrator
// session rather than Binnacle's device token.
const companionStatus = new CompanionStatus(() => companionBase);

// Time-travel review: one accepted provider snapshot drives the replay track, marker, and readouts.
// The controller owns bounded range requests, playback, and browser lifecycle cleanup.
const timeTravel = createTimeTravelController(
  origin,
  () => chartsToken,
  () => historyProviders,
);

// Standard server waypoints: fetched from /resources/waypoints, rendered by the chart overlay,
// managed in the Waypoints panel, and dropped from the chart's long-press menu.
const waypointsStore = new WaypointsStore();
const personalNotesStore = new PersonalNotesStore();

// Provided chart symbols (signalk-symbol-manager). Constructed empty so the chart can mount
// immediately and hold one stable reference; filled when the fetch lands after access resolves.
// On a stock server the resource type 404s and every icon stays built-in.
const symbolsStore = new SymbolsStore(origin, undefined);
let symbolsRefreshGeneration = 0;

// Provided chart symbols; absent on a stock server, in which case the built-ins stand. A
// symbol-manager plugin installed or updated while the link was down would otherwise leave stale
// icons until the page reloads, so the reconnect path refreshes these alongside the other resources.
async function refreshSymbols(): Promise<void> {
  const generation = ++symbolsRefreshGeneration;
  const list = await fetchSymbols(origin, authToken);
  if (generation === symbolsRefreshGeneration && list) symbolsStore.setSymbols(list);
}

const profileStore = new ProfileStore();

function localEraseSafety(): EraseSafetyDecision {
  if (!recorder.restored) {
    return { allowed: false, reason: 'Wait for the saved track recording check to finish.' };
  }
  if (mob.active)
    return { allowed: false, reason: 'Resolve the active man-overboard alert first.' };
  if (anchor.watching) return { allowed: false, reason: 'Stop the anchor watch first.' };
  if (courseGuidance.active) return { allowed: false, reason: 'Stop active navigation first.' };
  if (routeStore.working) return { allowed: false, reason: 'Save or cancel the route edit first.' };
  if (measure.active) return { allowed: false, reason: 'Finish or clear the measurement first.' };
  if (recorder.points.length > 0) {
    return { allowed: false, reason: 'Save or clear the unsaved recorded track first.' };
  }
  return { allowed: true };
}

const appScope =
  typeof window === 'undefined' || !import.meta.env.PROD
    ? ''
    : new URL(import.meta.env.BASE_URL, window.location.origin).href;
const privacyRegistry = createBinnaclePrivacyRegistry({
  localStorage: typeof localStorage === 'undefined' ? undefined : localStorage,
  indexedDB: globalThis.indexedDB,
  cacheStorage: globalThis.caches,
  serviceWorker:
    typeof navigator !== 'undefined' && 'serviceWorker' in navigator
      ? navigator.serviceWorker
      : undefined,
  serviceWorkerScopes: appScope ? [appScope] : [],
  // Both precache generations: serwist is current, and the retired workbox prefix stays so an
  // erase on an upgraded installation still removes a stale workbox precache.
  cachePrefixes: appScope
    ? [`serwist-precache-v2-${appScope}`, `workbox-precache-v2-${appScope}`]
    : [],
});
const privacySourceId =
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `binnacle-${Math.random().toString(16).slice(2)}`;
const privacyActivity = new PrivacyActivityCoordinator(
  typeof navigator !== 'undefined' && 'locks' in navigator ? navigator.locks : undefined,
);
const privacy = new DevicePrivacyController({
  registry: privacyRegistry,
  canErase: () => privacyActivity.guard(localEraseSafety),
  broadcaster:
    typeof BroadcastChannel === 'undefined'
      ? undefined
      : createBroadcastChannelBroadcaster(BINNACLE_PRIVACY_CHANNEL, privacySourceId),
});

$effect(() => {
  privacyActivity.setUnsafe(!localEraseSafety().allowed);
});

let privacyReloadTimer: ReturnType<typeof setTimeout> | undefined;
function reloadAfterPrivacy(report: PrivacyReport): PrivacyReport {
  if (report.clearedOwnerIds.includes('signalk-credentials')) {
    // The privacy registry already removed the stored identity. Reset runtime auth without writing a
    // replacement into localStorage during the short confirmation window before the reload.
    auth.forgetDeviceCredentials(false);
  }
  if (report.clearedOwnerIds.length > 0) {
    // Give Svelte time to render the completion or named partial-failure report before reloading.
    // Partial results remain visible longer so the navigator can read which owner failed.
    const delayMs = report.status === 'partial' ? 5000 : 750;
    if (privacyReloadTimer) clearTimeout(privacyReloadTimer);
    privacyReloadTimer = setTimeout(() => window.location.reload(), delayMs);
  }
  return report;
}

async function forgetDeviceCredentials(): Promise<PrivacyReport> {
  return reloadAfterPrivacy(await privacy.forgetCredentials());
}

async function eraseAllLocalData(): Promise<PrivacyReport> {
  profilesController.suspend();
  try {
    const report = await privacy.eraseAllLocalData();
    if (!report.clearedOwnerIds.includes('local-settings')) profilesController.resume();
    return reloadAfterPrivacy(report);
  } catch (error) {
    profilesController.resume();
    throw error;
  }
}
// Handed up by the weather mini-map once it is ready, to push a weather-layer snapshot at runtime.
let applyWeatherLayers = $state<((settings: LayerSettings) => void) | undefined>();
// The mini-map is destroyed with the panel; drop the stale handle on close so a later profile
// apply cannot push a snapshot into a removed map or interrupt later profile autosaves.
$effect(() => {
  if (!weatherPanelOpen) applyWeatherLayers = undefined;
});

// The portable-setting binding table lives in the profiles feature (createProfileBindings); the live
// map-layer push on apply stays here, since this composition root owns the map handles.
const profileBindings = createProfileBindings({
  theme,
  layers: layerSettings,
  layerOrder,
  weatherLayers: weatherLayerSettings,
  thresholds,
  trackSettings,
  planningSpeedMps,
  unitsLocal: units.localSetting,
  pinnedActions,
  instrumentTiles,
  trendInstruments,
  anchorRadius: {
    get: () => anchor.preferredRadiusMeters,
    set: (radiusMeters) => anchor.rememberRadius(radiusMeters),
  },
  chartOrientation,
});

// Push a profile's persisted layer snapshots to the live maps after the bindings update their stores.
function applyProfileRuntime(s: ProfileSettings): void {
  mapCommands?.applyLayers(s.layers, s.layerOrder);
  applyWeatherLayers?.(s.weatherLayers);
  // A profile that actually configures the radar layer is an explicit choice, so latch radar
  // auto-enable to it (a profile that deliberately keeps the echo off must win). A profile saved before
  // radar existed carries no marine-radar entry, so it must NOT latch, or it would permanently suppress
  // first-discovery auto-enable on this device.
  if (s.layers[MARINE_RADAR_OVERLAY_ID]) radarAutoEnabled.set(true);
}

const profilesController = createProfilesController({
  store: profileStore,
  bindings: profileBindings,
  applyRuntime: applyProfileRuntime,
});

$effect(() => profilesController.observeSettings());

// Once the user is authenticated to a secured server, sync profiles through the SignalK applicationData
// API so they follow the user across devices. An unsecured server (status 'unsecured', no token) keeps
// profiles local, since applicationData is disabled without security. A fresh browser waits through
// one bounded hydration window before the offline fallback may create local starters.
async function syncProfiles(): Promise<void> {
  if (auth.status !== 'authenticated' || !auth.token) return;
  const adapter = new SignalKProfileAdapter(origin, () => auth.token ?? undefined, {
    onWriteOutcome: (ok, status) => auth.reportWriteOutcome(ok, status),
  });
  await profilesController.sync(adapter);
}

$effect(() => {
  if (auth.status === 'authenticated' && auth.token) {
    store.connection.phase;
    void syncProfiles();
  } else if (auth.status === 'unsecured' || auth.status === 'denied') {
    void profilesController.initialize();
  }
});

function onApplyProfile(id: string): void {
  profilesController.apply(id);
}

function onSaveNewProfile(name: string): void {
  if (profileStore.profiles.length >= MAX_PROFILES) {
    toast.show('Profile limit reached. Delete a profile before saving another.');
    return;
  }
  profilesController.saveNew(name);
}

function onExportProfile(id: string): void {
  const profile = profileStore.profileById(id);
  if (profile) downloadProfileJson(profile);
}

// Save each imported profile as a new one (a fresh id, so an import never overwrites an existing
// profile); the panel already parsed and validated the picked file.
function onImportProfiles(profiles: ImportedProfile[]): number {
  let importedCount = 0;
  for (const imported of profiles) {
    if (profileStore.profiles.length >= MAX_PROFILES) {
      toast.show('Profile limit reached. Some profiles were not imported.');
      break;
    }
    profileStore.save(imported.name, imported.settings);
    importedCount += 1;
  }
  return importedCount;
}

// User-imported charts: URL descriptors only, persisted locally and synced to the server as chart
// resources so every station sees them. Local .pmtiles FILES are the signalk-pmtiles-plugin's job
// (it serves them as ordinary chart resources Binnacle already renders), not a browser blob store.
const userChartsCodec: PersistedCodec<UserChartSource[]> = {
  decode(value) {
    if (!Array.isArray(value) || value.length > 1_000) return { state: 'invalid' };
    const cleaned: UserChartSource[] = [];
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- local decode accumulator
    const ids = new Set<string>();
    let migrated = false;
    for (const item of value) {
      const chart = cleanUserChartSource(item);
      if (!chart || ids.has(chart.id)) {
        migrated = true;
        continue;
      }
      ids.add(chart.id);
      cleaned.push(chart);
      migrated ||= JSON.stringify(item) !== JSON.stringify(chart);
    }
    return { state: migrated ? 'migrated' : 'valid', value: cleaned };
  },
  encode(value) {
    const cleaned: UserChartSource[] = [];
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- local encode accumulator
    const ids = new Set<string>();
    for (const item of value) {
      const chart = cleanUserChartSource(item);
      if (!chart || ids.has(chart.id)) continue;
      ids.add(chart.id);
      cleaned.push(chart);
    }
    return cleaned;
  },
};
const userChartsStore = new PersistedValue<UserChartSource[]>(
  binnacleStorageKey('userCharts'),
  [],
  undefined,
  userChartsCodec,
);

const userCharts = new UserCharts(
  userChartsStore.value,
  (sources) => userChartsStore.set(sources),
  (source) => {
    if (source.bounds) mapCommands?.fitBounds(source.bounds);
    userChartsController.syncUrlChartToServer(source);
  },
  (source) => userChartsController.deleteUserChartFromServer(source),
  (source) => {
    userChartsController.dropRegisteredUserChart(source.id);
    userChartsController.syncUrlChartToServer(source);
  },
);

// Tide data is fetched only while something can display it: the tide-stations layer or the Tides
// panel. With both off (the default) a pan must not issue NOAA station and prediction fetches that
// nothing renders.
const tidesWanted = $derived(
  (layerSettings.value[TIDES_OVERLAY_ID]?.visible ?? false) || activePanel === 'tides',
);

// The view changes once per animation frame while panning; persist only after it
// settles so a drag is one write, not hundreds.
let viewSaveTimer: ReturnType<typeof setTimeout> | undefined;
// Debounce the view save so a drag settles into one write, not hundreds.
const VIEW_SAVE_DEBOUNCE_MS = 400;
function onViewChange(view: MapView): void {
  mapView = view;
  if (viewSaveTimer) clearTimeout(viewSaveTimer);
  viewSaveTimer = setTimeout(() => {
    mapViewStore.set(view);
    // Refresh tides for the settled view; the loader skips small moves and dedups in flight.
    if (tidesWanted) void tidesController.load(view);
  }, VIEW_SAVE_DEBOUNCE_MS);
}

// Load tides for the current view, so opening the Tides panel shows data without a pan first.
function loadTides(force = false): void {
  void tidesController.loadCurrent(force);
}

// Toggling the tide layer on (or opening the panel) loads tides for the current view, covering the
// fetches the gated pan-settle path skipped while nothing displayed them. The view read is
// untracked: mapView changes every frame of a pan, and depending on it would re-run this per
// frame while the layer is on; the debounced pan-settle path already covers view changes. Warm the
// small panel module at the same time so tapping a visible chart marker does not start its first
// chunk request while the user is waiting for the station detail.
$effect(() => {
  if (!tidesWanted) return;
  void loadTidesPanel().catch(() => undefined);
  untrack(loadTides);
});

let mapCommands = $state<MapCommands | undefined>();

// A usable local cache is enough to start immediately. Server hydration still runs when
// authentication resolves, but an offline restart must keep profile autosave working. This call
// sits BELOW every declaration applyProfileRuntime touches (mapCommands is the last): with no
// server argument, initialize reaches applySettings synchronously, so calling it earlier reads
// the mapCommands state before its declaration executes, a startup ReferenceError whenever a
// saved profile exists locally. The catch keeps a failed startup apply a visible logged error
// instead of an unhandled rejection.
if (profileStore.profiles.length > 0) {
  profilesController.initialize().catch((error) => {
    console.error('[profiles] startup apply failed', error);
  });
}

// Chart orientation: north-up by default, with course-up and heading-up as explicit profile-owned
// choices. The resolver owns the fallback rules (fresh reference or north, immediately), the
// effect below is the one author of map bearing, and rotation gestures stay disabled.
const orientation = $derived(
  resolveOrientation({
    mode: chartOrientation.value,
    headingRad: vessel.headingRad,
    headingStale: vessel.headingStale,
    cogRad: vessel.cogRad,
    cogStale: vessel.cogStale,
    sogMps: vessel.sogMps,
    sogStale: vessel.sogStale,
  }),
);
$effect(() => {
  mapCommands?.setMapBearing(orientation.bearingDeg);
});
function cycleOrientation(): void {
  const modes = CHART_ORIENTATION_MODES;
  const index = modes.indexOf(chartOrientation.value);
  chartOrientation.set(modes[(index + 1) % modes.length]);
}
const ORIENTATION_TILE_LABELS: Record<ChartOrientationMode, string> = {
  north: 'North up',
  course: 'Course up',
  heading: 'Heading up',
};
// The bounded look-ahead: only a rotated chart making way shifts the boat low on screen (up IS
// ahead there); north-up and a stopped or referenceless boat stay centered. Bounded by a fixed
// pixel budget, and the map is never pitched.
const LOOK_AHEAD_PX = 140;
const lookAheadPx = $derived(
  orientation.active && chartOrientation.value !== 'north' ? LOOK_AHEAD_PX : 0,
);

// Follow lock orchestration (recenter per fix, stale pause with auto recovery, release on manual
// pan) lives in the controller; the host wires the menu tile and onUserPan to it.
const follow = createFollowController({
  vessel,
  commands: () => mapCommands,
  lookAheadPx: () => lookAheadPx,
});

// Show a chart layer at full registration (the persisted snapshot plus the live map), so a feature
// surface can turn its own layer on: starting Measure must reveal a hidden measure layer (or it
// records invisible points), and the Tides panel cross-links its stations layer.
function setLayerVisible(id: string, visible: boolean): void {
  const current = layerSettings.value[id];
  if (current?.visible === visible) return;
  const entry = current ? { ...current, visible } : { visible, opacity: 1 };
  const next = { ...layerSettings.value, [id]: entry };
  layerSettings.set(next);
  mapCommands?.applyLayers(next, layerOrder.value);
}

function onTideStationSelect(selection: TideStationSelectionEvent): void {
  setLayerVisible(TIDES_OVERLAY_ID, true);
  if (activePanel !== 'tides') {
    tidesOpenedFrom = 'chart';
    openPanel('tides');
  }
  if (selection.mode === 'automatic') {
    void tidesController.useAutomatic(selection.kind);
  } else {
    void tidesController.selectStation(selection.kind, selection.station);
  }
}

// A menu action can reveal a layer before ChartCanvas finishes its asynchronous map setup. Persisted
// state already records that action; replay the latest full snapshot when commands arrive so the live
// manager cannot remain on the older construction-time props for the rest of the session.
function captureMapCommands(commands: MapCommands): void {
  mapCommands = commands;
  // PlotterView forwards readiness from an effect. Keep this snapshot read out of that effect's
  // dependency set, or applyLayers persists the same state and recursively re-triggers readiness.
  untrack(() => commands.applyLayers(layerSettings.value, layerOrder.value));
}

// Arming always reveals the measure layer first: an armed tool drawing into an invisible layer
// would read as broken. Selecting the active menu item keeps the current measurement. The chart's
// "Measure from here" action explicitly requests a fresh measurement at that position.
function armMeasure(reset = false): boolean {
  // No actionable crosshair before the tap handler exists: arming against a chart that is still
  // constructing advertises a first tap that would be silently dropped.
  if (!mapInstance) {
    toast.show('The chart is still loading. Measure will be available in a moment.');
    return false;
  }
  if (marineRadar.store.areaDraft?.chartEditing) {
    toast.show('Finish the radar-area chart edit before starting Measure.');
    return false;
  }
  if (routeStore.working) {
    toast.show('Save or cancel the route edit before starting Measure.');
    return false;
  }
  setLayerVisible(MEASURE_OVERLAY_ID, true);
  if (!measure.active || reset) measure.start();
  return true;
}

function moveSelectedMeasureToCenter(): void {
  const center = mapInstance?.getCenter();
  if (!center) {
    toast.show('The chart is still loading. Try moving the point again in a moment.');
    return;
  }
  measure.commitMove({ latitude: center.lat, longitude: center.lng });
}

// The marine radar controller owns the spokes worker and the echo layer. Detection runs once server
// features resolve; on a stock server discovery degrades and nothing streams. getCenter and getToken
// are getters so the radar follows the live vessel position and a token that arrives mid-session.
const marineRadar = createMarineRadarController({
  origin,
  getToken: () => chartsToken,
  getCenter: () => vessel.position ?? undefined,
  getHeading: () => vessel.headingRad,
  centerFresh: () => !vessel.positionStale,
  headingFresh: () => !vessel.headingStale,
  radarAvailable: () => serverFeatures !== undefined,
  chartEditBlockedReason: () =>
    radarChartEditBlockedReason({
      measureActive: measure.active,
      routeEditing: routeStore.working !== undefined,
      offlineChartsOpen: activePanel === 'regions' || activePanel === 'charts-management',
      chartReady: mapInstance !== undefined,
    }),
});
// The radar controls slide-over opens from the radar menu tile or the radar layer row's gear;
// radarOpenedFrom records which, so its back arrow returns to the menu only when the menu opened it
// (from the gear the layers panel is still behind it, so going to the menu would strand the navigator).
let radarControlsOpen = $state(false);
let radarOpenedFrom = $state<'menu' | 'layers'>('menu');
let radarDraftDirty = $state(false);
let radarPanelRequest = $state<'close' | 'instruments' | undefined>();

// Auto-enable the radar echo the first time a radar is discovered, then latch so a later manual
// toggle-off in the Layers panel is never overridden. The radar layer row's toggle is disabled until a
// radar is available, so there is no pre-availability "off" to preserve, which makes a one-shot correct.
$effect(() => {
  if (!marineRadar.store.hasRadar || radarAutoEnabled.value) return;
  radarAutoEnabled.set(true);
  setLayerVisible(MARINE_RADAR_OVERLAY_ID, true);
});

// The controls hydration poll only feeds the radar panel, so run it only while the panel is open. Live
// control changes and the radar picture arrive over their respective streams.
$effect(() => {
  marineRadar.setPolling(radarControlsOpen);
});

// Set the radar's transmit/standby state; when transmit is keyed up, reveal the echo so powering on
// shows the picture in one action.
function onSetRadarPower(status: RadarStatus): void {
  void marineRadar.setPower(status).then((ok) => {
    if (ok && status === 'transmit') setLayerVisible(MARINE_RADAR_OVERLAY_ID, true);
  });
}

// Shallow-water depth alarm: the lookout controller owns the resolved-depth predicate, the server
// meta.zones authority, the live-region string, and the tone. The strip's Depth readout and the
// live region key off the same conditions through it, matching the anchor drag alarm's own
// strip-chip-plus-live-region pairing.
const shallowController = createShallowController({
  getSafetyDepth: () => vessel.safetyDepth,
  thresholds,
  units,
  origin,
  getToken: () => chartsToken,
  alarm: alarmCoordinator.channel({ id: 'shallow', rank: () => 2 }),
});

// The generic server-alarm channel: any inbound alarm or emergency grade notification outside the
// five dedicated hazards sounds through this one alarm and surfaces on the AlarmStrip, the Alarms
// badge, and the assistive channel. The controller drives it from the shared generic list. It is
// constructed before the menu registry so the Alarms entry can carry the live count.
const genericAlarm = new GenericAlarm(alarmCoordinator.channel({ id: 'generic', rank: () => 2 }));

const notificationsController = createNotificationsController({
  origin,
  token: () => chartsToken,
  notificationsApi: () => notificationsApi,
  writeBlocked: () => auth.writeBlocked,
  client,
  collision,
  collisionMute,
  lookoutAlarm,
  anchor,
  notificationsStore,
  companionStatus,
  timeTravel,
  mob,
  genericAlarm,
  ownedDepthNotificationPath: () => shallowController.ownedNotificationPath,
  anchorNotificationCovered: () => anchor.mode === 'server',
});
const collisionAlert = $derived(notificationsController.collisionAlert);
const genericAlarms = $derived(notificationsController.genericAlarms);
const genericNotificationAlert = $derived(notificationsController.notificationAlert);
const muteAlert = $derived(notificationsController.muteAlert);
const muteRemainingMin = $derived(notificationsController.muteRemainingMin);
const companionAnnounce = $derived(notificationsController.companionAnnounce);
const alarmActionError = $derived(notificationsController.alarmActionError);
const toggleCollisionMute = notificationsController.toggleCollisionMute;
const onSilenceNotification = notificationsController.onSilenceNotification;
const onAcknowledgeNotification = notificationsController.onAcknowledgeNotification;
const muteGenericHere = notificationsController.muteGenericHere;

// Helm radar health, shared by the status strip chip and the watch-handoff facts so the two can
// never disagree about the same picture.
const radarHealth = $derived(
  radarHelmHealth({
    echoShown: layerSettings.value[MARINE_RADAR_OVERLAY_ID]?.visible ?? false,
    operationalStatus: marineRadar.store.operationalStatus,
    connection: marineRadar.store.status,
    renderer: marineRadar.store.rendererStatus,
  }),
);

// Watch handoff: timestamped review-status snapshots shared through Signal K applicationData
// (global scope, every station reads one list), with a bounded device draft queue that syncs when
// the server store returns. Creating a snapshot only reads the stores wired here.
const handoffDrafts = new PersistedValue<HandoffSnapshot[]>(
  binnacleStorageKey('handoffDrafts'),
  [],
  undefined,
  createPersistedCodec(
    (value: unknown): value is HandoffSnapshot[] =>
      Array.isArray(value) && value.length <= 10 && value.every(isHandoffSnapshot),
  ),
);
const handoffClient = createHandoffClient(origin, () => authToken);
// The latest route-coverage report, threaded up from the Offline charts panel, so a handoff can
// state whether the corridor was checked without re-running the check.
let routeCoverageFact = $state<string | undefined>();
function onRouteCoverageReport(report: RouteCoverageReport | null): void {
  if (report === null || report.verdict === 'unknown') {
    routeCoverageFact = undefined;
    return;
  }
  const verdict = report.verdict === 'complete' ? 'Complete' : 'Partial';
  routeCoverageFact = `${verdict} for a ${report.corridorNm} nm corridor, checked ${formatClockTime(Date.now())}`;
}
const handoff = createHandoffController({
  client: () => handoffClient,
  drafts: handoffDrafts,
  collectFacts: () =>
    collectHandoffFacts({
      now: Date.now,
      fix: () => ({
        received: vessel.positionReceived,
        stale: vessel.positionStale,
        epochMs: vessel.positionEpochMs ?? 0,
      }),
      course: () => ({
        destination: courseGuidance.active
          ? (courseGuidance.nextPointName ?? 'the next point')
          : undefined,
        xteMeters: courseGuidance.crossTrackErrorMeters,
        ttgSeconds: courseGuidance.timeToGoSeconds,
        ttgBasis: courseGuidance.timeToGoBasis,
      }),
      alarms: () => ({
        raised: genericAlarms.filter(isRaisedNotification).length,
        worst: worstRaisedNotification(genericAlarms)?.state,
        collisionMutedUntilMs: collisionMute.active
          ? Date.now() + collisionMute.remainingMs
          : undefined,
      }),
      collision: () => ({
        worst: collision.assessment.worst,
        unassessed: collision.assessment.unassessed.length,
        topCpaMeters: collision.assessment.contacts[0]?.cpaMeters,
        topTcpaSeconds: collision.assessment.contacts[0]?.tcpaSeconds,
      }),
      depthWatch: () => shallowController.monitorState,
      radar: () =>
        radarHealth.state === 'quiet'
          ? 'quiet'
          : radarHealth.state === 'stale'
            ? 'transmitting, picture stale'
            : `failed (${radarHealth.reason})`,
      weatherFetchedAtMs: () => weather.grid?.fetchedAt,
      tides: () =>
        tidesStore.tide !== undefined
          ? 'tide station data loaded'
          : tidesStore.status === 'idle'
            ? 'not loaded'
            : tidesStore.status,
      routeCoverage: () => routeCoverageFact,
      multiSourcePaths: () => {
        // Watch-critical paths a handoff should name when more than one source fed them recently.
        const watched: Array<[string, string]> = [
          ['position', SK_PATHS.position],
          ['heading', SK_PATHS.headingTrue],
          ['depth', vessel.safetyDepth.path],
        ];
        const now = Date.now();
        const entries: Array<{ name: string; refs: string[] }> = [];
        for (const [name, path] of watched) {
          const refs = recentSourceRefs(store.cell(path).sourceSamples, now);
          if (refs.length > 0) entries.push({ name, refs });
        }
        return entries;
      },
    }),
});
// Reconnect synchronization: a draft taken offline reaches the other stations as soon as the
// browser is back online, without a manual step.
$effect(() => {
  if (net.online) void handoff.syncDrafts();
});

// Full-screen Instruments is a modal whose aria-modal removes the rest of the app, emergency rail
// included, from the accessibility tree, and no sibling subtree can be exempted from it. So an
// alarm-grade safety event closes the full-screen dock outright, returning the rail and its
// actions to the focus and screen-reader path at the moment they matter. Mirrors time travel's
// exit-on-danger. The docked (non-modal) dock is unaffected.
const emergencySafetyActive = $derived(
  mob.active ||
    (collision.assessment.worst === 'danger' && (!collision.suppressed || collision.escalating)) ||
    anchor.dragging ||
    anchor.fixLostAlarm ||
    genericAlarms.some(
      (notification) => notification.state === 'emergency' || notification.state === 'alarm',
    ),
);
$effect(() => {
  if (!emergencySafetyActive || !instrumentsFullScreen) return;
  if (untrack(() => instruments.open)) untrack(() => instruments.setOpen(false));
});

// The first-run welcome: a compact top banner once the shell is usable, never a panel forced open
// over the chart (a helm display rebooting mid-passage must come back to the chart). It yields to
// any active safety event, hides while Help is open, and Dismiss or the panel's own dismissal
// persists on the device.
const showHelpWelcome = $derived(
  !helpOrientationSeen.value &&
    mapInstance !== undefined &&
    !emergencySafetyActive &&
    activePanel !== 'help',
);

// The region-aware chart offer: in US waters the app already holds everything needed to turn a
// reference-map view into a real chart, and nothing points at it. One dismissible banner, once per
// device. It stays out of the way while any panel is open, so a navigator who has just turned
// their last chart off in the Charts tab is never second-guessed by a banner under the sheet.
// The plain-HTTP warning, dismissible per device: a stock server serves Binnacle over HTTP on the
// LAN, so a permanent banner spends every first impression on the one thing a navigator cannot fix
// from here. Help's Signal K access section carries the durable explanation.
const insecureNoteSeen = new PersistedValue<boolean>(
  binnacleStorageKey('insecureNote'),
  false,
  undefined,
  booleanPersistedCodec,
);
const encPromptSeen = new PersistedValue<boolean>(
  binnacleStorageKey('encPrompt'),
  false,
  undefined,
  booleanPersistedCodec,
);
const showEncPrompt = $derived.by(() =>
  shouldOfferNoaaEnc({
    dismissed: encPromptSeen.value,
    emergencyActive: emergencySafetyActive,
    panelOpen: activePanel !== null,
    layers: layersView?.items,
    position: vessel.position,
    positionStale: vessel.positionStale,
  }),
);
function enableNoaaEnc(): void {
  // The manager honors the pinned floor, restores remembered sub-layers, and persists the choice,
  // so turning the chart on is one call and survives a reload.
  layersView?.toggle(NOAA_ENC_SOURCE_ID, true);
  encPromptSeen.set(true);
}

// The one spoken safety channel: structured events in fixed priority order, worst-first speech,
// polite delivery for the rest. The per-channel alert strings stay owned by their controllers.
const safetyAnnunciator = createSafetyAnnunciator();
$effect(() => {
  safetyAnnunciator.update([
    { id: 'mob', rank: 0, text: mobController.mobAlert },
    { id: 'collision', rank: 1, text: collisionAlert },
    { id: 'anchor', rank: 2, text: anchorController.anchorAlert },
    { id: 'shallow', rank: 3, text: shallowController.alert },
    { id: 'notification', rank: 4, text: genericNotificationAlert },
  ]);
});

// The app menu's options, grouped into helm-first intent groups: chart controls and navigation,
// safety, weather, instruments, optional offline charts, and settings. Adding an option is a single
// entry; the launcher renders and groups whatever it is given.
const menuItems = $derived<MenuItem[]>([
  {
    id: 'center',
    label: 'Center on boat',
    shortLabel: 'Center',
    icon: LocateFixed,
    group: 'Chart',
    disabled: !mapCommands || !vessel.position || vessel.positionStale,
    disabledLabel: !mapCommands
      ? 'Center (chart is loading)'
      : vessel.positionStale
        ? 'Center needs a fresh GPS fix.'
        : 'Center needs a GPS position.',
    onSelect: () => mapCommands?.centerOnVessel(),
  },
  {
    id: 'follow',
    label: 'Follow boat',
    shortLabel: 'Follow',
    icon: Navigation,
    group: 'Chart',
    // While armed, the tile stays enabled through a stale fix so follow can still be toggled off
    // during a GPS outage without panning the chart.
    disabled: !mapCommands || (!follow.following && (!vessel.position || vessel.positionStale)),
    disabledLabel: !mapCommands
      ? 'Follow (chart is loading)'
      : vessel.positionStale
        ? 'Follow needs a fresh GPS fix.'
        : 'Follow needs a GPS position.',
    pressed: follow.following,
    onSelect: () => follow.toggle(),
  },
  {
    id: 'orientation',
    // One label voice with its siblings; the current mode rides the quiet sublabel line, and the
    // bar pill keeps the bare mode name, which flips on tap and so reveals the cycling itself.
    label: 'Orientation',
    sublabel: ORIENTATION_TILE_LABELS[chartOrientation.value],
    shortLabel: ORIENTATION_TILE_LABELS[chartOrientation.value],
    icon: Compass,
    group: 'Chart',
    disabled: !mapCommands,
    disabledLabel: 'Orientation (chart is loading)',
    pressed: chartOrientation.value !== 'north',
    onSelect: cycleOrientation,
  },
  {
    id: 'layers',
    label: 'Layers and charts',
    shortLabel: 'Charts',
    icon: Layers,
    group: 'Chart',
    disabled: !layersView,
    disabledLabel: 'Layers and charts (chart is loading)',
    pressed: activePanel === 'layers',
    onSelect: () => {
      layersInitialMode = 'charts';
      togglePanel('layers');
    },
  },
  // Keep this safety-relevant capability discoverable even when its optional provider is absent. The
  // tile explains the exact requirement instead of disappearing, then becomes the single landing
  // place for saved areas, automatic caching, installed charts, and storage when Chart Locker appears.
  {
    id: 'regions',
    label: 'Offline charts',
    shortLabel: 'Offline',
    icon: DownloadCloud,
    group: 'Chart',
    available: companionBase !== null,
    unavailableHint:
      companionProbe === undefined
        ? 'Checking whether Chart Locker is available on the Signal K server.'
        : companionProbe.state === 'access-refused'
          ? 'Signal K refused access to Chart Locker. Sign in to Signal K administration, then approve Binnacle read access on a secured server.'
          : companionProbe.state === 'absent'
            ? 'Install and start signalk-chart-locker from the Signal K Appstore to enable offline charts.'
            : 'Chart Locker could not be reached. Check the Signal K connection and Chart Locker service, then retry.',
    pressed: activePanel === 'regions' || activePanel === 'charts-management',
    // The landing panel draws saved-area bounds on the chart, so wait for MapLibre once the provider
    // exists. An absent provider uses available rather than disabled so tapping explains the setup.
    disabled:
      (companionBase !== null && mapInstance === undefined) ||
      marineRadar.store.areaDraft?.chartEditing === true,
    disabledLabel:
      marineRadar.store.areaDraft?.chartEditing === true
        ? 'Offline charts (finish the radar-area chart edit first)'
        : 'Offline charts (chart is loading)',
    onSelect: () => togglePanel('regions'),
  },
  {
    id: 'routes',
    label: 'Routes',
    icon: Route,
    group: 'Navigate',
    disabled: !mapCommands,
    disabledLabel: 'Routes (chart is loading)',
    pressed: activePanel === 'routes',
    onSelect: () => togglePanel('routes'),
  },
  {
    id: 'waypoints',
    label: 'Waypoints',
    icon: MapPin,
    group: 'Navigate',
    pressed: activePanel === 'waypoints',
    onSelect: () => togglePanel('waypoints'),
  },
  {
    id: 'tracks',
    label: 'Tracks',
    icon: Spline,
    group: 'Navigate',
    pressed: activePanel === 'tracks',
    onSelect: () => togglePanel('tracks'),
  },
  // Playback is not a LeftPanel; it has its own active flag and enter and exit API. It grays like
  // the radar tile when no history provider is known, rather than opening to an empty mode. It
  // sits beside Tracks so the two answers to "where was I?" are one neighborhood.
  {
    id: 'time-travel',
    label: 'Playback',
    icon: History,
    group: 'Navigate',
    available: (historyProviders?.ids.length ?? 0) > 0,
    unavailableHint:
      historyProviderState === 'checking' || historyProviderState === 'retrying'
        ? 'Checking for a Signal K history provider.'
        : historyProviderState === 'failed'
          ? 'Could not check for a history provider. Reconnect or reload to check again.'
          : 'Playback needs a history provider plugin on the server, such as signalk-questdb.',
    pressed: timeTravel.active,
    onSelect: () => (timeTravel.active ? timeTravel.exit() : void timeTravel.enter()),
  },
  {
    id: 'poi-search',
    label: 'Find places',
    shortLabel: 'Places',
    icon: Search,
    group: 'Navigate',
    pressed: activePanel === 'poi-search',
    // Find places and its chart markers share the notes overlay. Opening the search therefore
    // reveals that layer instead of presenting an empty list controlled by a hidden setting.
    onSelect: () => {
      if (activePanel === 'poi-search') {
        closePoiSearch();
      } else {
        openPanel('poi-search');
        setLayerVisible('notes', true);
      }
    },
  },
  // Measure remains armed when selected again; pressed reflects the active state.
  {
    id: 'measure',
    label: 'Measure',
    icon: Ruler,
    group: 'Navigate',
    // Also disabled until the chart's tap handler is ready (mapInstance is set after the tap
    // recognizer registers), so Measure can never advertise a first tap that would be dropped.
    disabled:
      mapInstance === undefined ||
      routeStore.working !== undefined ||
      marineRadar.store.areaDraft?.chartEditing === true,
    disabledLabel:
      mapInstance === undefined
        ? 'Measure (chart is loading)'
        : marineRadar.store.areaDraft?.chartEditing === true
          ? 'Measure (finish the radar-area chart edit first)'
          : 'Measure (save or cancel the route edit first)',
    pressed: measure.active,
    onSelect: armMeasure,
  },
  {
    id: 'ais',
    label: 'Nearby vessels (AIS)',
    shortLabel: 'AIS',
    // Danger-grade contacts only: the warning grade is "getting close", not a collision risk, and
    // a closed panel that claims one would be crying wolf.
    count: collision.assessment.contacts.filter((c) => c.severity === 'danger').length,
    countNoun: 'collision risk',
    icon: Ship,
    group: 'Safety',
    pressed: activePanel === 'ais',
    onSelect: () => togglePanel('ais'),
  },
  // The radar tile is always present: when no radar is discovered it grays out with a hover hint
  // rather than vanishing, matching the radar layer row and the other detect-and-degrade overlays
  // (track history, AIS trails) so a capability never silently disappears. It opens the same controls
  // panel reached from the radar layer row's gear.
  {
    id: 'radar',
    label: 'Radar',
    icon: Radar,
    group: 'Safety',
    available: marineRadar.store.hasRadar,
    unavailableHint: marineRadar.store.unavailableHint,
    pressed: radarControlsOpen,
    onSelect: () => {
      radarOpenedFrom = 'menu';
      // The echo reveals on first radar discovery and when transmit is keyed up, so opening the
      // panel must not force the layer back on: that would override an explicit toggle-off.
      if (radarControlsOpen && radarDraftDirty) {
        radarPanelRequest = 'close';
      } else {
        if (!radarControlsOpen && instrumentsFullScreen) instruments.setOpen(false);
        radarControlsOpen = !radarControlsOpen;
      }
    },
  },
  {
    id: 'anchor',
    label: 'Anchor watch',
    shortLabel: 'Anchor',
    icon: Anchor,
    group: 'Safety',
    pressed: activePanel === 'anchor',
    onSelect: () => togglePanel('anchor'),
  },
  {
    id: 'alarms',
    label: 'Alarms',
    icon: Bell,
    group: 'Safety',
    pressed: activePanel === 'alarms',
    count: genericAlarms.length,
    countNoun: 'alarm',
    onSelect: () => togglePanel('alarms'),
  },
  {
    id: 'handoff',
    label: 'Watch handoff',
    shortLabel: 'Handoff',
    icon: ClipboardList,
    group: 'Safety',
    pressed: activePanel === 'handoff',
    onSelect: () => togglePanel('handoff'),
  },
  {
    id: 'forecast',
    label: 'Forecast',
    icon: CloudSun,
    group: 'Weather',
    pressed: weatherPanelOpen,
    onSelect: () => {
      if (!weatherPanelOpen && instrumentsFullScreen) instruments.setOpen(false);
      weatherPanelOpen = !weatherPanelOpen;
    },
  },
  {
    id: 'tides',
    // The panel picks tidal-current stations as well as tide heights, which the shorter name hid;
    // the pill keeps the bare word.
    label: 'Tides and currents',
    shortLabel: 'Tides',
    icon: Waves,
    group: 'Weather',
    pressed: activePanel === 'tides',
    onSelect: () => {
      if (activePanel === 'tides') {
        closePanel();
        return;
      }
      tidesOpenedFrom = 'menu';
      openPanel('tides');
      loadTides();
    },
  },
  {
    id: 'instruments',
    label: 'Instrument dock',
    shortLabel: 'Instruments',
    icon: Gauge,
    group: 'Instruments',
    pressed: instruments.open,
    onSelect: toggleInstrumentsPanel,
  },
  {
    id: 'trends',
    label: 'Data trends',
    shortLabel: 'Trends',
    icon: ChartLine,
    group: 'Instruments',
    pressed: activePanel === 'trends',
    onSelect: () => {
      trends.setFocus(undefined);
      trendReturnInstrumentId = undefined;
      togglePanel('trends');
    },
  },
  {
    id: 'open-kip',
    // Named for what it is, an instrument dashboard, so a navigator who has never heard the
    // acronym knows what will open; the acronym rides the sublabel, where it cannot force the
    // label to permanently truncate at tile widths.
    label: 'Instrument dashboard',
    sublabel: 'KIP, opens in a new tab',
    icon: ExternalLink,
    group: 'Instruments',
    available: kipPresent === true,
    unavailableHint:
      kipProbeState === 'checking' || kipProbeState === 'retrying'
        ? 'Checking whether the KIP instrument-dashboard webapp is installed on the Signal K server.'
        : kipProbeState === 'failed'
          ? 'Could not check for KIP. Reconnect or reload to retry.'
          : 'The KIP instrument dashboard needs the KIP webapp installed on the Signal K server.',
    onSelect: () => {
      const opened = window.open(KIP_URL, '_blank', 'noopener,noreferrer');
      if (!opened) toast.show('The browser blocked the KIP window. Allow pop-ups, then try again.');
    },
  },
  {
    id: 'profiles',
    label: 'Profiles',
    // Units, sync, and device privacy all live inside the profiles panel, and a navigator looking
    // for feet instead of meters scans Settings for the word Units, not for Profiles.
    sublabel: 'Units, sync, and privacy',
    icon: UserCog,
    group: 'Settings',
    pressed: activePanel === 'profiles',
    onSelect: () => togglePanel('profiles'),
  },
  // The bottom bar's own opener. barOnly keeps it out of the launcher grid it opens, except while
  // customizing, where tapping a tile is the only way to pin or unpin. Pinned by default: on a
  // phone the topbar hamburger is a cross-screen reach, and the sheet it opens is at the thumb.
  {
    id: 'menu',
    label: 'Menu',
    icon: Menu,
    barOnly: true,
    pressed: menuOpen,
    onSelect: () => (menuOpen = !menuOpen),
  },
  {
    id: 'help',
    label: 'Help',
    icon: CircleHelp,
    group: 'Settings',
    pressed: activePanel === 'help',
    onSelect: () => togglePanel('help'),
  },
]);

// The pinned actions in canonical order, resolved from the persisted id list against the live
// registry, for the bottom bar to render.
const resolvedPinned = $derived(resolvePinned(menuItems, pinnedActions.value));

// AIS staleness pruning, tied to the app lifecycle; the entity owns the TTL and cadence policy.
$effect(() => aisTargets.startPruning());

function publishDelta(path: string, value: unknown): void {
  void client.publish({ context: SELF_CONTEXT, updates: [{ values: [{ path, value }] }] });
}

// The man-overboard orchestration: the alarm effect, the MOB live-region string, and the trigger,
// cancel, and steer handlers (the v2 postMobNotification route with its v1 delta fallback and the
// in-flight-id cancel race) all live in the controller; the host wires its handlers to the MOB
// button and strip and reads mobController.mobAlert into LiveRegions. The reactive inputs (token,
// notificationsApi) are getters so the controller reads them live, not frozen at construction.
const mobController = createMobController({
  origin,
  getToken: () => chartsToken,
  mob,
  mobAlarm,
  units,
  notificationsApi: () => notificationsApi,
  writeBlocked: () => auth.writeBlocked,
  streamOpen: () => isConnectionOpen(store.connection.phase),
  publishDelta,
  flyTo: (lat, lon) => mapCommands?.flyTo(lat, lon),
  goTo: (position) => routeController.onGoToHere(position),
});

// The anchor-watch orchestration: the position-fix and drag-alarm effects, the anchor live-region
// string, the resolved transport, and the drop, raise, set-radius, and move handlers all live in the
// controller; the host wires its handlers to the anchor panel and chart and reads
// anchorController.anchorError and .anchorAlert. The reactive inputs (token, serverHasAnchorApi) are
// getters so the transport reselects as access and features resolve.
const anchorController = createAnchorController({
  origin,
  getToken: () => chartsToken,
  anchor,
  vessel,
  anchorAlarm,
  serverHasAnchorApi: () => serverFeatures?.apis.has('anchor') ?? false,
  writeBlocked: () => auth.writeBlocked,
});

// A transient action failure (a failed save, activate, delete, and similar) from the route,
// waypoint, or track controllers: shown once, app-wide, and survives the panel that raised it
// closing, unlike each controller's own panel-local error state.
const toast = new Toast();

// Route controller: owns route CRUD, activation, editing, GPX import/export, track-to-route.
const routeController = createRouteController({
  origin,
  getToken: () => chartsToken,
  writeBlocked: () => auth.writeBlocked,
  requestWriteAccess: () => auth.requestWriteAccess(),
  editBlockedReason: () =>
    measure.active
      ? 'Finish the measurement before editing a route.'
      : marineRadar.store.areaDraft?.chartEditing
        ? 'Finish the radar-area chart edit before editing a route.'
        : undefined,
  routeStore,
  courseGuidance,
  flyTo: (lat, lon) => mapCommands?.flyTo(lat, lon),
  fitBounds: (bounds) => mapCommands?.fitBounds(bounds),
  startRouteEdit: (route, initialPoint) => {
    if (!mapCommands) return false;
    mapCommands.startRouteEdit(route, initialPoint);
    return true;
  },
  stopRouteEdit: () => mapCommands?.stopRouteEdit(),
  getTrackPoints: () => recorder.points,
  toast,
});

// Waypoints controller: owns waypoints CRUD.
const waypointsController = createWaypointsController({
  origin,
  getToken: () => chartsToken,
  writeBlocked: () => auth.writeBlocked,
  requestWriteAccess: () => auth.requestWriteAccess(),
  waypointsStore,
  toast,
});

// Personal notes use the standard notes resource and a session-only confirmed-write overlay. Signal K
// remains authoritative; the local store only prevents a follow-up refresh failure from undoing an
// accepted write on the chart.
const personalNotesController = createPersonalNotesController({
  origin,
  getToken: () => chartsToken,
  writeBlocked: () => auth.writeBlocked,
  requestWriteAccess: () => auth.requestWriteAccess(),
  personalNotes: personalNotesStore,
  onSelect: (selection) => selectNote(selection),
  invalidateDetail: (id) => noteLoader?.invalidate(id),
});

// Track controller: owns saved tracks CRUD and display.
const trackController = createTrackController({
  origin,
  getToken: () => chartsToken,
  requestWriteAccess: () => auth.requestWriteAccess(),
  getRecorderPoints: () => recorder.points,
  clearRecorderThrough: (savedThroughT) => recorder.clearThrough(savedThroughT),
  toast,
});

// User charts controller: owns user chart registration and sync.
const userChartsController = createUserChartsController({
  origin,
  getToken: () => chartsToken,
  canWrite: () =>
    (auth.status === 'unsecured' || auth.status === 'authenticated') && !auth.writeBlocked,
  onSyncError: (message) => toast.show(message),
  userCharts,
  recolorMap: (t) => recolorMap?.(t),
  getTheme: () => theme.theme,
});
userCharts.setReplaceHandler(userChartsController.replaceUserChartOverlay);
userCharts.setTransitionHandler(userChartsController.handleUserChartTransition);

// Re-list the layers when an availability-gating provider appears or disappears, so a degrade overlay
// (radar, AIS trails, track history) flips between grayed-out and active without a manual panel reopen.
// The void reads register each value as a reactive dependency so this effect re-runs when any changes.
$effect(() => {
  void serverFeatures;
  void historyProviders;
  void marineRadar.store.radars.length;
  layersView?.refresh();
});

// Record the track from the vessel position (about 1 Hz); the recorder thins by the
// configured interval and min-distance. SOG is stored raw in m/s (SI).
$effect(() => {
  const position = vessel.position;
  if (position && !vessel.positionStale) {
    recorder.consider(position.latitude, position.longitude, vessel.sogMps ?? 0);
  }
});

// A fresh install (no saved view at all) otherwise leaves the map at the meaningless whole-world
// default forever, since centering only happens while following (off by default) or via an
// explicit tap: a new user's first impression is an empty planet with no boat on it. Fly to the
// vessel once its first real fix lands instead. Fires at most once per session; a manual pan or
// Follow toggle takes over from there like normal.
let flownToFirstFix = false;
$effect(() => {
  const commands = mapCommands;
  const position = vessel.position;
  if (savedView || flownToFirstFix || !commands || !position || vessel.positionStale) return;
  flownToFirstFix = true;
  commands.flyTo(position.latitude, position.longitude);
});

// Fly the chart to a position: the shared locate action for the MOB mark and AIS list rows.
function flyToPosition(position: LatLon): void {
  mapCommands?.flyTo(position.latitude, position.longitude);
}

function selectAisTarget(id: string | undefined): void {
  if (id && !aisTargets.find(id)) return;
  selectedAisId = id;
  if (id) openPanel('ais');
}

function selectWaypointFromChart(id: string): void {
  if (!waypointsStore.waypoints.some((waypoint) => waypoint.id === id)) return;
  openPanel('waypoints');
  selectedWaypointId = id;
}

function selectPoi(poi: Poi): void {
  // Same as tapping the marker on the chart: ring it in place (the highlight effect above) and open
  // its detail in the standard note popup, without moving the map.
  selectNote(
    {
      id: poi.id,
      name: poi.name,
      category: poi.category,
      position: poi.position,
      description: poi.description,
      skIcon: poi.skIcon,
      ownedByBinnacle: poi.ownedByBinnacle,
      attribution: poi.attribution,
      url: poi.url,
    },
    true,
  );
}

// Leg-fit pad fraction: the chart eases to show a highlighted leg with a margin around it.
const LEG_FIT_PAD_FRACTION = 0.3;

// Tap a leg row: toggle its cross-highlight, and ease the chart to the leg only when it is not
// already in view, so a tap on a visible leg does not jolt the camera. The dot tap on the chart sets
// the waypoint highlight directly in the chart widget; this is the list side.
function onHighlightLeg(index: number): void {
  const cur = routeStore.highlight;
  if (cur?.kind === 'leg' && cur.index === index) {
    routeStore.clearHighlight();
    return;
  }
  routeStore.setHighlight({ kind: 'leg', index });
  const wps = routeStore.working?.waypoints;
  const a = wps?.[index];
  const b = wps?.[index + 1];
  if (!a || !b) return;
  const view = mapCommands?.getBounds();
  if (view && bboxContainsPoint(view, a.position) && bboxContainsPoint(view, b.position)) return;
  const box = boundsOfPoints([a.position, b.position]);
  if (box) mapCommands?.fitBounds(padBbox(box, LEG_FIT_PAD_FRACTION));
}

// The panel confirms and cancels an in-progress edit before invoking these navigation callbacks.
function closeRoutesPanel(): void {
  routeController.clearRouteError();
  closePanel();
}
function backFromRoutesPanel(): void {
  routeController.clearRouteError();
  backToMenu();
}

function closeTracksPanel(): void {
  closePanel();
}
function backFromTracksPanel(): void {
  backToMenu();
}
function closeWaypointsPanel(): void {
  closePanel();
}
function backFromWaypointsPanel(): void {
  backToMenu();
}

// A waypoint dropped from the chart context menu saves through the dialog above with no waypoints
// panel open; a save failure surfaces on the app-wide toast rather than forcing the panel open just
// to show it, so a chart-side action does not navigate the user away to a list they never asked for.
async function confirmDroppedWaypoint(result: { name: string; icon?: string }): Promise<void> {
  await waypointsController.confirmAddWaypoint(result);
}

// "Mark that spot and go there": save the new mark, then open the Waypoints panel with its card
// current and its navigation confirm armed. Navigation still needs that confirm, which names the
// destination, so nothing starts a course on one tap.
let armNavigateWaypointId = $state<string | undefined>();
async function saveWaypointAndNavigate(result: { name: string; icon?: string }): Promise<void> {
  const saved = await waypointsController.confirmAddWaypoint(result);
  if (!saved) return;
  selectedWaypointId = saved.id;
  armNavigateWaypointId = saved.id;
  openPanel('waypoints');
}

function onStartRouteHere(position: LatLon): void {
  openPanel('routes');
  routeController.beginNewRoute(position);
}

// A brief on-screen arrival cue paired with the tone, for a helm that has the volume low. role=status
// (polite) so a screen reader hears it too, distinct from the assertive collision channel. Cleared
// after a few seconds.
let arrivalBanner = $state<string | undefined>();
let arrivalBannerTimer: ReturnType<typeof setTimeout> | undefined;

// Sound the arrival alarm and request the next point when the boat enters the active arrival circle.
let arrivedLast = false;
// How long the arrival banner stays up before it auto-clears.
const ARRIVAL_BANNER_MS = 8000;
$effect(() => {
  const arrived = courseGuidance.arrived && routeController.courseActive;
  arrivalAlarm.update(
    shouldSoundArrivalAlarm(
      courseGuidance.arrived,
      routeController.courseActive,
      arrivalMuted.value,
    ),
  );
  if (arrived && !arrivedLast) {
    // Rising edge: show the arrival banner for the point just reached, before any auto-advance moves
    // the name on. A single "go to here" has no name, so fall back to a generic label.
    arrivalBanner = courseGuidance.nextPointName ?? 'destination';
    if (arrivalBannerTimer) clearTimeout(arrivalBannerTimer);
    arrivalBannerTimer = setTimeout(() => {
      arrivalBanner = undefined;
    }, ARRIVAL_BANNER_MS);
    // Auto-advance only along a route; a single "go to here" destination has no next point to step to.
    if (routeStore.activeId !== undefined && courseGuidance.canAdvanceRoute) {
      // The streamed activeRoute.pointIndex stays authoritative, so a server that also auto-advances
      // and this request converge on the same active point. A failed advance is surfaced.
      const activeRoute = courseGuidance.activeRouteSnapshot;
      if (activeRoute) routeController.onArrivalAdvance(activeRoute);
    }
  }
  arrivedLast = arrived;
});

function closeNote(): void {
  // The highlight effect clears the chart ring once selectedNote is undefined.
  personalNotesController.clearError();
  selectedNote = undefined;
  noteReturnsToPlaces = false;
}
function selectNote(selection: NoteSelection | undefined, fromPlaces = false): void {
  personalNotesController.clearError();
  selectedNote = selection;
  noteReturnsToPlaces = Boolean(selection && fromPlaces && narrow);
  // Only yield a leading panel when actually opening a note, not when the selection clears.
  if (narrow && selection) {
    if (activePanel === 'ais') selectedAisId = undefined;
    if (activePanel === 'waypoints') selectedWaypointId = undefined;
    activePanel = null;
  }
}
function backFromNote(): void {
  selectedNote = undefined;
  noteReturnsToPlaces = false;
  openPanel('poi-search');
  setLayerVisible('notes', true);
}
// Close the POI search: clear the hovered POI and any open note so the highlight effect drops the
// chart ring and the trailing-edge detail closes with the list, then close the pane.
function closePoiSearch(): void {
  hoveredPoi = undefined;
  selectedNote = undefined;
  noteReturnsToPlaces = false;
  closePanel();
}

function backFromPoiSearch(): void {
  hoveredPoi = undefined;
  selectedNote = undefined;
  noteReturnsToPlaces = false;
  backToMenu();
}

// Browsers block audio until a user gesture; prime the shared alarm context on gestures so every
// alarm, including ones constructed later, can sound on its own. A real AudioContext resumes
// asynchronously and a browser may reject a given gesture (a bare modifier key, for one), so the
// listeners stay registered and self-remove only once a later gesture finds the context already
// running. Keydown is included so keyboard-only operators get audible alarms too. Pointerup is
// included because pointerdown carries user activation only for a mouse: on a touchscreen the
// activation arrives on release, so a helm tablet's first tap would otherwise be rejected, which
// matters now that the strip states the blocked condition instead of carrying an Enable button.
const primeAudio = () => {
  if (alarmAudioPrimed()) {
    removePrimeListeners();
    return;
  }
  primeAlarmAudio();
};
const removePrimeListeners = () => {
  window.removeEventListener('pointerdown', primeAudio);
  window.removeEventListener('pointerup', primeAudio);
  window.removeEventListener('keydown', primeAudio);
};

const CONNECTION_LABELS: Record<ConnectionPhase, string> = {
  open: 'Connected',
  connecting: 'Connecting',
  reconnecting: 'Reconnecting',
  closed: 'Not connected',
};

// An open socket with no data for this long is a silent stop (a wedged provider chain, a stale
// token the server accepted but does not authenticate), which per-tile staleness dashes never name.
const DATA_STALL_MS = 30_000;
// Gated on a data frame ever arriving, so a stock server with no producers reads plain Connected
// truthfully rather than claiming its silence is a fault.
const dataStalled = $derived(
  isConnectionOpen(store.connection.phase) &&
    store.lastDataEpoch > 0 &&
    clock.now - store.lastDataEpoch > DATA_STALL_MS,
);
const connectionLabel = $derived(
  dataStalled ? 'Connected, no data' : CONNECTION_LABELS[store.connection.phase],
);
// The fuller explanation behind the conn chip's short label: the label also feeds the visible
// stalled readout and the live announcement, so it must stay short, and this title carries the
// diagnosis a hover or chip tap reveals.
const connectionTitle = $derived(
  dataStalled
    ? "Connected to Signal K, but no data has arrived for 30 seconds; check the server's data sources."
    : isConnectionDown(store.connection.phase)
      ? 'The link to the Signal K server dropped. Binnacle retries by itself, and Reconnect retries now.'
      : 'Connected to the Signal K server.',
);
// The own fix has aged out: the footer dashes SOG and COG and shows a calm "No GPS fix" note rather
// than presenting a frozen speed and course as if they were live.
const fixStale = $derived(vessel.positionStale);
// A connected server that has never published a position must not look healthy: after a short
// startup grace (so a normal boot never flashes the chip), the strip says it is waiting for GPS.
// Distinct from fixStale, which is the had-then-lost case.
const GPS_WAIT_GRACE_MS = 8_000;
const gpsNeverReceived = new HeldFlag(
  clock,
  GPS_WAIT_GRACE_MS,
  () => isConnectionOpen(store.connection.phase) && !vessel.positionReceived,
);

// The count of AIS targets the lookout is tracking, so a quiet footer chip confirms the watch is live
// and receiving traffic, rather than leaving the navigator to wonder whether an empty danger strip
// means "all clear" or "not working". list() reads aisVersion, so the derived stays reactive.
const aisCount = $derived(aisTargets.list().length);

// AIS markers are immediately tappable when the first target arrives. Warm their small detail panel
// at that point so a chart selection cannot become the first request for its UI chunk.
$effect(() => {
  if (aisCount === 0) return;
  void loadAisListPanel().catch(() => undefined);
});

// Refresh state that a resubscribed stream cannot replay. The stream controller owns the connection
// edge detection and invokes this composition callback only for a genuine reopen after the first one.
function refreshAfterStreamReconnect(token: string | undefined): void {
  void routeController.refreshRoutes();
  void waypointsController.refreshWaypoints();
  void personalNotesController.probe();
  void refreshWeatherProvider(token);
  void refreshSymbols();
  void fetchServerFeatures(origin, token).then((features) => {
    if (features) serverFeatures = features;
    void marineRadar.start();
  });
  void probeKip(true);
  void probeHistoryProviders(
    true,
    untrack(
      () => instruments.historyStatus === 'failed' || instruments.historyStatus === 'partial',
    ),
  );
  if (instruments.open) instruments.refreshLiveCatalog();
  // A reconnect can land on a restarted or reconfigured server, so cached path meta (zones, a
  // declared staleness window) is refetched rather than trusted for the rest of the session.
  shallowController.refreshMeta();
  if (untrack(() => companionBase === null)) refreshCompanionProbe();
  void units.syncFromServer(origin);
  // The MOB replay decision reads the mirror, so it runs behind the mirror reconcile: before
  // it, the pre-outage mirror still shows the raise a restarted server has already lost, and
  // the replay guard would skip the re-raise every other station needs.
  void notificationsController
    .reconcileAfterReconnect(token)
    .then(() => mobController.onStreamReconnect());
}

// A replacement Web Worker starts its internal connection counter from zero. Offset each worker's
// frames into one page-lifetime sequence so late callbacks can be rejected without making a restarted
// worker look older than the worker it replaced.
let workerGenerationBase = 0;
const streamController = createStreamController({
  client,
  store,
  net,
  accessResolved: () => accessResolved,
  token: () => authToken,
  onToken: (token) => {
    chartsToken = token;
    noteLoader = createNoteDetailLoader(origin, () => chartsToken);
  },
  onFrame: (frame) => {
    const generation =
      frame.generation === undefined
        ? Math.max(store.generation, workerGenerationBase)
        : workerGenerationBase + frame.generation;
    // Assigned, not spread: the frame is a fresh structured clone this callback owns, and the
    // spread rebuilt it once per flush on a documented hot path.
    frame.generation = generation;
    if (!store.applyFrame(frame)) return;
    for (const [path, value] of frame.self) marineRadar.applyControlDelta(path, value);
  },
  // The open edge is the whole connect-and-reconnect story: every open re-hydrates the course
  // (the one edge tied to the socket actually delivering; hydrateAndSeedCourse serializes
  // overlapping calls), the first open replays a MOB raise or clear published before the socket
  // ever opened (a cold helm display against a still-booting server), and every later open runs
  // the reconnect refresh chain, whose notification reconcile replays MOB after the mirror
  // settles.
  onOpen: (firstOpen, token) => {
    void routeController.hydrateAndSeedCourse();
    if (firstOpen) mobController.onStreamReconnect();
    else refreshAfterStreamReconnect(token);
  },
  onWorkerRestart: () => {
    workerGenerationBase = store.generation + 1;
    instruments.resubscribe();
    trends.resubscribe();
  },
});
const streamError = $derived(streamController.error);

// Detect a configured Signal K weather provider so the panel can prefer it over the free sources.
// undefined means the TRANSPORT failed (a 401 before the token landed, a slow server): keep the
// current value and let the next trigger retry, so one bad probe cannot lock the whole session
// onto the free fallback. An answered {} genuinely means no provider and clears it.
async function refreshWeatherProvider(token: string | undefined): Promise<void> {
  const providers = await fetchWeatherProviders(origin, token);
  if (providers !== undefined) weatherProvider = defaultProvider(providers);
}

// Keyed on the auth token rather than run once at first connect, so a token that arrives later
// (an approval from another tab) or changes re-detects with the right credentials.
$effect(() => {
  if (!accessResolved) return;
  // A write-access approval changes auth.token without reconnecting the stream, and chartsToken
  // seeds only at first connect, so mirror it here or every REST write keeps using the stale
  // read-only token and 401s.
  chartsToken = authToken;
  // Saved tracks are HTTP resources, so load them even when the live WebSocket cannot connect.
  void trackController.refreshSavedTracks();
  // Routes are HTTP resources too. Course hydration remains tied to the stream lifecycle.
  void routeController.refreshRoutes();
  // Waypoints are HTTP resources too, so do not make their first load depend on the live stream.
  void waypointsController.refreshWaypoints();
  // Personal-note writes are v2-only. Recheck capability when credentials change so a newly
  // approved token or enabled provider updates the editor without a reload.
  void personalNotesController.probe();
  void refreshWeatherProvider(authToken);
  // Resolve the server's unit preferences with the same trigger: per-user resolution rides on the
  // session credentials that exist once access has resolved.
  void units.syncFromServer(origin);
  // Capability discovery; a transport failure keeps the current value so one bad probe cannot
  // drop the session back to v1 transports.
  void fetchServerFeatures(origin, authToken).then((features) => {
    if (features) serverFeatures = features;
    void marineRadar.start();
  });
  void probeKip();
  // The onMount probe runs before this token is available, so an auth-gated companion (Chart
  // Locker) 401s once and is never retried; redo it here once real credentials exist. Untracked:
  // the base this same call resolves would otherwise become a dependency, re-running this whole
  // effect (and re-firing every probe above) a second time on the first successful detection.
  if (untrack(() => companionBase === null)) refreshCompanionProbe();
  // History provider discovery: the v2 features list reports the history API even with no
  // provider registered, so the providers route is the real signal.
  // The probe reads and updates provider state internally. The auth token is already an explicit
  // dependency above, so keep those internal reads from feeding the effect back into itself.
  untrack(() => void probeHistoryProviders(false, true));
  symbolsStore.setAuth(authToken);
  void refreshSymbols();
});

const PROFILE_LOCAL_STARTUP_FALLBACK_MS = 8_000;

onMount(() => {
  refreshCompanionProbe();
  companionStatus.start();
  window.addEventListener('pointerdown', primeAudio);
  window.addEventListener('pointerup', primeAudio);
  window.addEventListener('keydown', primeAudio);
  // The auth controller owns the focus and cross-tab listeners that pick up an approval.
  auth.watch();
  void auth.probe().finally(() => {
    // A transport failure leaves auth unknown. Treat the completed probe as enough evidence to start
    // locally, so a first-run offline PWA still gets an active profile and autosave.
    if (auth.status === 'unknown') void profilesController.initializeFallback();
  });
  // A secured server can leave access approval pending for minutes. Start profiles locally after one
  // bounded network window so an offline chartplotter never loses profile autosave while it waits.
  const profileStartupFallback = setTimeout(
    () => void profilesController.initializeFallback(),
    PROFILE_LOCAL_STARTUP_FALLBACK_MS,
  );
  const refreshProfiles = (): void => {
    if (document.visibilityState === 'visible') void syncProfiles();
  };
  window.addEventListener('focus', refreshProfiles);
  document.addEventListener('visibilitychange', refreshProfiles);
  // Every write flows through sendJson, so this one hook lets a refused write (read-only token) raise
  // the read-only banner app-wide, and a later successful write clears it.
  setWriteOutcomeListener((ok, status) => auth.reportWriteOutcome(ok, status));
  const instrumentsFullScreenQuery = window.matchMedia(
    `(max-width: ${INSTRUMENTS_FULLSCREEN_BREAKPOINT_PX}px)`,
  );
  const syncInstrumentsFullScreen = (): void => {
    const next = instrumentsFullScreenQuery.matches;
    instrumentsFullScreen = next;
    if (
      next &&
      instruments.open &&
      (activePanel !== null || weatherPanelOpen || radarControlsOpen || selectedNote !== undefined)
    ) {
      instruments.setOpen(false);
    }
  };
  syncInstrumentsFullScreen();
  instrumentsFullScreenQuery.addEventListener('change', syncInstrumentsFullScreen);
  // Another open Binnacle tab may erase the shared browser storage. Reset this tab's in-memory token
  // and reload so it cannot keep using credentials or cached state that the navigator just removed.
  const privacyChannel =
    typeof BroadcastChannel === 'undefined'
      ? undefined
      : new BroadcastChannel(BINNACLE_PRIVACY_CHANNEL);
  const profileStorageKeys = new Set<string>([
    binnacleStorageKey('profiles'),
    binnacleStorageKey('profileDevice'),
  ]);
  const suspendForRemoteErase = (): void => {
    profilesController.suspend();
    window.location.reload();
  };
  const onProfileStorage = (event: StorageEvent): void => {
    if (event.newValue === null && event.key && profileStorageKeys.has(event.key)) {
      suspendForRemoteErase();
    }
  };
  window.addEventListener('storage', onProfileStorage);
  if (privacyChannel) {
    privacyChannel.onmessage = (event) => {
      if (!isRecord(event.data) || !Array.isArray(event.data.clearedOwnerIds)) return;
      if (
        event.data.type !== 'credentials-forgotten' &&
        event.data.type !== 'device-data-erased' &&
        event.data.type !== 'local-data-erased'
      ) {
        return;
      }
      if (event.data.sourceId === privacySourceId) return;
      const clearedOwnerIds = event.data.clearedOwnerIds.filter(
        (ownerId): ownerId is string => typeof ownerId === 'string',
      );
      if (clearedOwnerIds.length !== event.data.clearedOwnerIds.length) return;
      if (clearedOwnerIds.length === 0) return;
      // Stop timers, server pushes, and post-write local acknowledgements before this tab reloads,
      // or it could recreate profile data another tab just erased.
      profilesController.suspend();
      if (clearedOwnerIds.includes('signalk-credentials')) {
        auth.forgetDeviceCredentials(false);
      }
      window.location.reload();
    };
  }
  return () => {
    instrumentsFullScreenQuery.removeEventListener('change', syncInstrumentsFullScreen);
    window.removeEventListener('focus', refreshProfiles);
    document.removeEventListener('visibilitychange', refreshProfiles);
    window.removeEventListener('storage', onProfileStorage);
    privacyChannel?.close();
    clearTimeout(profileStartupFallback);
  };
});

onDestroy(() => {
  privacyActivity.dispose();
  companionStatus.stop();
  streamController.dispose();
  notificationsController.dispose();
  trends.dispose();
  timeTravel.dispose();
  if (viewSaveTimer) clearTimeout(viewSaveTimer);
  if (arrivalBannerTimer) clearTimeout(arrivalBannerTimer);
  if (privacyReloadTimer) clearTimeout(privacyReloadTimer);
  toast.dispose();
  // Harmless no-op when a primed gesture already self-removed the pair.
  removePrimeListeners();
  lookoutAlarm.stop();
  anchorAlarm.stop();
  mobAlarm.stop();
  shallowController.stop();
  arrivalAlarm.stop();
  genericAlarm.stop();
  alarmCoordinator.dispose();
  safetyAnnunciator.dispose();
  setWriteOutcomeListener(undefined);
  auth.stop();
  profilesController.dispose();
  void marineRadar.dispose();
  instruments.dispose();
  net.dispose();
  clock.dispose();
  void client.disconnect();
  // Release the Comlink proxy and terminate the worker so an HMR reload or test remount does not
  // leak it. The disconnect above is best-effort: termination can outrun the posted message, and
  // it severs the socket regardless, so the clean close is preferred but not guaranteed.
  client.dispose();
});
const plotterServices = {
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
  categoriesOpen: layerCategoriesOpen,
  arrivalMuted,
};

const plotterControllers = {
  anchorController,
  mobController,
  routeController,
  waypointsController,
  personalNotesController,
  trackController,
  marineRadar,
  tidesController,
  handoff,
};

const plotterEntities = {
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
};

const plotterActions = {
  onViewChange,
  onLayersChange: (settings: LayerSettings) => layerSettings.set(settings),
  onOrderChange: (order: string[]) => layerOrder.set(order),
  onWeatherLayersChange: (settings: LayerSettings) => weatherLayerSettings.set(settings),
  onLayersReady: (view: LayersView) => (layersView = view),
  onMapReady: (recolor: (theme: Theme) => void) => {
    recolorMap = recolor;
    recolor(theme.theme);
  },
  onCommandsReady: captureMapCommands,
  onUserChartsReady: userChartsController.onUserChartsReady,
  onMapInstance: (map: MapLibreMap) => (mapInstance = map),
  onMapDestroyed: () => (mapInstance = undefined),
  onUserPan: () => follow.release(),
  onNoteSelect: selectNote,
  onAisSelect: selectAisTarget,
  onWaypointSelect: selectWaypointFromChart,
  onTideStationSelect,
  onNotes: (notes: NotePoint[]) => (poiNotes = notes),
  onPoiStatus: (state: PoiViewState) => (poiViewState = state),
  onWeatherLayersReady: (apply: (settings: LayerSettings) => void) => (applyWeatherLayers = apply),
  onSilenceNotification,
  onAcknowledgeNotification,
  muteGenericHere,
  onRouteCoverageReport,
  openAlarmsPanel: () => openPanel('alarms'),
  closePanel,
  backToMenu,
  closeTrendsPanel,
  backFromTrendsPanel,
  openInstalledCharts,
  backToOfflineCharts,
  openLayersPanel: (mode: 'charts' | 'overlays') => {
    layersInitialMode = mode;
    openPanel('layers');
  },
  setLayerVisible,
  onRetryHistoryProviders: () => void probeHistoryProviders(true, true),
  onRetryChartLocker: () => void companionStatus.refresh(),
  armMeasure,
  moveSelectedMeasureToCenter,
  toggleCollisionMute,
  selectPoi,
  flyToPosition: (position: LatLon) => mapCommands?.flyTo(position.latitude, position.longitude),
  onShowChartBounds: (bounds: Bbox4) => mapCommands?.fitBounds(bounds),
  onHighlightLeg,
  closeRoutesPanel,
  backFromRoutesPanel,
  openRoutesPanel: () => openPanel('routes'),
  openProfilesPanel: () => openPanel('profiles'),
  openHelpPanel: () => openPanel('help'),
  enableAlarmSound: primeAlarmAudio,
  resetChartHints,
  dismissHelpOrientation: () => helpOrientationSeen.set(true),
  onDismissInsecureNote: () => insecureNoteSeen.set(true),
  onEnableNoaaEnc: enableNoaaEnc,
  onDismissEncPrompt: () => encPromptSeen.set(true),
  closeTracksPanel,
  backFromTracksPanel,
  closeWaypointsPanel,
  backFromWaypointsPanel,
  onStartRouteHere,
  closeNote,
  closePoiSearch,
  backFromPoiSearch,
  onSetRadarPower,
  openInstrumentsPanel: finishOpeningInstrumentsPanel,
};
</script>

<!-- The measured safety-rail clearance rides the shell root so App-level overlays the rail can
     float over (the full-screen instrument dock) inherit it; 0px while no alerts are up. -->
<main class="binnacle-shell" style:--rail-clearance={safetyRailClearance}>
  <LiveRegions
    safety={safetyAnnunciator.assertive}
    safetyQueue={safetyAnnunciator.polite}
    mute={muteAlert}
    companion={companionAnnounce}
  />
  <header class="topbar">
    <span class="topbar-start">
      <AppMenu
        items={menuItems}
        showTrigger={!pinnedActions.value.includes('menu')}
        open={menuOpen}
        onOpenChange={(next) => (menuOpen = next)}
        pinnedIds={pinnedActions.value}
        editing={menuEditing}
        onEditingChange={(next) => (menuEditing = next)}
        {onTogglePin}
        {onReorderPinned}
        {onResetPinned}
      />
      <span class="brand"
        >Binnacle Chartplotter <span class="version">v{__APP_VERSION__}</span></span
      >
    </span>
    <MobButton
      {mob}
      onTrigger={mobController.onTrigger}
      onLocate={flyToPosition}
      writeBlocked={auth.writeBlocked}
    />
    <span class="topbar-actions">
      {#if collisionMute.active}
        <button
          type="button"
          class="btn btn-warning btn-pill"
          aria-pressed="true"
          aria-label="Collision alarm muted, {muteRemainingMin} minutes left, tap to unmute"
          title="Collision alarm muted, {muteRemainingMin} min left, tap to unmute"
          onclick={() => collisionMute.unmute()}
        >
          <VolumeX size={16} aria-hidden="true" />
          Muted {muteRemainingMin}min
        </button>
      {/if}
      {#if updateReady}
        <button
          type="button"
          class="btn btn-primary btn-pill"
          onclick={() => {
            updateReady = false;
            pwa.update();
          }}
        >
          Update
        </button>
      {/if}
      <ChartLockerStatus
        present={companionStatus.present}
        state={companionStatus.state}
        cacheBytes={companionStatus.cacheBytes}
        accessUrl={chartLockerAccessUrl}
        onOpen={() => openPanel('regions')}
        onRetry={() => void companionStatus.refresh()}
      />
      <ProfileSwitcher
        active={profileStore.active}
        profiles={profileStore.profiles}
        hasUpdate={profileStore.remoteUpdateAvailable}
        onSelect={onApplyProfile}
        onManage={() => openPanel('profiles')}
      />
      <ThemeToggle controller={theme} />
    </span>
  </header>
  <PlotterView
    services={plotterServices}
    controllers={plotterControllers}
    entities={plotterEntities}
    actions={plotterActions}
    {routeDistanceToGoMeters}
    {chartsToken}
    {savedView}
    {currentView}
    layerSettings={layerSettings.value}
    layerOrder={layerOrder.value}
    {layersInitialMode}
    weatherLayerSettings={weatherLayerSettings.value}
    {trackPersistenceDegraded}
    {activePanel}
    {selectedAisId}
    {selectedWaypointId}
    {armNavigateWaypointId}
    {tidesOpenedFrom}
    bind:menuOpen
    bind:safetyRailClearance
    {layersView}
    {noteLoader}
    bind:selectedNote
    onBackFromNote={noteReturnsToPlaces ? backFromNote : undefined}
    bind:weatherPanelOpen
    bind:radarControlsOpen
    bind:radarOpenedFrom
    bind:radarDraftDirty
    bind:radarPanelRequest
    bind:mapInstance
    {companionBase}
    companionTiles={() => companionTileBase}
    {chartLockerAccessUrl}
    chartLockerState={companionStatus.state}
    chartLockerAdminAccess={companionStatus.state === 'serving'}
    pwaStatus={pwa.status}
    {arrivalBanner}
    toastMessage={toast.message}
    bind:hoveredPoi
    {poiInView}
    {poiViewState}
    {historyProviders}
    {serverFeatures}
    {notificationsApi}
    {audioBlocked}
    {audioState}
    helpFirstRun={!helpOrientationSeen.value}
    {showHelpWelcome}
    {showEncPrompt}
    insecureNoteDismissed={insecureNoteSeen.value}
    {weatherProvider}
    {collisionMute}
    collisionMuteRemainingMin={collisionMute.active ? muteRemainingMin : undefined}
    {alarmActionError}
    {genericAlarms}
    genericSounding={notificationsController.genericSounding}
    genericLocallyMuted={notificationsController.genericLocallyMuted}
    shallowMonitor={{
      monitorState: shallowController.monitorState,
      serverLimitMeters: shallowController.serverLimitMeters,
      serverZonesActive: shallowController.serverZonesActive,
    }}
  />

  {#if activePanel === 'profiles'}
    <div class="panel-slot" id="profiles-panel">
      {#await profilesPanelForAttempt()}
        <LazyPanelState
          title="Profiles"
          closeLabel="Close profiles panel"
          state="loading"
          message="Loading Profiles controls…"
          onClose={closePanel}
          onBack={backToMenu}
        />
      {:then module}
        <ErrorBoundary>
          <module.default
            {auth}
            {units}
            profiles={profileStore.profiles}
            activeId={profileStore.activeId}
            defaultId={profileStore.defaultId}
            syncState={profileStore.syncState}
            remoteUpdateAvailable={profileStore.remoteUpdateAvailable}
            remoteUpdateChanges={profileStore.remoteUpdateChanges}
            onRetrySync={() => void syncProfiles()}
            onApply={onApplyProfile}
            onApplyRemoteUpdate={profilesController.applyRemoteUpdate}
            onKeepCurrentSetup={profilesController.keepCurrentSetup}
            onSaveNew={onSaveNewProfile}
            onRename={(id, name) => profileStore.rename(id, name)}
            onRemove={profilesController.remove}
            onSetDefault={(id) => profileStore.setDefault(id)}
            onExport={onExportProfile}
            onImport={onImportProfiles}
            onForgetCredentials={forgetDeviceCredentials}
            onEraseAllLocalData={eraseAllLocalData}
            onClose={closePanel}
            onBack={backToMenu}
          />

          {#snippet fallback(_error, reset)}
            <LazyPanelState
              title="Profiles"
              closeLabel="Close profiles panel"
              state="error"
              message="Profiles controls stopped unexpectedly."
              onClose={closePanel}
              onBack={backToMenu}
              onRetry={reset}
            />
          {/snippet}
        </ErrorBoundary>
      {:catch}
        <LazyPanelState
          title="Profiles"
          closeLabel="Close profiles panel"
          state="error"
          message="Profiles controls could not load."
          onClose={closePanel}
          onBack={backToMenu}
          onRetry={() => (profilesPanelAttempt += 1)}
        />
      {/await}
    </div>
  {/if}

  {#snippet instrumentsState(message: string, onRetry?: () => void)}
    <!-- biome-ignore lint/a11y/useAriaPropsSupportedByRole: the dynamic role is dialog exactly when aria-modal is defined. -->
    <aside
      class="instruments"
      role={instrumentsFullScreen ? 'dialog' : undefined}
      aria-label="Instruments"
      aria-modal={instrumentsFullScreen ? 'true' : undefined}
      tabindex="-1"
      use:dialog={() => instruments.setOpen(false)}
      use:trapFocus={instrumentsFullScreen}
    >
      <PanelHeader
        title="Instruments"
        closeLabel={instrumentsFullScreen
          ? 'Close instruments, return to chart'
          : 'Close instruments dock'}
        onClose={() => instruments.setOpen(false)}
      />
      <div class="panel-body panel-body--flex">
        <div
          class:panel-loading={!onRetry}
          class:panel-load-error={onRetry !== undefined}
          role={onRetry ? 'alert' : 'status'}
        >
          <span>{message}</span>
          {#if onRetry}
            <button type="button" class="btn btn-ghost" onclick={onRetry}>Retry</button>
          {/if}
        </div>
      </div>
    </aside>
  {/snippet}

  {#snippet instrumentsMobAction()}
    <!-- The same MOB store and trigger flow as the topbar button, rendered inside the modal
         dialog subtree so full-screen Instruments always carries a reachable MOB initiation.
         Fly-to-mark closes the dock first, or the chart movement happens invisibly under it. -->
    <MobButton
      {mob}
      onTrigger={mobController.onTrigger}
      onLocate={(position) => {
        instruments.setOpen(false);
        flyToPosition(position);
      }}
      writeBlocked={auth.writeBlocked}
    />
  {/snippet}

  {#if instruments.open}
    {#await instrumentsPanelForAttempt()}
      {@render instrumentsState('Loading Instruments controls…')}
    {:then module}
      <ErrorBoundary>
        <module.default
          controller={instruments}
          deps={{ vessel, store, units, clock, course: courseGuidance }}
          fullscreen={instrumentsFullScreen}
          emergencyAction={instrumentsMobAction}
          initialDetailId={trendReturnInstrumentId}
          restoreTrendFocusId={trendReturnInstrumentId}
          onViewTrend={openFocusedTrend}
          onTrendFocusRestored={() => (trendReturnInstrumentId = undefined)}
        />

        {#snippet fallback(_error, reset)}
          {@render instrumentsState('Instruments controls stopped unexpectedly.', reset)}
        {/snippet}
      </ErrorBoundary>
    {:catch}
      {@render instrumentsState('Instruments controls could not load.', () => {
        instrumentsPanelAttempt += 1;
      })}
    {/await}
  {/if}

  <StatusStrip
    {connectionLabel}
    {connectionTitle}
    {streamError}
    {dataStalled}
    online={net.online}
    {fixStale}
    gpsNeverReceived={gpsNeverReceived.held}
    connectionPhase={store.connection.phase}
    {aisCount}
    aisUnassessed={collision.assessment.unassessed.length}
    navigating={courseGuidance.active}
    {anchor}
    {units}
    {vessel}
    shallowAlarming={shallowController.alarming}
    shallowState={shallowController.monitorState}
    {radarHealth}
    orientation={chartOrientation.value !== 'north'
      ? { label: orientation.label, active: orientation.active }
      : undefined}
    onResetOrientation={() => chartOrientation.set('north')}
    pinnedActions={resolvedPinned}
    editing={menuEditing}
    {clock}
    onOpenHelp={() => openPanel('help')}
    onOpenAnchor={() => openPanel('anchor')}
    onReconnect={() => {
      // On a fixed helm display no focus or visibility event ever re-probes an exhausted auth
      // poll, so the one visible retry action must also revalidate access, or it silently no-ops
      // while status is stuck at unknown and the stream controller refuses to connect.
      auth.recheck();
      streamController.reconnect();
    }}
  />
</main>

{#if waypointsController.addWaypointAt}
  <WaypointDialog
    defaultName={defaultSaveName('Waypoint')}
    symbols={symbolsStore}
    busy={waypointsController.busy}
    onSave={(result) => void confirmDroppedWaypoint(result)}
    onSaveAndNavigate={auth.writeBlocked
      ? undefined
      : (result) => void saveWaypointAndNavigate(result)}
    onCancel={waypointsController.cancelAddWaypoint}
  />
{/if}
{#if waypointsController.editingWaypoint}
  <!-- Key on the waypoint so editing a different one remounts the dialog and re-seeds its fields,
       rather than capturing only the first waypoint's name and icon. -->
  {#key waypointsController.editingWaypoint}
    <WaypointDialog
      defaultName={waypointsController.editingWaypoint.name}
      waypoint={waypointsController.editingWaypoint}
      symbols={symbolsStore}
      busy={waypointsController.busy}
      onSave={(result) => void waypointsController.onSaveWaypointEdit(result)}
      onCancel={waypointsController.cancelEditWaypoint}
    />
  {/key}
{/if}
{#if personalNotesController.editor}
  {#key personalNotesController.editor}
    {#await personalNoteDialogForAttempt()}
      <dialog
        class="modal-card lazy-note-dialog"
        aria-label="Loading personal note editor"
        use:dialog={personalNotesController.cancelEdit}
      >
        <p role="status">Loading personal note editor…</p>
        <button type="button" class="btn" onclick={personalNotesController.cancelEdit}>
          Cancel
        </button>
      </dialog>
    {:then module}
      <ErrorBoundary>
        <module.default
          editor={personalNotesController.editor}
          symbols={symbolsStore}
          {auth}
          capability={personalNotesController.capability}
          probing={personalNotesController.probing}
          busy={personalNotesController.busy}
          error={personalNotesController.error}
          onSave={(input) => void personalNotesController.save(input)}
          onCancel={personalNotesController.cancelEdit}
          onProbe={() => void personalNotesController.probe()}
        />

        {#snippet fallback(_error, reset)}
          <dialog
            class="modal-card lazy-note-dialog"
            aria-label="Personal note editor unavailable"
            use:dialog={personalNotesController.cancelEdit}
          >
            <p class="alert-note" role="alert">Personal note editor stopped unexpectedly.</p>
            <div class="panel-controls">
              <button type="button" class="btn btn-primary" onclick={reset}>Retry</button>
              <button type="button" class="btn" onclick={personalNotesController.cancelEdit}>
                Cancel
              </button>
            </div>
          </dialog>
        {/snippet}
      </ErrorBoundary>
    {:catch}
      <dialog
        class="modal-card lazy-note-dialog"
        aria-label="Personal note editor unavailable"
        use:dialog={personalNotesController.cancelEdit}
      >
        <p class="alert-note" role="alert">Personal note editor could not load.</p>
        <div class="panel-controls">
          <button
            type="button"
            class="btn btn-primary"
            onclick={() => (personalNoteDialogAttempt += 1)}
          >
            Retry
          </button>
          <button type="button" class="btn" onclick={personalNotesController.cancelEdit}>
            Cancel
          </button>
        </div>
      </dialog>
    {/await}
  {/key}
{/if}

<style>
.lazy-note-dialog {
  display: grid;
  gap: var(--space-3);
  inline-size: min(25rem, calc(100dvw - 2 * var(--space-4)));
  padding: var(--space-4);
}
.binnacle-shell {
  display: grid;
  grid-template-rows: auto 1fr auto;
  /* The second column is the instrument dock; it collapses to zero when the dock is closed. Every
     in-flow child is placed explicitly, because auto-placement would flow the topbar into the dock
     column. The toggle is instant by design: animating the track would resize the map per frame. */
  grid-template-columns: 1fr auto;
  /* #app is this component's sole mount target (see main.ts) and already carries the dvh-tracked
     (with a vh fallback) block-size, so inheriting it here keeps that fallback in one place. */
  block-size: 100%;
  margin-block: 0;
  margin-inline: 0;
  font-family: var(--font-ui);
  background: var(--surface);
  color: var(--text);
}
/* Three columns so the MOB button sits dead center regardless of how wide the brand and the
   action cluster are; the flanks are 1fr each so the center cannot drift. Includes Window Controls
   Overlay (WCO) support to merge seamlessly into native PWA desktop title bars. */
.topbar {
  grid-row: 1;
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: var(--space-2);

  /* Fallback standard padding */
  padding: var(--space-2) var(--space-4);

  /* Window Controls Overlay alignment */
  padding-block-start: max(var(--space-2), env(titlebar-area-y, 0px));
  min-block-size: max(var(--control-size), env(titlebar-area-height, 0px));
  padding-inline-start: max(var(--space-4), env(titlebar-area-x, 0px));
  padding-inline-end: calc(100% - env(titlebar-area-width, 100%) + var(--space-4));

  border-block-end: 1px solid var(--border);

  /* Draggable header in installed PWA windows; only the -webkit- form is implemented anywhere. */
  -webkit-app-region: drag;
}
.topbar > * {
  /* Interactive children stay clickable inside the drag region. */
  -webkit-app-region: no-drag;
}
.topbar-start {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.6rem;
  min-inline-size: 0;
}
.topbar-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-2);
  min-inline-size: 0;
}
.brand {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.version {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  font-weight: 400;
  color: var(--text-muted);
}
/* On a phone the brand yields its version string so the muted badge and the Update pill keep room.
   Phone override after the base rule: a media block before a same-specificity base is silently
   defeated by source order. It works here only because the base sets no display. */
@media (max-width: 600px) {
  .topbar {
    gap: var(--space-1);
    padding: var(--space-1) var(--space-2);
    padding-block-start: max(var(--space-1), env(titlebar-area-y, 0px));
    padding-inline-start: max(var(--space-2), env(titlebar-area-x, 0px));
    padding-inline-end: calc(100% - env(titlebar-area-width, 100%) + var(--space-2));
  }
  .topbar-actions {
    gap: var(--space-1);
  }
  .brand {
    display: none;
  }
  .version {
    display: none;
  }
}
@media (max-width: 360px) {
  .topbar-actions :global(.cl-status) {
    display: none;
  }
}
/* PlotterView's root is the chart host; place it explicitly like every other shell child, so
   auto-placement can never drift it into the dock column. */
.binnacle-shell > :global(.chart-host) {
  grid-row: 2;
  grid-column: 1;
}
.binnacle-shell > :global(.instruments) {
  grid-row: 2;
  grid-column: 2;
  display: flex;
  flex-direction: column;
  inline-size: clamp(20rem, 28vw, 24rem);
  border-inline-start: 1px solid var(--border);
  /* The dock scrolls its own tiles; without this a long tile list would stretch the shell row. */
  min-block-size: 0;
}
@media (max-width: 900px) {
  .binnacle-shell > :global(.instruments) {
    position: fixed;
    inset: 0;
    z-index: var(--z-panel);
    inline-size: auto;
    background: var(--surface);
  }
}
/* The strip's root lives inside the StatusStrip component, so the span reaches it with :global. */
.binnacle-shell :global(.status-strip) {
  grid-row: 3;
  grid-column: 1 / -1;
}
</style>
