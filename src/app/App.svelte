<script lang="ts">
import {
  Anchor,
  Bell,
  ChartLine,
  CloudSun,
  DownloadCloud,
  ExternalLink,
  Gauge,
  History,
  Layers,
  LocateFixed,
  Map as MapIcon,
  MapPin,
  Navigation,
  Radar,
  Route,
  Ruler,
  Search,
  Ship,
  Spline,
  UserCog,
  VolumeX,
  Waves,
} from '@lucide/svelte';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { onDestroy, onMount, tick, untrack } from 'svelte';
import { AisTargets, vesselLabel } from '$entities/ais';
import { AnchorWatch } from '$entities/anchor';
import { CollisionAssessment } from '$entities/collision';
import { CourseGuidance } from '$entities/course';
import { MeasureStore } from '$entities/measure';
import { MobStore } from '$entities/mob';
import { type ActiveNotification, NotificationsStore } from '$entities/notifications';
import { type ProfileSettings, ProfileStore, SignalKProfileAdapter } from '$entities/profile';
import { RouteStore, remainingRouteDistanceMeters } from '$entities/route';
import { SymbolsStore } from '$entities/symbols';
import { TidesStore } from '$entities/tides';
import { type TrackPoint, TrackRecorder } from '$entities/track';
import { UnitsStore } from '$entities/units';
import { type UserChartSource, UserCharts } from '$entities/user-charts';
import { OwnVessel } from '$entities/vessel';
import { WaypointsStore } from '$entities/waypoint';
import { WeatherStore } from '$entities/weather';
import { ANCHOR_TONE, createAnchorController } from '$features/anchor-watch';
import { createUserChartsController, deleteChart } from '$features/charts';
import {
  createInstrumentsController,
  DEFAULT_TILES,
  detectKip,
  InstrumentsPanel,
  KIP_URL,
} from '$features/instruments';
import type { LayersView } from '$features/layers-panel';
import { CollisionMute, CollisionNotifier, LookoutAlarm } from '$features/lookout';
import {
  createMarineRadarController,
  RADAR_UNAVAILABLE_HINT,
  type RadarStatus,
} from '$features/marine-radar';
import {
  AppMenu,
  DEFAULT_PINNED,
  type MenuItem,
  resolvePinned,
  togglePinned,
} from '$features/menu';
import { createMobController, MOB_TONE, MobButton } from '$features/mob';
import { ARRIVAL_TONE } from '$features/navigation';
import {
  createNoteDetailLoader,
  type NoteDetailLoader,
  type NotePoint,
  type NoteSelection,
} from '$features/notes';
import type { Poi } from '$features/poi-search';
import { CompanionStatus } from '$features/prewarm';
import {
  createProfileBindings,
  downloadProfileJson,
  type ImportedProfile,
  ProfileSwitcher,
  ProfilesPanel,
  seedStarterProfiles,
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
import { TrendSessionRecorder } from '$features/trends';
import { createWaypointsController, WaypointDialog } from '$features/waypoints';
import {
  createPointConditionsLoader,
  createWeatherLoader,
  defaultProviderName,
  fetchWeatherProviders,
  WEATHER_LAYER_IDS,
} from '$features/weather';
import { GatedAlarm } from '$shared/audio';
import { bboxContainsPoint, boundsOfPoints, type LatLon, padBbox } from '$shared/geo';
import { Clock, formatNm, formatTcpaMin, MINUTE_MS } from '$shared/lib';
import type { LayerSettings } from '$shared/map';
import { detectCompanion } from '$shared/map/companion';
import { OnlineStatus, registerPwa } from '$shared/pwa';
import {
  createMapView,
  createThresholds,
  createTrackSettings,
  isMapView,
  type MapView,
  PersistedValue,
} from '$shared/settings';
import type { ConnectionPhase, HistoryProviders } from '$shared/signalk';
import {
  ALL_VESSELS_CONTEXT,
  AuthController,
  acknowledgeNotification,
  createSignalKClient,
  fetchHistoryProviders,
  fetchServerFeatures,
  fetchSymbols,
  postNotification,
  resolveNotification,
  SELF_CONTEXT,
  type ServerFeatures,
  SignalKStore,
  SK_PATHS,
  serverOrigin,
  setWriteOutcomeListener,
  silenceNotification,
  streamUrl,
  updateNotification,
} from '$shared/signalk';
import { createTrackStore } from '$shared/storage';
import { createThemeController, defaultSaveName, type Theme } from '$shared/ui';
import type { MapCommands } from '$widgets/chart-canvas';
import { PlotterView } from '../views';
import ChartLockerStatus from './ChartLockerStatus.svelte';
import LiveRegions from './LiveRegions.svelte';
import StatusStrip from './StatusStrip.svelte';

// serverOrigin reads location, fixed for the page lifetime: capture once, not at every call site.
const origin = serverOrigin();

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
// Whether the KIP instrument webapp is installed on the server, gating the Open KIP menu item
// (dropped when absent, the Offline-charts convention for absent plugins).
let kipPresent = $state(false);
let historyProviders = $state<HistoryProviders | undefined>();
const notificationsApi = $derived(serverFeatures?.apis.has('notifications') ?? false);

function publishDelta(path: string, value: unknown): void {
  void client.publish({ context: SELF_CONTEXT, updates: [{ values: [{ path, value }] }] });
}

// So other Signal K clients and devices see the same collision alert. On a 2.28 server it rides
// the v2 Notifications API (server-managed id, silence and acknowledge work boat-wide): one id is
// raised, updated in place as the contact develops, and resolved on all-clear. Older servers get
// the v1 delta publish unchanged.
let collisionAlertId: string | undefined;
const collisionNotifier = new CollisionNotifier({
  publish: async (path, value) => {
    // Capture the derived flag once so an await mid-publish cannot see it flip when features
    // resolve, which would mix a v1 delta and a v2 raise on the same assessment change.
    const apiAvailable = notificationsApi;
    if (!apiAvailable) {
      publishDelta(path, value);
      return;
    }
    if (value.state === 'normal') {
      if (collisionAlertId) {
        const cleared = await resolveNotification(origin, chartsToken, collisionAlertId);
        collisionAlertId = undefined;
        // A failed clear would strand a raised alarm on every other station (the server only
        // reaps normal-state entries); the v1 delta still announces the all-clear.
        if (!cleared) publishDelta(path, value);
      }
      return;
    }
    if (collisionAlertId) {
      const updated = await updateNotification(origin, chartsToken, collisionAlertId, {
        state: value.state,
        message: value.message,
      });
      if (updated === 'updated') return;
      if (updated === 'failed') {
        // Transport failure: a fresh raise would also fail and could orphan a duplicate once the
        // link returns. Keep the id for the next change and let the v1 delta carry this one.
        publishDelta(path, value);
        return;
      }
      // The server reaped or lost the id (a restart): raise afresh.
      collisionAlertId = undefined;
    }
    collisionAlertId = await postNotification(origin, chartsToken, {
      state: value.state,
      message: value.message,
      path: 'navigation.collision',
      includePosition: true,
      includeCreatedAt: true,
    });
    // This alarm fires unattended: when even the raise fails, the v1 delta keeps the rest of the
    // boat informed, and the next bucket change retries the v2 path.
    if (!collisionAlertId) publishDelta(path, value);
  },
});

// Muting locally also silences the boat-wide v2 alert, so another station sees a silenced alarm
// rather than one still sounding that this helm has already quieted.
function toggleCollisionMute(): void {
  collisionMute.toggle();
  if (collisionMute.active && collisionAlertId) {
    // A refused boat-wide silence surfaces in the Alarms panel; the local mute itself stands.
    alarmActionError = undefined;
    void silenceNotification(origin, chartsToken, collisionAlertId).then((ok) => {
      if (!ok) {
        alarmActionError = 'Could not silence the alert boat-wide. Other stations may still sound.';
      }
    });
  }
}

// Every notifications.* path on the stream, mirrored for the Alarms panel's active-alert list:
// engine, NMEA2000, autopilot, and plugin alarms all surface without Binnacle knowing any of them.
const notificationsStore = new NotificationsStore(store);

// Silence and acknowledge act on the server's notification id, so the action propagates to every
// station; rows without an id (a v1-only producer) simply do not offer the buttons. A refusal
// (auth, transport) surfaces in the panel, since the alarm keeping on sounding looks identical
// to a slow stream echo otherwise.
let alarmActionError = $state<string | undefined>();
function runNotificationAction(
  notification: ActiveNotification,
  action: (base: string, token: string | undefined, id: string) => Promise<boolean>,
  failMessage: string,
): void {
  if (!notification.id) return;
  alarmActionError = undefined;
  void action(origin, chartsToken, notification.id).then((ok) => {
    if (!ok) alarmActionError = failMessage;
  });
}
function onSilenceNotification(notification: ActiveNotification): void {
  runNotificationAction(
    notification,
    silenceNotification,
    'Could not silence the alert. Check the connection and access.',
  );
}
function onAcknowledgeNotification(notification: ActiveNotification): void {
  runNotificationAction(
    notification,
    acknowledgeNotification,
    'Could not acknowledge the alert. Check the connection and access.',
  );
}

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
const recorder = new TrackRecorder(trackSettings, createTrackStore<TrackPoint>());

// Routes: planned and stored as Signal K resources, drawn by the route overlay, edited on the chart.
const routeStore = new RouteStore();
// Active-navigation guidance: prefers the server Course API and computes the derived values
// client-side when the calcValues provider is absent. The arrival alarm sounds at the waypoint.
const courseGuidance = new CourseGuidance(store, vessel);
const arrivalAlarm = new GatedAlarm(ARRIVAL_TONE);
const arrivalMuted = new PersistedValue<boolean>('binnacle:arrival-muted', false);
// The speed, in knots, used to turn a planned route's distance into per-waypoint passage times.
const planningSpeedKn = new PersistedValue<number>('binnacle:planning-speed-kn', 5);

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
  if (!route) return undefined;
  return toNext + remainingRouteDistanceMeters(route.waypoints, idx);
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
let weatherProviderName = $state<string | undefined>();
// The panel's own weather-layer visibility, separate from the nav chart. Default wind and
// waves on so the first open shows something without hunting through toggles. The panel carries no
// persisted view of its own: it always opens where the nav chart is looking.
const weatherLayerSettings = new PersistedValue<LayerSettings>('binnacle:weather-layers', {
  [WEATHER_LAYER_IDS.wind]: { visible: true, opacity: 1 },
  [WEATHER_LAYER_IDS.waves]: { visible: true, opacity: 0.7 },
});

let layersView = $state<LayersView | undefined>();
// The edge-docked panels (routes, layers, tracks, collision thresholds) are mutually exclusive: one
// docks at the leading edge at a time. A single active-panel value enforces that structurally, so
// opening one closes whatever was open without each opener having to clear the others by hand.
type LeftPanel =
  | 'routes'
  | 'layers'
  | 'tracks'
  | 'waypoints'
  | 'tides'
  | 'trends'
  | 'ais'
  | 'anchor'
  | 'alarms'
  | 'poi-search'
  | 'profiles'
  | 'regions'
  | 'charts-management';
let activePanel = $state<LeftPanel | null>(null);
// The hamburger's open state is owned here, not inside AppMenu, so a panel's back action can reopen
// the menu after it closed on selection.
let menuOpen = $state(false);
let menuEditing = $state(false);
const closePanel = (): void => {
  activePanel = null;
};
// Back returns to the menu: close the panel and reopen the hamburger in one update, so the navigator
// can move menu to panel to back to another panel without reopening the menu by hand.
const backToMenu = (): void => {
  activePanel = null;
  menuOpen = true;
};
// On a phone the note detail and a leading panel both collapse to bottom sheets and would overlap,
// so at narrow widths opening one closes the other. On a wide screen they dock to opposite edges and
// coexist, so this exclusion only applies when `narrow` is set (tracked by a matchMedia listener).
let narrow = $state(false);
const openPanel = (panel: LeftPanel): void => {
  activePanel = panel;
  if (narrow) selectedNote = undefined;
};
// Open the panel if it is closed, close it if it is already open, so a bar pill and a menu tile both
// toggle. Delegates to openPanel/closePanel to keep the narrow-width clear-selectedNote side effect.
const togglePanel = (panel: LeftPanel, onOpen?: () => void): void => {
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
let noteLoader = $state<NoteDetailLoader | undefined>();
let mapView = $state<MapView | undefined>();
// The on-screen POIs reported by the notes overlay, clipped to the live viewport for the POI search.
// Replace-only (reassigned wholesale from onNotes), so raw state skips the wasted deep proxy.
let poiNotes = $state.raw<NotePoint[]>([]);
// Reading mapView ties this to every map move, so the in-view clip recomputes on pan and zoom; the
// live bounds come from the map. The clip is only computed while the POI search panel reads it.
const poiInView = $derived.by<Poi[]>(() => {
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
let hoveredPoi = $state<Poi | undefined>();
$effect(() => {
  mapCommands?.highlightPoi(hoveredPoi?.position ?? selectedNote?.position);
});
let updateReady = $state(false);
const pwa = registerPwa(() => (updateReady = true));

const theme = createThemeController((next) => recolorMap?.(next));

// Profile state restored across visits: the last map view and the layer settings.
const mapViewStore = createMapView();
const savedView = isMapView(mapViewStore.value) ? mapViewStore.value : undefined;
// The live map view if one has been reported, else the persisted view: the fallback that the tides
// load and the weather map's initial view share.
const currentView = $derived(mapView ?? savedView);
const layerSettings = new PersistedValue<LayerSettings>('binnacle:layers', {});
const layerOrder = new PersistedValue<string[]>('binnacle:layer-order', []);
// A one-shot, device-local latch: the first time a radar is discovered, the echo layer is turned on so
// "if they have radar, the radar layer is enabled". Latched so a later explicit toggle-off is never
// overridden. Not part of a profile: it is local device state, not portable layer configuration.
const radarAutoEnabled = new PersistedValue<boolean>('binnacle:radar-autoenabled', false);
const pinnedActions = new PersistedValue<string[]>('binnacle:pinned-actions', [...DEFAULT_PINNED]);
// PersistedValue parses localStorage without a schema guard, so a corrupt or hand-edited value could
// be a non-array. Heal it to the default once at startup, so the menu's Set and the pin toggle never
// receive a non-iterable; resolvePinned defends the bar render separately.
if (!Array.isArray(pinnedActions.value as unknown)) pinnedActions.set([...DEFAULT_PINNED]);

// The instrument dock: tile selection rides profiles through this PersistedValue (the bindings
// entry reads and writes it), while the open flag stays local so a casual dock toggle never
// dirties the active profile and a profile switch never yanks the dock.
const instrumentTiles = new PersistedValue<string[]>('binnacle:instrument-tiles', [
  ...DEFAULT_TILES,
]);
const instrumentsOpen = new PersistedValue<boolean>('binnacle:instruments-open', false);
const instruments = createInstrumentsController({
  store,
  origin,
  getToken: () => authToken,
  subscribe: (entries) => void client.raw.subscribe(entries),
  unsubscribe: (paths) => void client.raw.unsubscribe(paths),
  tilesStore: instrumentTiles,
  openStore: instrumentsOpen,
});
const onTogglePin = (id: string): void => {
  pinnedActions.set(togglePinned(pinnedActions.value, id));
};
// Which Layers-panel categories the navigator has left open or closed, so the panel reopens that way.
const layerCategoriesOpen = new PersistedValue<Record<string, boolean>>(
  'binnacle:layer-categories',
  {},
);

// Profiles: named bundles of the portable settings (theme, layers, opacity, order, weather layers,
// thresholds, track and planning settings, alarm mutes) the navigator saves and switches between.
// The display-unit preference: follows the server's unit preferences when they resolve, with a
// locally persisted fallback that profiles can carry. The store stays SI; only readouts consult it.
const units = new UnitsStore();

// The raw MapLibre map instance, handed up once after the chart loads so the regions panel can mount
// its Terra Draw rectangle tool independently of the route editor.
let mapInstance = $state<MapLibreMap | undefined>();

// Companion feature-detect: resolved once at startup. Both the regions and chart-management panels
// receive the resolved base URL as a prop, so they mount ready without their own probe RTT.
let companionBase = $state<string | null>(null);

// The single owner of Chart Locker health, polled for the status strip's offline-charts chip. The base
// and token are getters so it reads them live: the base resolves after detectCompanion, and the token
// arrives after admin approval and can rotate mid-session.
const companionStatus = new CompanionStatus(
  () => companionBase,
  () => auth.token ?? null,
);

// Samples the live instruments from app start so the Trends panel has an honest in-session
// series on servers with no history provider. Stopped on destroy.
const trendRecorder = new TrendSessionRecorder();

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

// Provided chart symbols; absent on a stock server, in which case the built-ins stand. A
// symbol-manager plugin installed or updated while the link was down would otherwise leave stale
// icons until the page reloads, so the reconnect path refreshes these alongside the other resources.
async function refreshSymbols(): Promise<void> {
  const list = await fetchSymbols(origin, authToken);
  if (list) symbolsStore.setSymbols(list);
}

const profileStore = new ProfileStore();
// True only while a profile is being applied, so the dirty-tracking effect below does not flag the
// active profile as edited by its own apply writes. A plain flag, not reactive, read inside the effect.
let applying = false;
// Handed up by the weather mini-map once it is ready, to push a weather-layer snapshot at runtime.
let applyWeatherLayers = $state<((settings: LayerSettings) => void) | undefined>();
// The mini-map is destroyed with the panel; drop the stale handle on close so a later profile
// apply cannot push a snapshot into a removed map (which would throw and wedge dirty tracking).
$effect(() => {
  if (!weatherPanelOpen) applyWeatherLayers = undefined;
});

// The portable-setting binding table lives in the profiles feature (createProfileBindings); the live
// map-layer push on apply stays here, since this composition root owns the map handles.
const profileBindings = createProfileBindings({
  theme,
  layers: layerSettings,
  layerOrder,
  layerCategories: layerCategoriesOpen,
  weatherLayers: weatherLayerSettings,
  thresholds,
  trackSettings,
  planningSpeedKn,
  arrivalMuted,
  unitsLocal: units.localSetting,
  pinnedActions,
  instrumentTiles,
});

function captureProfileSettings(): ProfileSettings {
  return profileBindings.capture();
}

// Write every portable store, then push the layer snapshots to the nav chart and the weather mini-map
// so both update live. The applying guard is held until after the next tick, so the dirty effect runs
// (and skips) within the same flush rather than flagging the apply as an edit.
function applyProfileSettings(s: ProfileSettings): void {
  applying = true;
  profileBindings.apply(s);
  mapCommands?.applyLayers(s.layers, s.layerOrder);
  applyWeatherLayers?.(s.weatherLayers);
  // A profile that actually configures the radar layer is an explicit choice, so latch radar
  // auto-enable to it (a profile that deliberately keeps the echo off must win). A profile saved before
  // radar existed carries no marine-radar entry, so it must NOT latch, or it would permanently suppress
  // first-discovery auto-enable on this device.
  if (s.layers['marine-radar']) radarAutoEnabled.set(true);
  void tick().then(() => {
    applying = false;
  });
}

// Mark the active profile edited when any portable setting changes outside of an apply, so the panel
// and the top-bar switcher can offer to save the change. The primed flag skips the effect's mount
// run, which would otherwise flag a restored active profile as edited at every launch. markDirty is
// untracked: it reads activeId and isDirty, and tracking them would re-run this effect on every
// profile save or switch and instantly re-flag the just-saved profile as dirty. Only the bound
// settings may trigger it.
let dirtyTrackerPrimed = false;
$effect(() => {
  profileBindings.track();
  if (!dirtyTrackerPrimed) {
    dirtyTrackerPrimed = true;
    return;
  }
  if (!applying) untrack(() => profileStore.markDirty());
});

// Starter profiles on first run only (no stored document at all). A one-shot init check, not an
// effect keyed on live emptiness: deleting the last profile must not instantly resurrect them.
if (!profileStore.loadedFromStorage && profileStore.profiles.length === 0) {
  seedStarterProfiles(profileStore, captureProfileSettings());
}

// Once the user is authenticated to a secured server, sync profiles through the SignalK applicationData
// API so they follow the user across devices. An unsecured server (status 'unsecured', no token) keeps
// profiles local, since applicationData is disabled without security. No local latch: syncWithServer is
// idempotent while attached, and the effect re-runs only on an auth change, so a token rotation (the
// read-write upgrade approval) retries a sync that a read-only token had detached.
$effect(() => {
  if (auth.status !== 'authenticated' || !auth.token) return;
  const adapter = new SignalKProfileAdapter(origin, () => auth.token ?? undefined);
  void profileStore.syncWithServer(adapter);
});

function onApplyProfile(id: string): void {
  const profile = profileStore.profileById(id);
  if (!profile) return;
  applyProfileSettings(profile.settings);
  profileStore.setActive(id);
}

// Apply the default profile once on startup, but only when no profile is already active, so a chosen
// default takes effect on launch without overriding a profile the navigator left active last session.
let defaultApplied = false;
$effect(() => {
  if (defaultApplied) return;
  defaultApplied = true;
  if (profileStore.defaultId && profileStore.activeId === undefined) {
    onApplyProfile(profileStore.defaultId);
  }
});

function onSaveNewProfile(name: string): void {
  const profile = profileStore.save(name, captureProfileSettings());
  profileStore.setActive(profile.id);
}

function onExportProfile(id: string): void {
  const profile = profileStore.profileById(id);
  if (profile) downloadProfileJson(profile);
}

// Save each imported profile as a new one (a fresh id, so an import never overwrites an existing
// profile); the panel already parsed and validated the picked file.
function onImportProfiles(profiles: ImportedProfile[]): void {
  for (const imported of profiles) {
    profileStore.save(imported.name, imported.settings);
  }
}

// User-imported charts: URL descriptors only, persisted locally and synced to the server as chart
// resources so every station sees them. Local .pmtiles FILES are the signalk-pmtiles-plugin's job
// (it serves them as ordinary chart resources Binnacle already renders), not a browser blob store.
const userChartsStore = new PersistedValue<UserChartSource[]>('binnacle:user-charts', []);

const userCharts = new UserCharts(
  userChartsStore.value,
  (sources) => userChartsStore.set(sources),
  (source) => {
    if (source.bounds) mapCommands?.fitBounds(source.bounds);
    userChartsController.syncUrlChartToServer(source);
  },
  (source) => {
    const token = chartsToken;
    if (token) {
      void deleteChart(origin, token, source.id);
    }
  },
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
function loadTides(): void {
  if (currentView) void tidesLoader.load(tidesStore, currentView.lat, currentView.lon);
}

// Toggling the tide layer on (or opening the panel) loads tides for the current view, covering the
// fetches the gated pan-settle path skipped while nothing displayed them. The view read is
// untracked: mapView changes every frame of a pan, and depending on it would re-run this per
// frame while the layer is on; the debounced pan-settle path already covers view changes.
$effect(() => {
  if (tidesWanted) untrack(loadTides);
});

let mapCommands = $state<MapCommands | undefined>();

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

// Arming always reveals the measure layer first: an armed tool drawing into an invisible layer
// would read as broken. Arming also resets any prior points; both the menu tile and the chart's
// "Measure from here" mean "start a fresh measurement".
function armMeasure(): void {
  setLayerVisible('measure', true);
  measure.start();
}

// The marine radar controller owns the spokes worker and the echo layer. Detection runs once server
// features resolve; on a stock server discovery degrades and nothing streams. getCenter and getToken
// are getters so the radar follows the live vessel position and a token that arrives mid-session.
const marineRadar = createMarineRadarController({
  origin,
  getToken: () => chartsToken,
  getCenter: () => vessel.position ?? undefined,
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

// The /state poll only feeds the radar panel (operational status and control values), so run it only
// while the panel is open; the echo render is driven by the spoke stream, not this poll.
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

// The app menu's options, grouped into intent groups: Map (center and follow), Navigate (plan and
// chart), Conditions (weather and tides), Safety (traffic, anchor, and alarms), Offline charts (the
// companion-gated offline areas and chart files), and Settings. Adding an option is a single entry;
// the launcher renders and groups whatever it is given.
const menuItems = $derived<MenuItem[]>([
  {
    id: 'center',
    label: 'Center',
    icon: LocateFixed,
    group: 'Map',
    disabled: !mapCommands,
    disabledLabel: 'Center (chart is loading)',
    onSelect: () => mapCommands?.centerOnVessel(),
  },
  {
    id: 'follow',
    label: 'Follow',
    icon: Navigation,
    group: 'Map',
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
    onSelect: () => togglePanel('poi-search'),
  },
  // measure re-arms on every tap rather than toggling; pressed reflects the active state.
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
    onSelect: () => togglePanel('layers'),
  },
  {
    id: 'forecast',
    label: 'Forecast',
    icon: CloudSun,
    group: 'Conditions',
    pressed: weatherPanelOpen,
    onSelect: () => (weatherPanelOpen = !weatherPanelOpen),
  },
  {
    id: 'tides',
    label: 'Tides',
    icon: Waves,
    group: 'Conditions',
    pressed: activePanel === 'tides',
    onSelect: () => togglePanel('tides', loadTides),
  },
  {
    id: 'trends',
    label: 'Trends',
    icon: ChartLine,
    group: 'Conditions',
    pressed: activePanel === 'trends',
    onSelect: () => togglePanel('trends'),
  },
  {
    id: 'instruments',
    label: 'Instruments',
    icon: Gauge,
    group: 'Conditions',
    pressed: instruments.open,
    onSelect: () => instruments.toggleOpen(),
  },
  // Third-party webapp launcher: dropped entirely when KIP is absent, never grayed.
  ...(kipPresent
    ? [
        {
          id: 'open-kip',
          label: 'Open KIP',
          icon: ExternalLink,
          group: 'Conditions',
          onSelect: () => {
            window.open(KIP_URL, '_blank', 'noopener,noreferrer');
          },
        },
      ]
    : []),
  // time-travel is not a LeftPanel; it has its own active flag and enter/exit API.
  {
    id: 'time-travel',
    label: 'Replay',
    shortLabel: 'Replay',
    icon: History,
    group: 'Conditions',
    pressed: timeTravel.active,
    onSelect: () => (timeTravel.active ? timeTravel.exit() : void timeTravel.enter()),
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
    unavailableHint: RADAR_UNAVAILABLE_HINT,
    pressed: radarControlsOpen,
    onSelect: () => {
      radarOpenedFrom = 'menu';
      // The echo reveals on first radar discovery (the latched effect) and when transmit is keyed up, so
      // opening the panel must not force the layer back on: that would override an explicit toggle-off.
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
    onSelect: () => togglePanel('alarms'),
  },
  // Offline charts (companion-gated) comes before Settings so the Settings group stays last whether
  // or not the companion plugin is installed.
  ...(companionBase !== null
    ? [
        {
          id: 'regions',
          label: 'Offline areas',
          shortLabel: 'Areas',
          icon: DownloadCloud,
          group: 'Offline charts',
          pressed: activePanel === 'regions',
          // The panel mounts only once the map instance is up (it draws the area box on the chart),
          // so gray the tile until then rather than letting a tap open nothing.
          disabled: mapInstance === undefined,
          disabledLabel: 'Loading the chart...',
          onSelect: () => togglePanel('regions'),
        } satisfies MenuItem,
        {
          id: 'charts-management',
          label: 'Chart files',
          shortLabel: 'Files',
          icon: MapIcon,
          group: 'Offline charts',
          pressed: activePanel === 'charts-management',
          onSelect: () => togglePanel('charts-management'),
        } satisfies MenuItem,
      ]
    : []),
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

// Sound the collision alarm whenever the assessment, acknowledgement, mute, or escalation changes.
// Escalation past the inner ring overrides both acknowledge and mute, so a close, imminent contact
// always sounds. A stale acknowledge expires inside the assessment itself once the situation goes
// all-clear, so the same vessel re-approaching later alarms afresh.
$effect(() => {
  lookoutAlarm.update(
    collision.assessment.worst,
    collision.suppressed,
    collisionMute.active,
    collision.escalating,
    anchor.watching,
  );
});

// AIS staleness pruning, tied to the app lifecycle; the entity owns the TTL and cadence policy.
$effect(() => aisTargets.startPruning());

// A concise spoken summary of the active collision danger, written into a persistent assertive live
// region so a new threat is announced for a screen-reader or hard-of-hearing operator, not only
// sounded. It mirrors the danger strip's own visibility (contacts present and not acknowledged),
// and contacts[0] is the worst since the list is severity-then-time sorted.
const collisionAlert = $derived.by(() => {
  const { contacts } = collision.assessment;
  // Mirror the danger strip's own visibility: it un-dims and re-arms on an inner-ring escalation
  // (acknowledged = suppressed and not escalating), so the assertive announcement must return on
  // escalation too, not stay silenced. Suppressed-and-not-escalating, or no contacts, says nothing.
  if ((collision.suppressed && !collision.escalating) || contacts.length === 0) return '';
  const nearest = contacts[0];
  const who = vesselLabel(nearest.name, nearest.id);
  const count = contacts.length;
  // Lead with the worst contact's grade (contacts[0] is severity-then-time sorted), so a
  // warning-only situation is not announced as full danger.
  const lead = nearest.severity === 'warning' ? 'Collision warning' : 'Collision danger';
  return `${lead}: ${count} ${count === 1 ? 'contact' : 'contacts'}, nearest ${who}, CPA ${formatNm(nearest.cpaMeters)} nautical miles in ${formatTcpaMin(nearest.tcpaSeconds, 1)} minutes.`;
});
// A muted collision alarm is a safety state, so announce it politely; clearing it on expiry or unmute
// is silent. The mute auto-expires, so the badge shows the minutes left to make the bounded window
// and the coming re-arm obvious.
const muteAlert = $derived(collisionMute.active ? 'Collision alarm muted.' : '');
const muteRemainingMin = $derived(Math.max(1, Math.ceil(collisionMute.remainingMs / MINUTE_MS)));

// Announce a single crossing of the reachable-to-not-responding boundary through the polite live region,
// never the ticking byte count. Edge detection needs the previous value, so it uses a non-reactive
// latch in an effect rather than a derived, which would re-fire on every poll. offline and error are
// both not-responding states, but each gets its own words so the operator hears which one it is.
let companionAnnounce = $state('');
let companionWasDown = false;
$effect(() => {
  const state = companionStatus.state;
  const down = companionStatus.down;
  if (down === companionWasDown) return;
  companionWasDown = down;
  companionAnnounce = down
    ? state === 'error'
      ? 'Chart Locker reported a server error.'
      : 'Chart Locker is not responding.'
    : 'Chart Locker is responding again.';
});

// Publish the collision notification to Signal K as the assessment changes.
$effect(() => {
  collisionNotifier.update(collision.assessment);
});

// Exit time-travel review the instant a safety alarm fires: a MOB or a danger-grade collision must
// take the chart back to now. Only danger, not warning, interrupts, matching where the alarm sounds.
$effect(() => {
  if (!timeTravel.active) return;
  const dangerNow = !collision.suppressed && collision.assessment.worst === 'danger';
  // untrack the exit so writing timeTravel.active does not re-trigger this effect (it terminates
  // either way via the guard, but untrack keeps it a single clean run).
  if (mob.active || dangerNow) untrack(() => timeTravel.exit());
});

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
});

// Route controller: owns route CRUD, activation, editing, GPX import/export, track-to-route.
const routeController = createRouteController({
  origin,
  getToken: () => chartsToken,
  routeStore,
  courseGuidance,
  flyTo: (lat, lon) => mapCommands?.flyTo(lat, lon),
  fitBounds: (bounds) => mapCommands?.fitBounds(bounds),
  startRouteEdit: (route, initialPoint) => mapCommands?.startRouteEdit(route, initialPoint),
  stopRouteEdit: () => mapCommands?.stopRouteEdit(),
  getBounds: () => mapCommands?.getBounds(),
  getTrackPoints: () => recorder.points,
});

// Waypoints controller: owns waypoints CRUD.
const waypointsController = createWaypointsController({
  origin,
  getToken: () => chartsToken,
  waypointsStore,
});

// Track controller: owns saved tracks CRUD and display.
const trackController = createTrackController({
  origin,
  getToken: () => chartsToken,
  getRecorderPoints: () => recorder.points,
  clearRecorder: () => recorder.clear(),
});

// User charts controller: owns user chart registration and sync.
const userChartsController = createUserChartsController({
  origin,
  getToken: () => chartsToken,
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
  if (position) recorder.consider(position.latitude, position.longitude, vessel.sogMps ?? 0);
});

// While following, keep the map centered on the boat. Enabling it recenters immediately, and
// each new fix recenters again; a manual pan clears `following` (via onUserPan) and stops it.
$effect(() => {
  const commands = mapCommands;
  const position = vessel.position;
  if (following && position) commands?.recenterOnVessel(position.latitude, position.longitude);
});

// Fly the chart to a position: the shared locate action for the MOB mark and AIS list rows.
function flyToPosition(position: LatLon): void {
  mapCommands?.flyTo(position.latitude, position.longitude);
}

function selectPoi(poi: Poi): void {
  // Same as tapping the marker on the chart: ring it in place (the highlight effect above) and open
  // its detail in the standard note popup, without moving the map.
  selectNote({
    id: poi.id,
    name: poi.name,
    category: poi.category,
    position: poi.position,
    attribution: poi.attribution,
    url: poi.url,
  });
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

// The routes panel's close and back both cancel the in-progress edit and clear any error first.
function closeRoutesPanel(): void {
  routeController.onCancelRouteEdit();
  routeController.clearRouteError();
  closePanel();
}
function backFromRoutesPanel(): void {
  routeController.onCancelRouteEdit();
  routeController.clearRouteError();
  backToMenu();
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
  arrivalAlarm.update(arrived && !arrivalMuted.value);
  if (arrived && !arrivedLast) {
    // Rising edge: show the arrival banner for the point just reached, before any auto-advance moves
    // the name on. A single "go to here" has no name, so fall back to a generic label.
    arrivalBanner = courseGuidance.nextPointName ?? 'destination';
    if (arrivalBannerTimer) clearTimeout(arrivalBannerTimer);
    arrivalBannerTimer = setTimeout(() => {
      arrivalBanner = undefined;
    }, ARRIVAL_BANNER_MS);
    // Auto-advance only along a route; a single "go to here" destination has no next point to step to.
    if (routeStore.activeId !== undefined && !courseGuidance.isLastPoint) {
      // The streamed activeRoute.pointIndex stays authoritative, so a server that also auto-advances
      // and this request converge on the same active point. A failed advance is surfaced.
      routeController.onSkipPoint(1);
    }
  }
  arrivedLast = arrived;
});

function closeNote(): void {
  // The highlight effect clears the chart ring once selectedNote is undefined.
  selectedNote = undefined;
}
const selectNote = (selection: NoteSelection | undefined): void => {
  selectedNote = selection;
  // Only yield a leading panel when actually opening a note, not when the selection clears.
  if (narrow && selection) activePanel = null;
};
// Close the POI search: clear the hovered POI and any open note so the highlight effect drops the
// chart ring and the trailing-edge detail closes with the list, then close the pane.
function closePoiSearch(): void {
  hoveredPoi = undefined;
  selectedNote = undefined;
  closePanel();
}

// Browsers block audio until a user gesture; prime the audio contexts on the first one so the
// collision and arrival alarms can sound later on their own.
const primeAudio = () => {
  lookoutAlarm.prime();
  arrivalAlarm.prime();
  anchorAlarm.prime();
  mobAlarm.prime();
};

const CONNECTION_LABELS: Record<ConnectionPhase, string> = {
  open: 'Connected',
  connecting: 'Connecting',
  reconnecting: 'Reconnecting',
  closed: 'Not connected',
};

const connectionLabel = $derived(CONNECTION_LABELS[store.connection.phase]);
// The stream is down (not merely connecting at startup) when it is reconnecting or closed. The badge
// is colored to match, so a mid-passage drop is visible at a glance rather than reading "Connected".
const connectionDown = $derived(
  store.connection.phase === 'reconnecting' || store.connection.phase === 'closed',
);
// The own fix has aged out: the footer dashes SOG and COG and shows a calm "No GPS fix" note rather
// than presenting a frozen speed and course as if they were live.
const fixStale = $derived(vessel.positionStale);

// When the OS reports the network is back, reconnect the stream at once rather than waiting out the
// remaining backoff (up to 30 s). Only on the rising edge of online, and only while the stream is
// actually down, so a healthy connection is never dropped and reopened needlessly.
let wasOnline = net.online;
$effect(() => {
  const online = net.online;
  const down = connectionDown;
  if (online && !wasOnline && down) void client.reconnect();
  wasOnline = online;
});

// The count of AIS targets the lookout is tracking, so a quiet footer chip confirms the watch is live
// and receiving traffic, rather than leaving the navigator to wonder whether an empty danger strip
// means "all clear" or "not working". list() reads aisVersion, so the derived stays reactive.
const aisCount = $derived(aisTargets.list().length);

// Connect the stream the moment access resolves (an approved token, or an unsecured server),
// not as a one-shot blocking step. A token that arrives after a tab refocus, or from another
// tab, then connects without a reload.
let streamConnected = false;
let streamError = $state(false);
$effect(() => {
  if (streamConnected) return;
  if (!accessResolved) return;
  streamConnected = true;
  // A rejected connect (the worker failed to load, a Comlink call threw) would otherwise leave
  // streamConnected latched true with no live data and no signal, indistinguishable from
  // connecting. Surface it; recovery is a reload, so we do not re-enter the effect (that would
  // spin against a dead worker).
  connectStream(authToken).catch((error) => {
    console.error('Signal K stream failed to connect', error);
    streamError = true;
  });
});

// On a stream reconnect, re-hydrate what the resubscribe cannot redeliver. The v2 navigation.course
// paths are not in the v1 full model, so under subscribe=none the server sends no cached course
// value on resubscribe, only the next change: without this an active course would freeze on its
// pre-drop geometry (and the arrival alarm and auto-advance would run on stale values) until the
// course next changed. Self-vessel paths are in the v1 model and recover on their own; routes are
// REST resources, so refresh them too. The first open is handled by connectStream (including the
// course hydration); only a later open (a genuine reconnect) re-hydrates here.
let everOpen = false;
let lastConnectionPhase: ConnectionPhase | undefined;
$effect(() => {
  const phase = store.connection.phase;
  const reconnected = phase === 'open' && lastConnectionPhase !== 'open' && everOpen;
  lastConnectionPhase = phase;
  if (phase === 'open') everOpen = true;
  if (!reconnected) return;
  void routeController.refreshRoutes();
  void waypointsController.refreshWaypoints();
  // A provider plugin enabled while the link was down would otherwise stay undetected.
  void refreshWeatherProvider(authToken);
  // A symbol-manager plugin installed or updated while the link was down would otherwise leave the
  // waypoint and note icons stale until a reload.
  void refreshSymbols();
  // A notifications, anchor, or other capability plugin enabled while the link was down (with no
  // token change, so the token-keyed effect above does not re-run) would otherwise stay undetected
  // until a reload, leaving the alarm path stuck on the v1 fallback. Re-probe both here.
  void fetchServerFeatures(origin, authToken).then((features) => {
    if (features) serverFeatures = features;
    void marineRadar.start();
  });
  void detectKip(origin, authToken).then((present) => {
    kipPresent = present;
  });
  void fetchHistoryProviders(origin, authToken).then((providers) => {
    if (providers) historyProviders = providers;
  });
  // A unit preset changed on the server while the link was down would otherwise hold until the
  // token changes or the page reloads.
  void units.syncFromServer(origin);
  // Unconditional: a course activated from another station while the link was down would otherwise
  // stay unknown here until its next change; the hydration also reconciles the activation flags.
  void routeController.hydrateAndSeedCourse();
});

async function connectStream(token: string | undefined): Promise<void> {
  chartsToken = token;
  noteLoader = createNoteDetailLoader(origin, () => chartsToken);
  await client.connect(streamUrl(token), (frame) => store.applyFrame(frame));
  await client.raw.subscribe([
    { path: SK_PATHS.headingTrue, policy: 'instant', minPeriod: 200 },
    { path: SK_PATHS.position, policy: 'instant', minPeriod: 1000 },
    { path: SK_PATHS.courseOverGroundTrue, policy: 'instant', minPeriod: 1000 },
    { path: SK_PATHS.speedOverGround, policy: 'instant', minPeriod: 1000 },
    { path: SK_PATHS.courseNextPoint, policy: 'instant', minPeriod: 1000 },
    { path: SK_PATHS.coursePreviousPoint, policy: 'instant', minPeriod: 1000 },
    { path: SK_PATHS.courseActiveRoute, policy: 'instant', minPeriod: 1000 },
    { path: SK_PATHS.courseArrivalCircle, policy: 'instant', minPeriod: 1000 },
    { path: SK_PATHS.courseCalcValuesAll, policy: 'instant', minPeriod: 1000 },
    { path: SK_PATHS.depthBelowTransducer, policy: 'instant', minPeriod: 1000 },
    { path: SK_PATHS.windSpeedApparent, policy: 'instant', minPeriod: 1000 },
    { path: SK_PATHS.outsidePressure, policy: 'instant', minPeriod: 5000 },
    { path: SK_PATHS.anchorPosition, policy: 'instant', minPeriod: 1000 },
    { path: SK_PATHS.anchorMaxRadius, policy: 'instant', minPeriod: 1000 },
    // One wildcard row covers every notifications.* path including anchor and MOB; a specific
    // row beside it would have the server deliver those deltas twice.
    { path: SK_PATHS.allNotifications, policy: 'instant', minPeriod: 1000 },
    { path: SK_PATHS.position, context: ALL_VESSELS_CONTEXT, policy: 'fixed', period: 5000 },
    {
      path: SK_PATHS.courseOverGroundTrue,
      context: ALL_VESSELS_CONTEXT,
      policy: 'fixed',
      period: 5000,
    },
    { path: SK_PATHS.speedOverGround, context: ALL_VESSELS_CONTEXT, policy: 'fixed', period: 5000 },
    { path: SK_PATHS.headingTrue, context: ALL_VESSELS_CONTEXT, policy: 'fixed', period: 5000 },
    { path: SK_PATHS.name, context: ALL_VESSELS_CONTEXT, policy: 'fixed', period: 5000 },
    { path: SK_PATHS.aisShipType, context: ALL_VESSELS_CONTEXT, policy: 'fixed', period: 5000 },
    { path: SK_PATHS.closestApproach, context: ALL_VESSELS_CONTEXT, policy: 'fixed', period: 5000 },
  ]);
  // The reads run in parallel. The course hydration restores an in-progress course after a reload: the
  // v2 course paths send
  // nothing under subscribe=none until the next change, and the local activation flags are
  // session state, so without it a mid-passage reload leaves the nav strip, arrival alarm, and
  // auto-advance dead while the server is still navigating.
  await Promise.all([
    trackController.refreshSavedTracks(),
    routeController.refreshRoutes(),
    waypointsController.refreshWaypoints(),
    routeController.hydrateAndSeedCourse(),
  ]);
}

// Detect a configured Signal K weather provider so the panel can prefer it over the free sources.
// undefined means the TRANSPORT failed (a 401 before the token landed, a slow server): keep the
// current value and let the next trigger retry, so one bad probe cannot lock the whole session
// onto the free fallback. An answered {} genuinely means no provider and clears it.
async function refreshWeatherProvider(token: string | undefined): Promise<void> {
  const providers = await fetchWeatherProviders(origin, token);
  if (providers !== undefined) weatherProviderName = defaultProviderName(providers);
}

// Keyed on the auth token rather than run once at first connect, so a token that arrives later
// (an approval from another tab) or changes re-detects with the right credentials.
$effect(() => {
  if (!accessResolved) return;
  // A write-access approval changes auth.token without reconnecting the stream, and chartsToken
  // seeds only at first connect, so mirror it here or every REST write keeps using the stale
  // read-only token and 401s.
  chartsToken = authToken;
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
  void detectKip(origin, authToken).then((present) => {
    kipPresent = present;
  });
  // History provider discovery: the v2 features list reports the history API even with no
  // provider registered, so the providers route is the real signal.
  void fetchHistoryProviders(origin, authToken).then((providers) => {
    if (providers) historyProviders = providers;
  });
  symbolsStore.setAuth(authToken);
  void refreshSymbols();
});

// The phone breakpoint, in CSS pixels. The scoped CSS below repeats the literal because a media
// query cannot reference this constant.
const NARROW_BREAKPOINT_PX = 600;

onMount(() => {
  // origin is fixed for the page lifetime; onMount ensures this runs exactly once.
  void detectCompanion(origin).then((base) => {
    companionBase = base;
  });
  companionStatus.start();
  trendRecorder.start(() => ({
    depth: vessel.depthMeters,
    wind: vessel.windSpeedApparentMps,
    pressure: vessel.outsidePressurePa,
    sog: vessel.sogMps,
  }));
  window.addEventListener('pointerdown', primeAudio, { once: true });
  // The auth controller owns the focus and cross-tab listeners that pick up an approval.
  auth.watch();
  void auth.probe();
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
  return () => narrowQuery.removeEventListener('change', syncNarrow);
});

onDestroy(() => {
  companionStatus.stop();
  trendRecorder.stop();
  if (viewSaveTimer) clearTimeout(viewSaveTimer);
  if (arrivalBannerTimer) clearTimeout(arrivalBannerTimer);
  // Covers the case where the component unmounts before any pointer gesture; once the listener has
  // fired its `once: true` registration has already removed it, so this is a harmless no-op then.
  window.removeEventListener('pointerdown', primeAudio);
  lookoutAlarm.stop();
  anchorAlarm.stop();
  mobAlarm.stop();
  arrivalAlarm.stop();
  setWriteOutcomeListener(undefined);
  auth.stop();
  void marineRadar.dispose();
  instruments.dispose();
  net.dispose();
  clock.dispose();
  void client.disconnect();
  // Release the Comlink proxy and terminate the worker so an HMR reload or test remount does not
  // leak it; disconnect above closes the socket first.
  client.dispose();
});
</script>

<main class="binnacle-shell">
  <LiveRegions
    collision={collisionAlert}
    anchor={anchorController.anchorAlert}
    mob={mobController.mobAlert}
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
        onOpen={() => openPanel('regions')}
      />
      <ProfileSwitcher
        active={profileStore.active}
        isDirty={profileStore.isDirty}
        onClick={() => openPanel('profiles')}
      />
      <ThemeToggle controller={theme} />
    </span>
  </header>
  <PlotterView
    {origin}
    {store}
    {vessel}
    {aisTargets}
    {units}
    {auth}
    {net}
    {theme}
    {anchorController}
    {mobController}
    {routeController}
    {waypointsController}
    {trackController}
    {marineRadar}
    {anchor}
    {mob}
    {measure}
    {collision}
    {courseGuidance}
    {recorder}
    {routeStore}
    {tidesStore}
    {waypointsStore}
    {symbolsStore}
    {userCharts}
    {weather}
    {timeTravel}
    {notificationsStore}
    {trendRecorder}
    {weatherLoader}
    {pointConditionsLoader}
    {planningSpeedKn}
    {thresholds}
    {routeDistanceToGoMeters}
    {chartsToken}
    {savedView}
    {currentView}
    layerSettings={layerSettings.value}
    layerOrder={layerOrder.value}
    weatherLayerSettings={weatherLayerSettings.value}
    {trackSettings}
    categoriesOpen={layerCategoriesOpen}
    {activePanel}
    bind:menuOpen
    {layersView}
    {noteLoader}
    bind:selectedNote
    bind:weatherPanelOpen
    bind:radarControlsOpen
    bind:radarOpenedFrom
    bind:mapInstance
    {companionBase}
    {arrivalBanner}
    bind:hoveredPoi
    {poiInView}
    {historyProviders}
    {serverFeatures}
    {weatherProviderName}
    {collisionMute}
    collisionMuteRemainingMin={collisionMute.active ? muteRemainingMin : undefined}
    {alarmActionError}
    {arrivalMuted}
    {onViewChange}
    onLayersChange={(settings) => layerSettings.set(settings)}
    onOrderChange={(order) => layerOrder.set(order)}
    onWeatherLayersChange={(settings) => weatherLayerSettings.set(settings)}
    onLayersReady={(view) => (layersView = view)}
    onMapReady={(recolor) => {
      recolorMap = recolor;
      recolor(theme.theme);
    }}
    onCommandsReady={(commands) => (mapCommands = commands)}
    onUserChartsReady={(registrar) => userChartsController.onUserChartsReady(registrar)}
    onMapInstance={(m) => (mapInstance = m)}
    onMapDestroyed={() => (mapInstance = undefined)}
    onUserPan={() => (following = false)}
    onNoteSelect={(selection) => (selectedNote = selection)}
    onNotes={(notes) => (poiNotes = notes)}
    onWeatherLayersReady={(apply) => (applyWeatherLayers = apply)}
    {onSilenceNotification}
    {onAcknowledgeNotification}
    {closePanel}
    {backToMenu}
    {setLayerVisible}
    {armMeasure}
    {toggleCollisionMute}
    {selectPoi}
    flyToPosition={(position) => mapCommands?.flyTo(position.latitude, position.longitude)}
    {onHighlightLeg}
    {closeRoutesPanel}
    {backFromRoutesPanel}
    {onStartRouteHere}
    {closeNote}
    {closePoiSearch}
    {onSetRadarPower}
  />

  {#if activePanel === 'profiles'}
    <div class="panel-slot" id="profiles-panel">
      <ProfilesPanel
        profiles={profileStore.profiles}
        activeId={profileStore.activeId}
        defaultId={profileStore.defaultId}
        isDirty={profileStore.isDirty}
        onApply={onApplyProfile}
        onSaveNew={onSaveNewProfile}
        onUpdate={(id) => {
          profileStore.update(id, captureProfileSettings());
          profileStore.clearDirty();
        }}
        onRename={(id, name) => profileStore.rename(id, name)}
        onRemove={(id) => profileStore.remove(id)}
        onSetDefault={(id) => profileStore.setDefault(id)}
        onExport={onExportProfile}
        onImport={onImportProfiles}
        onClose={closePanel}
        onBack={backToMenu}
      />
    </div>
  {/if}

  {#if instruments.open}
    <InstrumentsPanel
      controller={instruments}
      deps={{ vessel, store, units, clock, course: courseGuidance }}
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
    {mapView}
    pinnedActions={resolvedPinned}
  />
</main>

{#if waypointsController.addWaypointAt}
  <WaypointDialog
    defaultName={defaultSaveName('Waypoint')}
    symbols={symbolsStore}
    onSave={(result) => void waypointsController.confirmAddWaypoint(result)}
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
  /* dvh tracks the visible viewport so the locked (overflow-hidden) shell does not hide the bottom
     strip under a mobile browser's dynamic toolbar. */
  block-size: 100dvh;
  margin-block: 0;
  margin-inline: 0;
  font-family: var(--font-ui);
  background: var(--surface);
  color: var(--text);
  /* Define this shell as a named container for responsive child components. */
  container-type: inline-size;
  container-name: shell;
}
/* Three columns so the MOB button sits dead center regardless of how wide the brand and the
   action cluster are; the flanks are 1fr each so the center cannot drift. */
.topbar {
  grid-row: 1;
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-4);
  border-block-end: 1px solid var(--border);
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
@container shell (max-width: 600px) {
  .version {
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
/* Routes, layers, tracks, and the collision thresholds all dock at the leading edge, one at a time
   (activePanel is exclusive), opposite the note detail so the two never overlap. Each panel renders
   its own slide-over shell, so the slot only positions it. */
.panel-slot {
  position: absolute;
  inset-block: 0;
  inset-inline-start: 0;
  z-index: var(--z-panel);
}
@container shell (max-width: 600px) {
  .panel-slot {
    inset-block-start: auto;
    inset-inline: 0;
    inline-size: auto;
  }
}
</style>
