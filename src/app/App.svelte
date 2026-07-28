<script lang="ts">
import Anchor from '@lucide/svelte/icons/anchor';
import Bell from '@lucide/svelte/icons/bell';
import ChartLine from '@lucide/svelte/icons/chart-line';
import CloudSun from '@lucide/svelte/icons/cloud-sun';
import DownloadCloud from '@lucide/svelte/icons/download-cloud';
import ExternalLink from '@lucide/svelte/icons/external-link';
import Gauge from '@lucide/svelte/icons/gauge';
import History from '@lucide/svelte/icons/history';
import Layers from '@lucide/svelte/icons/layers';
import LocateFixed from '@lucide/svelte/icons/locate-fixed';
import MapPin from '@lucide/svelte/icons/map-pin';
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
import { DEFAULT_TREND_INSTRUMENT_IDS } from '$entities/instrument-trend';
import { MeasureStore } from '$entities/measure';
import { MobStore } from '$entities/mob';
import { NotificationsStore } from '$entities/notifications';
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
import { ANCHOR_TONE, createAnchorController } from '$features/anchor-watch';
import { createUserChartsController } from '$features/charts';
import {
  createInstrumentsController,
  DEFAULT_TILES,
  detectKip,
  InstrumentsPanel,
  KIP_URL,
} from '$features/instruments';
import type { LayersView } from '$features/layers-panel';
import {
  CollisionMute,
  createShallowController,
  GenericAlarm,
  LookoutAlarm,
} from '$features/lookout';
import { createMarineRadarController, type RadarStatus } from '$features/marine-radar';
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
  type NoteDetailLoader,
  type NotePoint,
  type NoteSelection,
  type PoiViewState,
} from '$features/notes';
import type { Poi } from '$features/poi-search';
import { CompanionStatus } from '$features/prewarm';
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
  createTidesLoader,
  fetchSignalkTidesReading,
  SIGNALK_TIDES_PLUGIN_ID,
} from '$features/tides';
import { TimeTravelStore } from '$features/time-travel';
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
import { alarmAudioPrimed, GatedAlarm, primeAlarmAudio } from '$shared/audio';
import { type Bbox4, bboxContainsPoint, boundsOfPoints, type LatLon, padBbox } from '$shared/geo';
import { Clock, hasControlCharacters, isRecord, Toast } from '$shared/lib';
import type { CompanionProbeResult, LayerSettings } from '$shared/map';
import { probeCompanion } from '$shared/map';
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
  createMapView,
  createThresholds,
  createTrackSettings,
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
  SELF_CONTEXT,
  type ServerFeatures,
  SignalKStore,
  serverOrigin,
  setWriteOutcomeListener,
} from '$shared/signalk';
import { createTrackStore } from '$shared/storage';
import { createThemeController, defaultSaveName, type PanelId, type Theme } from '$shared/ui';
import type { MapCommands } from '$widgets/chart-canvas';
import { PlotterView } from '../views';
import ChartLockerStatus from './ChartLockerStatus.svelte';
import LiveRegions from './LiveRegions.svelte';
import { createNotificationsController } from './notifications-controller.svelte';
import StatusStrip from './StatusStrip.svelte';
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
const vessel = new OwnVessel(store, clock);
const aisTargets = new AisTargets(store);
const client = createSignalKClient();
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
const lookoutAlarm = new LookoutAlarm();
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
const anchor = new AnchorWatch(store, vessel);
const anchorAlarm = new GatedAlarm(ANCHOR_TONE);

// Man overboard: one tap on the strip button marks the spot, publishes the boat-wide alarm, and
// raises the recovery strip; a remote station's notifications.mob raises it here too.
const mob = new MobStore(store, vessel, clock);
const mobAlarm = new GatedAlarm(MOB_TONE);

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
const arrivalAlarm = new GatedAlarm(ARRIVAL_TONE);
const arrivalMuted = new PersistedValue<boolean>(
  binnacleStorageKey('arrivalMuted'),
  false,
  undefined,
  booleanPersistedCodec,
);
// The speed, in knots, used to turn a planned route's distance into per-waypoint passage times.
const planningSpeedKn = new PersistedValue<number>(
  binnacleStorageKey('planningSpeedKn'),
  5,
  undefined,
  (value): value is number =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100,
);

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
    [WEATHER_LAYER_IDS.wind]: { visible: true, opacity: 1 },
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
let profilesPanelAttempt = $state(0);
let layersInitialMode = $state<'charts' | 'overlays'>('charts');
// The hamburger's open state is owned here, not inside AppMenu, so a panel's back action can reopen
// the menu after it closed on selection.
let menuOpen = $state(false);
let menuEditing = $state(false);
const closePanel = (): void => {
  if (activePanel === 'trends') {
    trends.setOpen(false);
    trends.setFocus(undefined);
    trendReturnInstrumentId = undefined;
  }
  activePanel = null;
};
// Back returns to the menu: close the panel and reopen the hamburger in one update, so the navigator
// can move menu to panel to back to another panel without reopening the menu by hand.
const backToMenu = (): void => {
  if (activePanel === 'trends') {
    trends.setOpen(false);
    trends.setFocus(undefined);
    trendReturnInstrumentId = undefined;
  }
  activePanel = null;
  menuOpen = true;
};
function profilesPanelForAttempt() {
  void profilesPanelAttempt;
  return loadProfilesPanel();
}
const openInstalledCharts = (): void => openPanel('charts-management');
const backToOfflineCharts = (): void => openPanel('regions');
// On a phone the note detail and a leading panel both collapse to bottom sheets and would overlap,
// so at narrow widths opening one closes the other. On a wide screen they dock to opposite edges and
// coexist, so this exclusion only applies when `narrow` is set (tracked by a matchMedia listener).
let narrow = $state(false);
const openPanel = (panel: PanelId): void => {
  if (activePanel === 'trends' && panel !== 'trends') {
    trends.setOpen(false);
    trends.setFocus(undefined);
    trendReturnInstrumentId = undefined;
  }
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
// Reading mapView ties this to every map move, so the in-view clip recomputes on pan and zoom; the
// live bounds come from the map. The clip is gated behind the panel being open so it does not
// recompute on every pan frame while the POI search panel is hidden.
const poiInView = $derived.by<Poi[]>(() => {
  if (activePanel !== 'poi-search') return [];
  void mapView;
  const bounds = mapCommands?.getBounds();
  const source = bounds
    ? poiNotes.filter((note) => bboxContainsPoint(bounds, note.position))
    : poiNotes;
  return source.map((note) => ({
    id: note.id,
    name: note.name,
    position: note.position,
    category: note.category,
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

// Time-travel review: scrubs the last 24 h of recorded history, reading the same token and provider
// list as the other history clients, and degrading to an honest empty state when no provider runs.
const timeTravel = new TimeTravelStore(
  origin,
  () => chartsToken,
  () => historyProviders,
);

// Standard server waypoints: fetched from /resources/waypoints, rendered by the chart overlay,
// managed in the Waypoints panel, and dropped from the chart's long-press menu.
const waypointsStore = new WaypointsStore();

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
  cachePrefixes: appScope ? [`workbox-precache-v2-${appScope}`] : [],
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
  planningSpeedKn,
  unitsLocal: units.localSetting,
  pinnedActions,
  instrumentTiles,
  trendInstruments,
  anchorRadius: {
    get: () => anchor.preferredRadiusMeters,
    set: (radiusMeters) => anchor.rememberRadius(radiusMeters),
  },
});

// Push a profile's persisted layer snapshots to the live maps after the bindings update their stores.
function applyProfileRuntime(s: ProfileSettings): void {
  mapCommands?.applyLayers(s.layers, s.layerOrder);
  applyWeatherLayers?.(s.weatherLayers);
  // A profile that actually configures the radar layer is an explicit choice, so latch radar
  // auto-enable to it (a profile that deliberately keeps the echo off must win). A profile saved before
  // radar existed carries no marine-radar entry, so it must NOT latch, or it would permanently suppress
  // first-discovery auto-enable on this device.
  if (s.layers['marine-radar']) radarAutoEnabled.set(true);
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
  (layerSettings.value.tides?.visible ?? false) || activePanel === 'tides',
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
    if (tidesWanted) void tidesLoader.load(tidesStore, view.lat, view.lon);
  }, VIEW_SAVE_DEBOUNCE_MS);
}

// Load tides for the current view, so opening the Tides panel shows data without a pan first.
function loadTides(force = false): void {
  if (currentView) void tidesLoader.load(tidesStore, currentView.lat, currentView.lon, force);
}

// Toggling the tide layer on (or opening the panel) loads tides for the current view, covering the
// fetches the gated pan-settle path skipped while nothing displayed them. The view read is
// untracked: mapView changes every frame of a pan, and depending on it would re-run this per
// frame while the layer is on; the debounced pan-settle path already covers view changes.
$effect(() => {
  if (tidesWanted) untrack(loadTides);
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

// Follow lock: while on, the map recenters on the boat as each fix arrives. A manual pan
// (dragging the chart) releases it; it does not persist across reloads.
let following = $state(false);

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
function armMeasure(reset = false): void {
  setLayerVisible('measure', true);
  if (!measure.active || reset) measure.start();
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
});
// The radar controls slide-over opens from the radar menu tile or the radar layer row's gear;
// radarOpenedFrom records which, so its back arrow returns to the menu only when the menu opened it
// (from the gear the layers panel is still behind it, so going to the menu would strand the navigator).
let radarControlsOpen = $state(false);
let radarOpenedFrom = $state<'menu' | 'layers'>('menu');

// Auto-enable the radar echo the first time a radar is discovered, then latch so a later manual
// toggle-off in the Layers panel is never overridden. The radar layer row's toggle is disabled until a
// radar is available, so there is no pre-availability "off" to preserve, which makes a one-shot correct.
$effect(() => {
  if (!marineRadar.store.hasRadar || radarAutoEnabled.value) return;
  radarAutoEnabled.set(true);
  setLayerVisible('marine-radar', true);
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
    if (ok && status === 'transmit') setLayerVisible('marine-radar', true);
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
});

// The generic server-alarm channel: any inbound alarm or emergency grade notification outside the
// five dedicated hazards sounds through this one alarm and surfaces on the AlarmStrip, the Alarms
// badge, and the assistive channel. The controller drives it from the shared generic list. It is
// constructed before the menu registry so the Alarms entry can carry the live count.
const genericAlarm = new GenericAlarm();

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

// The app menu's options, grouped into helm-first intent groups: chart controls and navigation,
// safety, weather, instruments, optional offline charts, and settings. Adding an option is a single
// entry; the launcher renders and groups whatever it is given.
const menuItems = $derived<MenuItem[]>([
  {
    id: 'center',
    label: 'Center on boat',
    shortLabel: 'Center',
    icon: LocateFixed,
    group: 'Map',
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
    group: 'Map',
    disabled: !mapCommands || !vessel.position || vessel.positionStale,
    disabledLabel: !mapCommands
      ? 'Follow (chart is loading)'
      : vessel.positionStale
        ? 'Follow needs a fresh GPS fix.'
        : 'Follow needs a GPS position.',
    pressed: following,
    onSelect: () => (following = !following),
  },
  {
    id: 'routes',
    label: 'Routes',
    icon: Route,
    group: 'Navigate',
    disabled: !mapCommands,
    pressed: activePanel === 'routes',
    onSelect: () => togglePanel('routes'),
  },
  {
    id: 'tracks',
    label: 'Tracks',
    icon: Spline,
    group: 'Navigate',
    pressed: activePanel === 'tracks',
    onSelect: () => togglePanel('tracks'),
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
    pressed: measure.active,
    onSelect: armMeasure,
  },
  {
    id: 'layers',
    label: 'Layers and charts',
    shortLabel: 'Charts',
    icon: Layers,
    group: 'Navigate',
    disabled: !layersView,
    disabledLabel: 'Layers and charts (chart is loading)',
    pressed: activePanel === 'layers',
    onSelect: () => {
      layersInitialMode = 'charts';
      togglePanel('layers');
    },
  },
  {
    id: 'ais',
    label: 'Nearby vessels (AIS)',
    shortLabel: 'AIS',
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
      radarControlsOpen = !radarControlsOpen;
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
    onSelect: () => togglePanel('alarms'),
  },
  {
    id: 'forecast',
    label: 'Forecast',
    icon: CloudSun,
    group: 'Weather',
    pressed: weatherPanelOpen,
    onSelect: () => (weatherPanelOpen = !weatherPanelOpen),
  },
  {
    id: 'tides',
    label: 'Tides',
    icon: Waves,
    group: 'Weather',
    pressed: activePanel === 'tides',
    onSelect: () => togglePanel('tides', loadTides),
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
    id: 'instruments',
    label: 'Instruments',
    icon: Gauge,
    group: 'Instruments',
    pressed: instruments.open,
    onSelect: () => instruments.toggleOpen(),
  },
  {
    id: 'open-kip',
    label: 'Open KIP',
    icon: ExternalLink,
    group: 'Instruments',
    available: kipPresent === true,
    unavailableHint:
      kipProbeState === 'checking' || kipProbeState === 'retrying'
        ? 'Checking whether the KIP webapp is installed on the Signal K server.'
        : kipProbeState === 'failed'
          ? 'Could not check for KIP. Reconnect or reload to retry.'
          : 'Open KIP needs the KIP webapp installed on the Signal K server.',
    onSelect: () => {
      const opened = window.open(KIP_URL, '_blank', 'noopener,noreferrer');
      if (!opened) toast.show('The browser blocked the KIP window. Allow pop-ups, then try again.');
    },
  },
  // Time travel is not a LeftPanel; it has its own active flag and enter and exit API. It grays like
  // the radar tile when no history provider is known, rather than opening to an empty mode.
  {
    id: 'time-travel',
    label: 'Time travel',
    shortLabel: 'Replay',
    icon: History,
    group: 'Instruments',
    available: (historyProviders?.ids.length ?? 0) > 0,
    unavailableHint:
      historyProviderState === 'checking' || historyProviderState === 'retrying'
        ? 'Checking for a Signal K history provider.'
        : historyProviderState === 'failed'
          ? 'Could not check for a history provider. Open Data trends to retry.'
          : 'Time travel needs a history provider plugin on the server, such as signalk-questdb.',
    pressed: timeTravel.active,
    onSelect: () => (timeTravel.active ? timeTravel.exit() : void timeTravel.enter()),
  },
  // Keep this safety-relevant capability discoverable even when its optional provider is absent. The
  // tile explains the exact requirement instead of disappearing, then becomes the single landing
  // place for saved areas, automatic caching, installed charts, and storage when Chart Locker appears.
  {
    id: 'regions',
    label: 'Offline charts',
    shortLabel: 'Offline',
    icon: DownloadCloud,
    group: 'Offline charts',
    available: companionBase !== null,
    unavailableHint:
      companionProbe === undefined
        ? 'Checking whether Chart Locker is available on the Signal K server.'
        : companionProbe.state === 'access-refused'
          ? 'Signal K refused access to the Chart Locker route. Sign in to Signal K administration, then approve Binnacle read access on a secured server.'
          : companionProbe.state === 'absent'
            ? 'Install and start signalk-chart-locker from the Signal K Appstore to enable offline charts.'
            : 'Chart Locker could not be reached. Check the Signal K connection and Chart Locker service, then retry.',
    pressed: activePanel === 'regions' || activePanel === 'charts-management',
    // The landing panel draws saved-area bounds on the chart, so wait for MapLibre once the provider
    // exists. An absent provider uses available rather than disabled so tapping explains the setup.
    disabled: companionBase !== null && mapInstance === undefined,
    disabledLabel: 'Offline charts (chart is loading)',
    onSelect: () => togglePanel('regions'),
  },
  {
    id: 'profiles',
    label: 'Profiles',
    icon: UserCog,
    group: 'Settings',
    pressed: activePanel === 'profiles',
    onSelect: () => togglePanel('profiles'),
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
  waypointsStore,
  toast,
});

// Track controller: owns saved tracks CRUD and display.
const trackController = createTrackController({
  origin,
  getToken: () => chartsToken,
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

// While following, keep the map centered on the boat. Enabling it recenters immediately, and
// each new fix recenters again; a manual pan clears `following` (via onUserPan) and stops it.
$effect(() => {
  const commands = mapCommands;
  const position = vessel.position;
  const positionStale = vessel.positionStale;
  if (following && positionStale) {
    following = false;
    return;
  }
  if (following && position) commands?.recenterOnVessel(position.latitude, position.longitude);
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

function selectPoi(poi: Poi): void {
  // Same as tapping the marker on the chart: ring it in place (the highlight effect above) and open
  // its detail in the standard note popup, without moving the map.
  selectNote(
    {
      id: poi.id,
      name: poi.name,
      category: poi.category,
      position: poi.position,
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
  selectedNote = undefined;
  noteReturnsToPlaces = false;
}
const selectNote = (selection: NoteSelection | undefined, fromPlaces = false): void => {
  selectedNote = selection;
  noteReturnsToPlaces = Boolean(selection && fromPlaces && narrow);
  // Only yield a leading panel when actually opening a note, not when the selection clears.
  if (narrow && selection) activePanel = null;
};
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
// running. Keydown is included so keyboard-only operators get audible alarms too.
const primeAudio = () => {
  if (alarmAudioPrimed()) {
    removePrimeListeners();
    return;
  }
  primeAlarmAudio();
};
const removePrimeListeners = () => {
  window.removeEventListener('pointerdown', primeAudio);
  window.removeEventListener('keydown', primeAudio);
};

const CONNECTION_LABELS: Record<ConnectionPhase, string> = {
  open: 'Connected',
  connecting: 'Connecting',
  reconnecting: 'Reconnecting',
  closed: 'Not connected',
};

const connectionLabel = $derived(CONNECTION_LABELS[store.connection.phase]);
// The own fix has aged out: the footer dashes SOG and COG and shows a calm "No GPS fix" note rather
// than presenting a frozen speed and course as if they were live.
const fixStale = $derived(vessel.positionStale);

// The count of AIS targets the lookout is tracking, so a quiet footer chip confirms the watch is live
// and receiving traffic, rather than leaving the navigator to wonder whether an empty danger strip
// means "all clear" or "not working". list() reads aisVersion, so the derived stays reactive.
const aisCount = $derived(aisTargets.list().length);

// Refresh state that a resubscribed stream cannot replay. The stream controller owns the connection
// edge detection and invokes this composition callback only for a genuine reopen after the first one.
function refreshAfterStreamReconnect(token: string | undefined): void {
  void routeController.refreshRoutes();
  void waypointsController.refreshWaypoints();
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
  if (untrack(() => companionBase === null)) refreshCompanionProbe();
  void units.syncFromServer(origin);
  void routeController.hydrateAndSeedCourse();
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
    if (!store.applyFrame({ ...frame, generation })) return;
    for (const [path, value] of frame.self) marineRadar.applyControlDelta(path, value);
  },
  onInitialSubscription: async () => {
    await routeController.hydrateAndSeedCourse();
  },
  onReconnect: refreshAfterStreamReconnect,
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

// The phone breakpoint, in CSS pixels. A media query cannot reference this constant, so the same
// 600px literal is mirrored in the `@media (max-width: 600px)` blocks in styles/panels.css and the
// scoped styles of ChartLockerStatus, WeatherMap, AppMenu, WeatherConditions, and the
// scoped CSS below. This const is the source of truth; retune all of them together.
const NARROW_BREAKPOINT_PX = 600;
const PROFILE_LOCAL_STARTUP_FALLBACK_MS = 8_000;

onMount(() => {
  refreshCompanionProbe();
  companionStatus.start();
  window.addEventListener('pointerdown', primeAudio);
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
  // Track the phone breakpoint so the note detail and a leading panel can be made mutually exclusive
  // at narrow widths, where they would otherwise both bottom-dock and overlap. The scoped CSS media
  // queries hardcode the same value, since a media query cannot reference a JS constant or CSS var.
  const narrowQuery = window.matchMedia(`(max-width: ${NARROW_BREAKPOINT_PX}px)`);
  const syncNarrow = (): void => {
    narrow = narrowQuery.matches;
  };
  syncNarrow();
  narrowQuery.addEventListener('change', syncNarrow);
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
    narrowQuery.removeEventListener('change', syncNarrow);
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
  categoriesOpen: layerCategoriesOpen,
  arrivalMuted,
};

const plotterControllers = {
  anchorController,
  mobController,
  routeController,
  waypointsController,
  trackController,
  marineRadar,
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
  onUserPan: () => (following = false),
  onNoteSelect: selectNote,
  onNotes: (notes: NotePoint[]) => (poiNotes = notes),
  onPoiStatus: (state: PoiViewState) => (poiViewState = state),
  onWeatherLayersReady: (apply: (settings: LayerSettings) => void) => (applyWeatherLayers = apply),
  onSilenceNotification,
  onAcknowledgeNotification,
  muteGenericHere,
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
  onRetryTides: () => loadTides(true),
  onRetryHistoryProviders: () => void probeHistoryProviders(true, true),
  onRetryChartLocker: () => void companionStatus.refresh(),
  armMeasure,
  toggleCollisionMute,
  selectPoi,
  flyToPosition: (position: LatLon) => mapCommands?.flyTo(position.latitude, position.longitude),
  onShowChartBounds: (bounds: Bbox4) => mapCommands?.fitBounds(bounds),
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
};
</script>

<main class="binnacle-shell">
  <LiveRegions
    collision={collisionAlert}
    anchor={anchorController.anchorAlert}
    mob={mobController.mobAlert}
    shallow={shallowController.alert}
    notification={genericNotificationAlert}
    mute={muteAlert}
    companion={companionAnnounce}
  />
  <header class="topbar">
    <span class="topbar-start">
      <AppMenu
        items={menuItems}
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
    <MobButton {mob} onTrigger={mobController.onTrigger} onLocate={flyToPosition} />
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
          Muted {muteRemainingMin}m
        </button>
      {/if}
      {#if updateReady}
        <button type="button" class="btn btn-primary btn-pill" onclick={() => pwa.update()}>
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
      <ProfileSwitcher active={profileStore.active} onClick={() => openPanel('profiles')} />
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
    bind:menuOpen
    {layersView}
    {noteLoader}
    bind:selectedNote
    onBackFromNote={noteReturnsToPlaces ? backFromNote : undefined}
    bind:weatherPanelOpen
    bind:radarControlsOpen
    bind:radarOpenedFrom
    bind:mapInstance
    {companionBase}
    {chartLockerAccessUrl}
    chartLockerState={companionStatus.state}
    chartLockerAdminAccess={companionStatus.state === 'serving'}
    {arrivalBanner}
    toastMessage={toast.message}
    bind:hoveredPoi
    {poiInView}
    {poiViewState}
    {historyProviders}
    {serverFeatures}
    {notificationsApi}
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
        <div class="slide-over slide-over--dock-left panel-loading" role="status">
          Loading profiles…
        </div>
      {:then module}
        <module.default
          {auth}
          profiles={profileStore.profiles}
          activeId={profileStore.activeId}
          defaultId={profileStore.defaultId}
          syncState={profileStore.syncState}
          remoteUpdateAvailable={profileStore.remoteUpdateAvailable}
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
      {:catch}
        <div class="slide-over slide-over--dock-left panel-load-error" role="alert">
          Profiles could not load.
          <button type="button" class="btn btn-ghost" onclick={() => (profilesPanelAttempt += 1)}>
            Retry
          </button>
        </div>
      {/await}
    </div>
  {/if}

  {#if instruments.open}
    <InstrumentsPanel
      controller={instruments}
      deps={{ vessel, store, units, clock, course: courseGuidance }}
      initialDetailId={trendReturnInstrumentId}
      restoreTrendFocusId={trendReturnInstrumentId}
      onViewTrend={openFocusedTrend}
      onTrendFocusRestored={() => (trendReturnInstrumentId = undefined)}
    />
  {/if}

  <StatusStrip
    {connectionLabel}
    {streamError}
    online={net.online}
    {fixStale}
    connectionPhase={store.connection.phase}
    {aisCount}
    {anchor}
    {units}
    {vessel}
    shallowAlarming={shallowController.alarming}
    pinnedActions={resolvedPinned}
    editing={menuEditing}
    {clock}
    onReconnect={() => streamController.reconnect()}
  />
</main>

{#if waypointsController.addWaypointAt}
  <WaypointDialog
    defaultName={defaultSaveName('Waypoint')}
    symbols={symbolsStore}
    busy={waypointsController.busy}
    onSave={(result) => void confirmDroppedWaypoint(result)}
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

<style>
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
  /* The dock scrolls its own tiles; without this a long tile list would stretch the shell row. */
  min-block-size: 0;
}
/* The strip's root lives inside the StatusStrip component, so the span reaches it with :global. */
.binnacle-shell :global(.status-strip) {
  grid-row: 3;
  grid-column: 1 / -1;
}
</style>
