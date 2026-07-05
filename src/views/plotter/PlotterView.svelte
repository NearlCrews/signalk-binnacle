<script lang="ts">
import type { Map as MapLibreMap } from 'maplibre-gl';
import type { AisTargets } from '$entities/ais';
import type { AnchorWatch } from '$entities/anchor';
import type { CollisionAssessment } from '$entities/collision';
import type { CourseGuidance } from '$entities/course';
import type { MeasureStore } from '$entities/measure';
import type { MobStore } from '$entities/mob';
import type { ActiveNotification, NotificationsStore } from '$entities/notifications';
import type { NotePoint } from '$entities/poi';
import type { RouteStore } from '$entities/route';
import type { SymbolsStore } from '$entities/symbols';
import type { TidesStore } from '$entities/tides';
import type { TrackRecorder } from '$entities/track';
import type { UnitsStore } from '$entities/units';
import type { UserCharts } from '$entities/user-charts';
import type { OwnVessel } from '$entities/vessel';
import type { WaypointsStore } from '$entities/waypoint';
import type { WeatherStore } from '$entities/weather';
import { AisListPanel } from '$features/ais-list';
import { AnchorPanel, AnchorStrip } from '$features/anchor-watch';
import { AuthBanner } from '$features/auth-banner';
import { ChartsManagementPanel } from '$features/charts-management';
import { LayersPanel, type LayersView } from '$features/layers-panel';
import { AlarmsPanel, DangerStrip } from '$features/lookout';
import { RadarControls } from '$features/marine-radar';
import { MeasureStrip } from '$features/measure';
import { MobStrip } from '$features/mob';
import { NavStrip, type RouteProgress } from '$features/navigation';
import { type NoteDetailLoader, NoteDetailPanel, type NoteSelection } from '$features/notes';
import { type Poi, PoiSearchPanel } from '$features/poi-search';
import { RegionsPanel } from '$features/prewarm';
import { RoutesPanel } from '$features/routing';
import { TidesPanel } from '$features/tides';
import { HistoryStrip, type TimeTravelStore } from '$features/time-travel';
import { TracksPanel } from '$features/tracks';
import { TrendsPanel } from '$features/trends';
import { WaypointsPanel } from '$features/waypoints';
import type { LatLon } from '$shared/geo';
import type { LayerSettings } from '$shared/map';
import { etaSeconds } from '$shared/nav';
import type { OnlineStatus } from '$shared/pwa';
import type {
  AuthController,
  HistoryProviders,
  ServerFeatures,
  SignalKStore,
} from '$shared/signalk';
import { SlideOver, type Theme, type ThemeController } from '$shared/ui';
import { ChartCanvas, type MapCommands, type UserChartRegistrar } from '$widgets/chart-canvas';
import { WeatherMap } from '$widgets/weather-map';

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

interface Props {
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
  timeTravel: TimeTravelStore;
  notificationsStore: NotificationsStore;

  // Additional services & loaders
  trendRecorder: import('$features/trends').TrendSessionRecorder;
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
  weatherLayerSettings: LayerSettings;
  trackSettings: import('$shared/settings').PersistedValue<
    import('$shared/settings').TrackSettings
  >;
  categoriesOpen: import('$shared/settings').PersistedValue<Record<string, boolean>>;

  // Panel state
  activePanel: string | null;
  menuOpen: boolean;
  layersView: LayersView | undefined;
  noteLoader: NoteDetailLoader | undefined;
  selectedNote: NoteSelection | undefined;
  weatherPanelOpen: boolean;
  radarControlsOpen: boolean;
  radarOpenedFrom: 'menu' | 'layers';
  mapInstance: MapLibreMap | undefined;
  companionBase: string | null;
  arrivalBanner: string | undefined;
  hoveredPoi: Poi | undefined;
  poiInView: Poi[];
  historyProviders: HistoryProviders | undefined;
  serverFeatures: ServerFeatures | undefined;
  weatherProviderName: string | undefined;
  collisionMute: { active: boolean };
  collisionMuteRemainingMin: number | undefined;
  alarmActionError: string | undefined;
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
  onNotes: (notes: NotePoint[]) => void;
  onWeatherLayersReady: (apply: (settings: LayerSettings) => void) => void;

  // Panel actions
  closePanel: () => void;
  backToMenu: () => void;
  setLayerVisible: (id: string, visible: boolean) => void;
  // Arms the measure tool (shows the layer and resets prior points); owned by the shell so the
  // menu tile and the chart's context action share one meaning.
  armMeasure: () => void;
  toggleCollisionMute: () => void;
  onSilenceNotification: (notification: ActiveNotification) => void;
  onAcknowledgeNotification: (notification: ActiveNotification) => void;
  selectPoi: (poi: Poi) => void;
  flyToPosition: (position: LatLon) => void;
  onHighlightLeg: (index: number) => void;
  closeRoutesPanel: () => void;
  backFromRoutesPanel: () => void;
  onStartRouteHere: (position: LatLon) => void;
  closeNote: () => void;
  closePoiSearch: () => void;
  onSetRadarPower: (status: import('$features/marine-radar').RadarStatus) => void;
}

let {
  origin,
  store,
  vessel,
  aisTargets,
  units,
  auth,
  net,
  theme,
  anchorController,
  mobController,
  routeController,
  waypointsController,
  trackController,
  marineRadar,
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
  trendRecorder,
  weatherLoader,
  pointConditionsLoader,
  planningSpeedKn,
  thresholds,
  routeDistanceToGoMeters,
  chartsToken,
  savedView,
  currentView,
  layerSettings,
  layerOrder,
  weatherLayerSettings,
  trackSettings,
  categoriesOpen,
  activePanel,
  menuOpen = $bindable(),
  layersView,
  noteLoader,
  selectedNote = $bindable(),
  weatherPanelOpen = $bindable(),
  radarControlsOpen = $bindable(),
  radarOpenedFrom = $bindable(),
  mapInstance = $bindable(),
  companionBase,
  arrivalBanner,
  hoveredPoi = $bindable(),
  poiInView,
  historyProviders,
  serverFeatures,
  weatherProviderName,
  collisionMute,
  collisionMuteRemainingMin,
  alarmActionError,
  arrivalMuted,
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
  onNotes,
  onWeatherLayersReady,
  closePanel,
  backToMenu,
  setLayerVisible,
  armMeasure,
  toggleCollisionMute,
  onSilenceNotification,
  onAcknowledgeNotification,
  selectPoi,
  flyToPosition,
  onHighlightLeg,
  closeRoutesPanel,
  backFromRoutesPanel,
  onStartRouteHere,
  closeNote,
  closePoiSearch,
  onSetRadarPower,
}: Props = $props();

let mapCommands = $state<MapCommands | undefined>();

const accessRequestsUrl = $derived(`${origin}/admin/#/security/access/requests`);
const notificationsApi = $derived(serverFeatures?.apis.has('notifications') ?? false);
const radarEchoShown = $derived(layerSettings['marine-radar']?.visible ?? false);
const routeProgress = $derived.by<RouteProgress | undefined>(() => {
  const distanceToGoMeters = routeDistanceToGoMeters;
  if (distanceToGoMeters == null) return undefined;
  const sog = vessel.sogMps;
  return {
    distanceToGoMeters,
    timeToGoSeconds: sog == null ? undefined : etaSeconds(distanceToGoMeters, sog),
  };
});

$effect(() => {
  mapCommands?.highlightPoi(hoveredPoi?.position ?? selectedNote?.position);
});

$effect(() => {
  if (mapCommands) onCommandsReady(mapCommands);
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
    {onViewChange}
    {onNoteSelect}
    {onNotes}
    {onUserPan}
    onGoToHere={(position) => void routeController.onGoToHere(position)}
    onStartRoute={onStartRouteHere}
    onMeasureFrom={(position) => {
      armMeasure();
      measure.add(position);
    }}
    onRouteEditorError={() =>
      routeController.flagRouteError('The route editor failed to load. Reload to edit routes.')}
    onAnchorMoved={(position) => void anchorController.onAnchorMoved(position)}
    marineRadarLayer={marineRadar.layer}
    {onMapInstance}
    {onMapDestroyed}
  />
  <div class="banner-slot">
    <AuthBanner {auth} requestsUrl={accessRequestsUrl} />
  </div>
  {#if arrivalBanner}
    <div class="arrival-banner" role="status">Arrived at {arrivalBanner}</div>
  {/if}
  <div class="bottom-stack" class:above-weather={weatherPanelOpen}>
    <HistoryStrip store={timeTravel} {units} onExit={() => timeTravel.exit()} />
    <NavStrip
      guidance={courseGuidance}
      {routeProgress}
      onStop={() => routeController.onStopCourse()}
      onSkip={routeStore.activeId !== undefined ? routeController.onSkipPoint : undefined}
    />
    <MeasureStrip {measure} {units} />
    <AnchorStrip {anchor} {units} onRaise={() => void anchorController.onRaise()} />
    <DangerStrip {collision} muted={collisionMute.active} onToggleMute={toggleCollisionMute} />
    <MobStrip {mob} {units} onSteer={mobController.onSteer} onCancel={mobController.onCancel} />
  </div>
  {#if selectedNote && noteLoader}
    <div class="note-panel-slot">
      <NoteDetailPanel
        selection={selectedNote}
        load={noteLoader.load}
        onClose={closeNote}
        onLocate={() => selectedNote && flyToPosition(selectedNote.position)}
      />
    </div>
  {/if}
  {#if activePanel}
    <div class="panel-slot" id={activePanel === 'layers' ? 'layers-panel' : undefined}>
      {#if activePanel === 'layers' && layersView}
        <LayersPanel
          view={layersView}
          {userCharts}
          {categoriesOpen}
          onClose={closePanel}
          onBack={backToMenu}
          onManageLayer={(id) => {
            if (id === 'marine-radar') {
              radarOpenedFrom = 'layers';
              radarControlsOpen = true;
            }
          }}
        />
      {:else if activePanel === 'routes'}
        <RoutesPanel
          routes={routeStore.routes}
          shownIds={routeStore.shownIds}
          working={routeStore.working}
          activeId={routeStore.activeId}
          highlight={routeStore.highlight}
          {onHighlightLeg}
          error={routeController.routeError}
          onNew={routeController.beginNewRoute}
          onEditRoute={routeController.onEditRoute}
          onSave={routeController.onSaveRoute}
          onCancelEdit={routeController.onCancelRouteEdit}
          onToggleShown={routeController.onToggleRouteShown}
          onLocate={routeController.flyToRouteStart}
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
          {recorder}
          settings={trackSettings}
          saved={trackController.savedTracks}
          shown={trackController.shownSaved}
          onSave={trackController.onSaveTrack}
          onSaveAsRoute={routeController.onSaveTrackAsRoute}
          onTrackHome={routeController.onTrackHome}
          onDelete={trackController.onDeleteSavedTrack}
          onToggleSaved={trackController.onToggleSaved}
          onExport={trackController.onExportSavedTrack}
          error={trackController.trackError}
          onClose={closePanel}
          onBack={backToMenu}
        />
      {:else if activePanel === 'waypoints'}
        <WaypointsPanel
          waypoints={waypointsStore.waypoints}
          error={waypointsController.waypointError}
          onLocate={(waypoint) => flyToPosition(waypoint.position)}
          onGoTo={(waypoint) => void routeController.onGoToHere(waypoint.position)}
          onEdit={waypointsController.onOpenEditWaypoint}
          onDelete={waypointsController.onDeleteWaypoint}
          onClose={closePanel}
          onBack={backToMenu}
        />
      {:else if activePanel === 'tides'}
        <TidesPanel
          store={tidesStore}
          {units}
          stationsShown={layerSettings.tides?.visible ?? false}
          onToggleStations={(shown) => setLayerVisible('tides', shown)}
          onClose={closePanel}
          onBack={backToMenu}
        />
      {:else if activePanel === 'trends'}
        <TrendsPanel
          {origin}
          token={chartsToken}
          providers={historyProviders}
          recorder={trendRecorder}
          mode={units.mode}
          theme={theme.theme}
          onClose={closePanel}
          onBack={backToMenu}
        />
      {:else if activePanel === 'ais'}
        <AisListPanel
          {units}
          {aisTargets}
          {vessel}
          {collision}
          onLocate={flyToPosition}
          onClose={closePanel}
          onBack={backToMenu}
        />
      {:else if activePanel === 'poi-search'}
        <PoiSearchPanel
          pois={poiInView}
          {vessel}
          {units}
          onSelect={selectPoi}
          onHover={(poi) => (hoveredPoi = poi)}
          onClose={closePoiSearch}
          onBack={backToMenu}
        />
      {:else if activePanel === 'anchor'}
        <AnchorPanel
          {units}
          {anchor}
          {vessel}
          error={anchorController.anchorError}
          onDrop={() => void anchorController.onDrop()}
          onRaise={() => void anchorController.onRaise()}
          onSetRadius={(meters) => void anchorController.onSetRadius(meters)}
          onClose={closePanel}
          onBack={backToMenu}
        />
      {:else if activePanel === 'alarms'}
        <AlarmsPanel
          {thresholds}
          collisionMuted={collisionMute.active}
          {collisionMuteRemainingMin}
          onToggleCollisionMute={toggleCollisionMute}
          arrivalMuted={arrivalMuted.value}
          onToggleArrivalMute={() => arrivalMuted.set(!arrivalMuted.value)}
          notifications={notificationsStore}
          error={alarmActionError}
          onSilence={notificationsApi ? onSilenceNotification : undefined}
          onAcknowledge={notificationsApi ? onAcknowledgeNotification : undefined}
          onClose={closePanel}
          onBack={backToMenu}
        />
      {:else if activePanel === 'profiles'}
      <!-- Profiles panel stays in App.svelte as it's settings/config, not chart view -->
      {:else if activePanel === 'regions' && companionBase !== null && mapInstance}
        <RegionsPanel
          {auth}
          map={mapInstance}
          {units}
          {companionBase}
          onClose={closePanel}
          onBack={backToMenu}
        />
      {:else if activePanel === 'charts-management' && companionBase !== null}
        <ChartsManagementPanel {auth} {companionBase} onClose={closePanel} onBack={backToMenu} />
      {/if}
    </div>
  {/if}
  {#if radarControlsOpen}
    <div class="panel-slot">
      <SlideOver
        title="Radar controls"
        closeLabel="Close radar controls"
        bodyFlex
        onClose={() => (radarControlsOpen = false)}
        onBack={radarOpenedFrom === 'menu'
          ? () => {
              radarControlsOpen = false;
              backToMenu();
            }
          : undefined}
      >
        <RadarControls
          store={marineRadar.store}
          onSetControl={(id, value) => void marineRadar.setControl(id, { value })}
          onSetAuto={(id, auto) => void marineRadar.setControl(id, { auto })}
          onSelectRadar={(id) => marineRadar.selectRadar(id)}
          onSetPower={onSetRadarPower}
          echoShown={radarEchoShown}
          onToggleEcho={(shown) => setLayerVisible('marine-radar', shown)}
        />
      </SlideOver>
    </div>
  {/if}
  {#if weatherPanelOpen}
    <WeatherMap
      store={weather}
      {units}
      loader={weatherLoader}
      theme={theme.theme}
      initialView={currentView}
      savedLayers={weatherLayerSettings}
      onLayersChange={onWeatherLayersChange}
      onLayersReady={onWeatherLayersReady}
      token={chartsToken}
      providerName={weatherProviderName}
      position={vessel.position}
      pointLoader={pointConditionsLoader}
      online={net.online}
      onClose={() => (weatherPanelOpen = false)}
      onBack={() => {
        weatherPanelOpen = false;
        menuOpen = true;
      }}
    />
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
.arrival-banner {
  position: absolute;
  inset-block-start: var(--space-3);
  inset-inline: 0;
  margin-inline: auto;
  inline-size: fit-content;
  max-inline-size: calc(100% - var(--space-6));
  padding: var(--space-2) var(--space-4);
  background: var(--accent-tint);
  border: 1px solid var(--accent);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-overlay);
  color: var(--text);
  font-weight: 600;
  z-index: var(--z-safety-strips);
}
.bottom-stack {
  position: absolute;
  inset-block-end: var(--space-3);
  inset-inline: var(--space-3);
  display: flex;
  flex-direction: column-reverse;
  align-items: center;
  gap: var(--space-2);
  pointer-events: none;
  z-index: var(--z-safety-strips);
}
.bottom-stack :global(.bottom-strip) {
  pointer-events: auto;
}
.bottom-stack.above-weather {
  inset-block-end: calc(var(--control-size) + 2 * var(--space-2) + var(--weather-panel-height));
}
.note-panel-slot {
  position: absolute;
  inset-block: 0;
  inset-inline-end: 0;
  z-index: var(--z-panel);
}
.panel-slot {
  position: absolute;
  inset-block: 0;
  inset-inline-start: 0;
  z-index: var(--z-panel);
}
@media (max-width: 600px) {
  .note-panel-slot,
  .panel-slot {
    inset-block-start: auto;
    inset-inline: 0;
    inline-size: auto;
  }
}
</style>
