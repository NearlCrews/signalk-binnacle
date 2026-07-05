<script lang="ts">
import { ChevronDown, ChevronUp, Layers, X } from '@lucide/svelte';
import { onDestroy, onMount } from 'svelte';
import { fly } from 'svelte/transition';
import type { UnitsStore } from '$entities/units';
import { type Bbox, boundsToBbox, type WeatherStore } from '$entities/weather';
import { LayersView } from '$features/layers-panel';
import {
  createCloudOverlay,
  createPointReadout,
  createPrecipOverlay,
  createPressureOverlay,
  createRadarOverlay,
  createWavesOverlay,
  createWindOverlay,
  GRID_SOURCE_LABEL,
  type PointConditionsLoader,
  precipUnitLabel,
  RAIN_VISIBLE_MM_H,
  radarScrubbedAway,
  type TimeRange,
  WEATHER_FILL_ID_SET,
  WEATHER_FILL_IDS,
  WEATHER_LAYER_IDS,
  WeatherConditions,
  type WeatherLegend,
  type WeatherLoader,
  weatherLegend,
} from '$features/weather';
import {
  Clock,
  formatBearingOr,
  formatClockTime,
  formatDayClock,
  formatFixed,
  formatKnotsOr,
  formatLengthOr,
  formatPrecipRateOr,
  formatPressureOr,
  HOUR_MS,
  lengthUnit,
  MINUTE_MS,
  prefersReducedMotion,
  pressureUnit,
} from '$shared/lib';
import { createThemedMap, type LayerSettings, type ThemedMapHandle } from '$shared/map';
import type { MapView } from '$shared/settings';
import { serverOrigin } from '$shared/signalk';
import { dialog, PANEL_TRANSITION_MS, PanelHeader, type Theme } from '$shared/ui';
import { createForecastPlayback } from './playback.svelte';
import WeatherLayerMenu from './WeatherLayerMenu.svelte';
import WeatherLegendBar from './WeatherLegendBar.svelte';
import WeatherScrubber from './WeatherScrubber.svelte';

interface Props {
  store: WeatherStore;
  // The shared, cached weather loader (Open-Meteo plus RainViewer), constructed in App.
  loader: WeatherLoader;
  theme: Theme;
  // The imperial-versus-metric display preference; wind stays in knots regardless.
  units: UnitsStore;
  // Where the nav chart is looking; the panel always opens there rather than keeping its own view.
  initialView?: MapView;
  // The panel's own weather-layer visibility, separate from the nav chart's layers.
  savedLayers?: LayerSettings;
  onLayersChange?: (settings: LayerSettings) => void;
  // Hands up a function that applies a full weather-layer snapshot to the mini-map at runtime, so a
  // profile switch updates the weather layers without remounting the panel.
  onLayersReady?: (apply: (settings: LayerSettings) => void) => void;
  // The Signal K auth token and the default weather provider's display name, when one is configured.
  // With a provider, the tap readout prefers it and falls back to the free grid; without one, the
  // grid answers. The area overlays and radar always use the free sources.
  token?: string;
  providerName?: string;
  // The vessel position, for the "Here" conditions panel.
  position?: { latitude: number; longitude: number };
  // The shared point-conditions loader, constructed in App so the panel reuses one cache connection.
  pointLoader?: PointConditionsLoader;
  // Connectivity, so cached radar is labeled rather than passing as live.
  online?: boolean;
  // When supplied, a leading back button returns to the menu, matching the slide-over convention.
  onBack?: () => void;
  onClose: () => void;
}

const {
  store,
  loader,
  theme,
  units,
  initialView,
  savedLayers,
  onLayersChange,
  onLayersReady,
  token,
  providerName,
  position,
  pointLoader,
  online = true,
  onBack,
  onClose,
}: Props = $props();

// RainViewer radar tops out at zoom 7, and the Open-Meteo grid is coarse, so capping the mini-map
// zoom keeps every weather source within its real resolution: no "zoom not supported" tiles, no
// pretending a 0.25-degree field has street-level detail.
const MAX_ZOOM = 7;
const MIN_ZOOM = 1;
const DEFAULT_ZOOM = 3;
const STEP_MS = 3 * HOUR_MS;
// Debounce the forecast refetch so a pan settles into one request, not one per moveend tick.
const FETCH_DEBOUNCE_MS = 400;
// How long the zoom-cap note stays up after a pinch into the resolution cap.
const ZOOM_NOTE_DURATION_MS = 5000;

// A bare Date.now() inside a $derived freezes for as long as its other dependencies hold still,
// so during a long open the stale-age note, the Past/Forecast label, and the now tick would stop
// tracking the wall clock. This coarse minute tick keeps them honest.
const clock = new Clock(MINUTE_MS);

let container: HTMLDivElement;
let mapHandle: ThemedMapHandle | undefined;
// serverOrigin reads location, fixed for the page lifetime: capture once, not per tap and per render.
const origin = serverOrigin();
// Set in onDestroy so a provider readout that resolves after teardown does not write component state.
let destroyed = false;
// Explicit teardown for the canvas keydown listener: map.remove() drops the canvas with it, but
// an AbortController removes any ambiguity about the listener outliving the component.
const mapKeyListeners = new AbortController();
let getBounds: (() => Bbox) | undefined;
let recolor: ((next: Theme) => void) | undefined;
let layersView = $state<LayersView | undefined>();

let conditionsOpen = $state(false);
let layerMenuOpen = $state(false);
// A stable identity so the menu's dismiss-stack effect registers once, not on every parent render.
const closeLayerMenu = (): void => {
  layerMenuOpen = false;
};
// A one-shot transient note when the user pinches into the zoom cap, so the wall reads as a data
// limit rather than a broken map.
let zoomNote = $state('');
let zoomNoteShown = false;
let zoomNoteTimer: ReturnType<typeof setTimeout> | undefined;

let fetchTimer: ReturnType<typeof setTimeout> | undefined;

// The point-tap readout cluster: owns the tapped-point conditions, the provider upgrade, and the
// dismiss timer. The grid sample only shows when at least one layer is on.
const pointReadout = createPointReadout({
  store: () => store,
  origin,
  token: () => token,
  providerName: () => providerName,
  activeCount: () => activeCount,
  isDestroyed: () => destroyed,
});
const readout = $derived(pointReadout.readout);
const readoutSource = $derived(pointReadout.readoutSource);
const readoutPending = $derived(pointReadout.readoutPending);

const items = $derived(layersView?.items ?? []);
const visibleItems = $derived(items.filter((i) => i.visible));
const fills = $derived(items.filter((i) => WEATHER_FILL_ID_SET.has(i.id)));
const overlayItems = $derived(items.filter((i) => !WEATHER_FILL_ID_SET.has(i.id)));
const activeCount = $derived(visibleItems.length);
// The source and fetch-age line, surfaced in the layer menu as well as the footer so it is not
// hidden behind a click; undefined before any grid loads.
const menuProvenance = $derived(
  store.grid?.fetchedAt
    ? `${GRID_SOURCE_LABEL} · fetched ${formatClockTime(store.grid.fetchedAt)}`
    : undefined,
);
const layerOn = (id: string): boolean => items.some((i) => i.id === id && i.visible);
const wavesActive = $derived(layerOn(WEATHER_LAYER_IDS.waves));
const radarActive = $derived(layerOn(WEATHER_LAYER_IDS.radar));

// Surface the loader's status so opening the panel offline or during a rate-limit is honest rather
// than a blank or stale map with no explanation. A refetch over an existing grid stays quiet (the old
// forecast is still shown); only a first-load wait, a hard failure, or a stale fallback show a note.
// A grid missing its requested wave fields is qualified rather than passed off as complete.
const wavesMissing = $derived(wavesActive && !!store.grid?.partialWaves);
const statusNote = $derived.by<string>(() => {
  const wavesNote = wavesMissing ? ' (waves unavailable)' : '';
  switch (store.status) {
    case 'loading':
      return store.grid ? '' : 'Loading forecast';
    case 'error':
      return 'Weather unavailable: offline or rate limited';
    case 'stale': {
      const fetched = store.grid?.fetchedAt;
      const age = fetched === undefined ? undefined : Math.round((clock.now - fetched) / MINUTE_MS);
      return age === undefined
        ? `Showing last forecast${wavesNote}`
        : `Showing forecast fetched ${age} min ago${wavesNote}`;
    }
    default:
      return wavesNote ? `Showing forecast${wavesNote}` : '';
  }
});

// Radar can only show "now": when the slider is parked away from now the overlay hides itself
// (the same radarScrubbedAway predicate, so legend and layer cannot disagree), and the legend says
// so instead of leaving a silently missing layer.
const scrubbedAway = $derived(radarScrubbedAway(store.selectedTime, clock.now));
// The painted frame's valid time, fed by the radar overlay (a callback, not store state).
let radarFrameTime = $state<number | undefined>();
const radarNote = $derived.by<string>(() => {
  if (scrubbedAway) return 'shows now only, hidden while the slider is off now';
  if (!online) return 'cached radar (offline), not live';
  if (radarFrameTime === undefined) return 'radar with short-term nowcast, regional resolution';
  const dMin = Math.round((radarFrameTime - clock.now) / MINUTE_MS);
  const rel = dMin === 0 ? 'now' : dMin > 0 ? `+${dMin} min (nowcast)` : `${dMin} min`;
  return `frame ${rel} · short-term nowcast`;
});
// Keyed on items, theme, and the unit mode only: the live radar note is substituted at render
// time, so the 600 ms frame beat updates one text node instead of rebuilding every legend gradient.
const legends = $derived<WeatherLegend[]>(
  visibleItems
    .map((i) => weatherLegend(i.id, theme, units.mode))
    .filter((l): l is WeatherLegend => l !== undefined),
);

const range = $derived<TimeRange | undefined>(
  store.grid && store.grid.times.length > 0
    ? {
        start: store.grid.times[0],
        end: store.grid.times[store.grid.times.length - 1],
        stepMs: STEP_MS,
      }
    : undefined,
);
// The label carries the zone (the shared formatDayClock rationale) and whether the slider sits in
// the already-elapsed part of the series.
const timeLabel = $derived(store.grid ? formatDayClock(store.selectedTime, { zone: true }) : '');
const timeKind = $derived(store.selectedTime < clock.now - STEP_MS / 2 ? 'Past' : 'Forecast');
// Where "now" sits on the slider track, for the tick that separates past from forecast.
const nowFrac = $derived.by<number | undefined>(() => {
  if (!range || range.end <= range.start) return undefined;
  const f = (clock.now - range.start) / (range.end - range.start);
  return f >= 0 && f <= 1 ? f : undefined;
});

// The forecast-scrubber playback: owns the play loop and its timer, driving the selected time on
// the store. The range derives from the grid here and is injected as a getter.
const playback = createForecastPlayback(
  () => store,
  () => range,
);

// Fetch a forecast for the mini-map's own viewport, debounced. The loader fetches atmospheric data
// always, marine only when waves is on, and radar only when radar is on, so a wind-only view pulls
// nothing extra, and it caches by view so small pans reuse a recent fetch.
// 200 cells fits one Open-Meteo request (the per-request location cap), so a load is two calls
// (forecast plus marine) rather than six. The grid is coarse anyway, and fewer, smaller requests
// keep well under Open-Meteo's free-tier rate limit.
const FORECAST_OPTS = { maxCells: 200, forecastDays: 5 };
function scheduleFetch(): void {
  if (fetchTimer) clearTimeout(fetchTimer);
  fetchTimer = setTimeout(() => {
    if (!getBounds || activeCount === 0) return;
    void loader.load(store, getBounds(), FORECAST_OPTS, {
      waves: wavesActive,
      radar: radarActive,
    });
  }, FETCH_DEBOUNCE_MS);
}

// In the readout, show a field when it came from the provider (which returns every point field) or
// when its layer is on. The grid carries all fields regardless of which is drawn, so for the free
// source it is gated to what is visualized.
const showField = (id: string): boolean =>
  readoutSource === GRID_SOURCE_LABEL ? layerOn(id) : true;
const showPrecipOrRadar = $derived(
  showField(WEATHER_LAYER_IDS.precip) || showField(WEATHER_LAYER_IDS.radar),
);

// Refetch once when waves or radar is turned on, so the new source appears without a pan. Keyed on
// the rising edge with a plain flag so a failed fetch cannot loop. This creates a $effect, so it MUST
// be called synchronously during component setup (as below), never inside a branch or callback, or
// the effect would be created outside the setup phase and Svelte would error.
function refetchOnEnable(isActive: () => boolean): void {
  let requested = false;
  $effect(() => {
    if (isActive() && !requested) {
      requested = true;
      scheduleFetch();
    } else if (!isActive()) {
      requested = false;
    }
  });
}
refetchOnEnable(() => wavesActive);
refetchOnEnable(() => radarActive);

// Fetch on first open if a layer is on but no grid is loaded yet.
$effect(() => {
  if (activeCount > 0 && !store.grid) scheduleFetch();
});

// Recolor when the theme prop changes; the initial recolor runs inline once the map loads.
$effect(() => {
  recolor?.(theme);
});

onMount(() => {
  mapHandle = createThemedMap({
    container,
    // The panel opens centered on the nav chart's current view, so the forecast is for the area you
    // are looking at; the zoom is capped to MAX_ZOOM by createThemedMap.
    view: initialView,
    defaultZoom: DEFAULT_ZOOM,
    minZoom: MIN_ZOOM,
    maxZoom: MAX_ZOOM,
    managerOptions: {
      saved: savedLayers,
      onChange: onLayersChange,
      // The area fills are mutually exclusive: one at a time so they do not stack into mud. Wind
      // arrows and pressure isobars stay freely combinable on top.
      exclusive: [WEATHER_FILL_IDS],
    },
    onClick: (lngLat) => void pointReadout.onTap(lngLat.lng, lngLat.lat),
    onLoad: async ({ map, manager, recolor: recolorFn, isDestroyed, runTick }) => {
      // Band order, bottom to top: the waves height field sits at the bottom, then the precip,
      // cloud, and radar fills, with wind arrows and pressure isobars drawn over them.
      const overlays = [
        createWavesOverlay(store),
        createPrecipOverlay(store),
        createCloudOverlay(store),
        createRadarOverlay(store, undefined, undefined, (t) => (radarFrameTime = t)),
        createWindOverlay(store),
        createPressureOverlay(store),
      ];
      await manager.registerAll(overlays);
      if (isDestroyed()) return;

      const view = new LayersView(manager);
      view.refresh();
      layersView = view;
      // Do not hand a layer-apply callback up if the panel closed while loading: it would close over
      // a map this component is about to destroy, and a later profile apply would push into it.
      if (isDestroyed()) return;
      // The weather mini-map has no user-reorder UI, so it carries no stacking order: the empty order
      // is intentional, not an oversight. The nav chart, which does reorder, applies layers through
      // MapCommands.applyLayers instead.
      onLayersReady?.((settings) => {
        manager.applySnapshot(settings, []);
        view.refresh();
      });

      recolor = recolorFn;
      recolor(theme);

      getBounds = () => boundsToBbox(map.getBounds());
      map.on('moveend', scheduleFetch);
      // Pinching into the cap reads as a broken map without a word of explanation, once per open.
      map.on('zoomend', () => {
        if (zoomNoteShown || map.getZoom() < MAX_ZOOM - 0.05) return;
        zoomNoteShown = true;
        zoomNote = 'Zoom is capped at the weather data resolution';
        zoomNoteTimer = setTimeout(() => (zoomNote = ''), ZOOM_NOTE_DURATION_MS);
      });
      // The keyboard path to the point readout: Enter on the focused map canvas samples the center
      // (a tap needs a pointer; the canvas is focusable via MapLibre's keyboard support).
      map.getCanvas().addEventListener(
        'keydown',
        (event) => {
          if (event.key !== 'Enter') return;
          const center = map.getCenter();
          void pointReadout.onTap(center.lng, center.lat);
        },
        { signal: mapKeyListeners.signal },
      );
      runTick(overlays);
    },
  });
});

onDestroy(() => {
  destroyed = true;
  clock.dispose();
  if (fetchTimer) clearTimeout(fetchTimer);
  if (zoomNoteTimer) clearTimeout(zoomNoteTimer);
  pointReadout.destroy();
  playback.destroy();
  mapKeyListeners.abort();
  mapHandle?.destroy();
});
</script>

<section
  class="weather-panel surface-elevated"
  id="weather-panel"
  aria-label="Weather"
  tabindex="-1"
  use:dialog={onClose}
  transition:fly={{ y: 20, duration: prefersReducedMotion() ? 0 : PANEL_TRANSITION_MS, opacity: 0.3 }}
>
  <PanelHeader
    title="Weather"
    extraClass="panel-head"
    closeLabel="Close weather"
    {onClose}
    {onBack}
  >
    {#snippet headerExtra()}
      <!-- "Here" is a one-tap header control that opens the conditions panel, distinct from a layer;
           it sits between the title and close through the shared header's interleaved slot. -->
      <button
        type="button"
        class="btn btn-pill btn-compact here-btn"
        class:is-on={conditionsOpen}
        aria-expanded={conditionsOpen}
        aria-controls={conditionsOpen ? 'weather-conditions' : undefined}
        aria-label="Conditions at the boat"
        title="Conditions at the boat: wind, pressure, waves, and any warnings"
        onclick={() => (conditionsOpen = !conditionsOpen)}
      >
        Here
        {#if conditionsOpen}
          <ChevronUp size={14} aria-hidden="true" />
        {:else}
          <ChevronDown size={14} aria-hidden="true" />
        {/if}
      </button>
    {/snippet}
  </PanelHeader>

  <div class="panel-map">
    <div class="map" bind:this={container}></div>
    <!-- The layers menu trigger floats over the upper-left of the map. It lights whenever any layer
         is on (recovering the at-a-glance state the old always-visible pills gave) and shows the
         active count, so a glance answers "is anything on" without opening the menu. -->
    <button
      type="button"
      class="icon-pill layer-trigger"
      class:is-on={layerMenuOpen || activeCount > 0}
      aria-haspopup="true"
      aria-expanded={layerMenuOpen}
      aria-controls={layerMenuOpen ? 'weather-layer-menu' : undefined}
      aria-label={activeCount > 0 ? `Weather layers, ${activeCount} on` : 'Weather layers'}
      title="Weather layers"
      onclick={() => (layerMenuOpen = !layerMenuOpen)}
    >
      <Layers size={20} aria-hidden="true" />
      {#if activeCount > 0}
        <span class="layer-count" aria-hidden="true">{activeCount}</span>
      {/if}
    </button>
    <WeatherLayerMenu
      open={layerMenuOpen}
      {fills}
      overlays={overlayItems}
      provenance={menuProvenance}
      onToggle={(id, next) => layersView?.toggle(id, next)}
      onClose={closeLayerMenu}
    />
    <!-- One column for the floating notes so the readout and a status note stack instead of
         overlapping, on any width. Both containers stay mounted so the live regions announce
         reliably (a region inserted together with its content is skipped by some screen readers). -->
    <div class="map-notes">
      <div
        class="popover-card map-note map-note--readout"
        class:show={!!readout || readoutPending}
        role="status"
        onpointerenter={pointReadout.hold}
        onpointerleave={pointReadout.release}
        onfocusin={pointReadout.hold}
        onfocusout={pointReadout.release}
      >
        {#if readout}
          <span class="readout-line">
            Wind <b>{formatKnotsOr(readout.speedMs, 0)}</b> kn from
            <b>{formatBearingOr(readout.fromRad)}</b>&deg;T
            {#if readout.gustMs !== undefined}
              gust <b>{formatKnotsOr(readout.gustMs, 0)}</b> kn
            {/if}
            {#if showField(WEATHER_LAYER_IDS.pressure) && readout.pressurePa !== undefined}
              &middot; <b>{formatPressureOr(readout.pressurePa, units.mode)}</b>
              {pressureUnit(units.mode)}
            {/if}
            {#if showField(WEATHER_LAYER_IDS.waves) && readout.waveHeightM !== undefined}
              &middot; waves <b>{formatLengthOr(readout.waveHeightM, units.mode)}</b>
              {lengthUnit(units.mode)}
              {#if readout.wavePeriodS !== undefined}
                / <b>{formatFixed(readout.wavePeriodS, 1)}</b> s
              {/if}
              {#if readout.waveFromRad !== undefined}
                from <b>{formatBearingOr(readout.waveFromRad)}</b>&deg;T
              {/if}
            {/if}
            {#if showPrecipOrRadar && readout.precipitationMm !== undefined && readout.precipitationMm >= RAIN_VISIBLE_MM_H}
              &middot; rain <b>{formatPrecipRateOr(readout.precipitationMm, units.mode)}</b>
              {precipUnitLabel(readout.precipIsRate, units.mode)}
            {/if}
          </span>
          {#if readoutSource}
            <span class="readout-source">{readoutSource}</span>
          {/if}
          <button
            type="button"
            class="icon-btn readout-close"
            aria-label="Dismiss readout"
            onclick={pointReadout.dismiss}
          >
            <X size={14} aria-hidden="true" />
          </button>
        {:else if readoutPending}
          <span class="readout-line">Fetching conditions</span>
        {/if}
      </div>
      <div
        class="popover-card map-note map-note--status"
        class:show={!!statusNote || !!zoomNote}
        role="status"
      >
        {statusNote || zoomNote}
      </div>
    </div>
    {#if conditionsOpen}
      <div
        class="conditions-slot"
        id="weather-conditions"
        role="region"
        aria-label="Conditions and forecast"
      >
        <WeatherConditions
          {origin}
          {token}
          {providerName}
          {position}
          {store}
          {units}
          {pointLoader}
        />
      </div>
    {/if}
    {#if activeCount === 0}
      <p class="hint">Open the layers menu, upper left, to load weather for this area.</p>
    {/if}
  </div>

  <footer class="panel-foot">
    {#if range}
      <WeatherScrubber
        {range}
        selectedTime={store.selectedTime}
        playing={playback.playing}
        {timeKind}
        {timeLabel}
        {nowFrac}
        onStep={playback.step}
        onTogglePlay={playback.toggle}
        onSetTime={playback.setTime}
      />
    {/if}
    {#if legends.length > 0}
      <WeatherLegendBar {legends} {radarNote} />
    {/if}
    {#if menuProvenance}
      <!-- Provenance, not licensing: which source produced the fields and how old they are. The
           same line the layer menu shows, from the one derived so they cannot diverge. -->
      <p class="provenance">{menuProvenance}</p>
    {/if}
  </footer>
</section>

<style>
.weather-panel {
  position: fixed;
  /* Sit just above the status strip, whose min-block-size is calc(--control-size + --space-2), using
     the same expression so the panel cannot drift out of sync with the strip it clears. */
  inset-block-end: calc(var(--control-size) + var(--space-2));
  inset-inline: 0;
  margin-inline: auto;
  inline-size: min(94vw, 46rem);
  /* A definite height (not max-block-size) so the flex column resolves: the map fills the space
     between the header and footer. With only max-block-size the panel is shrink-to-fit, the map's
     percentage height collapses, and the MapLibre canvas renders blank. */
  block-size: var(--weather-panel-height);
  display: flex;
  flex-direction: column;
  /* The surface, border, radius, and shadow come from the shared .surface-elevated frame. */
  color: var(--text);
  /* One above the edge-docked panels so the weather panel, which can be opened while a panel is up,
     sits cleanly on top instead of relying on DOM order against an equal z-index. */
  z-index: calc(var(--z-panel) + 1);
  overflow: hidden;
}
/* On the shared PanelHeader frame, a touch denser than the slide-over panels: a shorter block
   padding, and the close button keeps its tighter end inset. Global because the header element is
   rendered by PanelHeader, so a scoped selector would not reach it. The title takes the slack via
   PanelHeader's own .heading, so "Here" and close sit at the trailing edge. */
:global(.panel-head) {
  padding-block: 0.4rem;
  padding-inline-end: var(--space-2);
}
.here-btn {
  gap: var(--space-1);
}
/* The container context for the layer menu's bottom-sheet re-dock: it keys off this width, not the
   viewport, because the weather panel is min(94vw, 46rem) and can be narrow on a wide screen. */
.panel-map {
  position: relative;
  flex: 1 1 auto;
  min-block-size: 0;
  container-type: inline-size;
}
/* The floating layers-menu trigger, upper-left over the map, above the canvas but below the open
   menu's backdrop so a second tap (on the backdrop) closes it. */
.layer-trigger {
  position: absolute;
  inset-block-start: var(--space-2);
  inset-inline-start: var(--space-2);
  z-index: var(--z-overlay);
}
/* A small active-layer count tucked on the pill, so the glance answers "how many" as well as the
   lit "anything on" state. */
.layer-count {
  position: absolute;
  inset-block-start: -0.2rem;
  inset-inline-end: -0.2rem;
  min-inline-size: var(--space-4);
  padding: 0 0.2rem;
  border-radius: var(--radius-pill);
  background: var(--accent);
  color: var(--accent-contrast);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
  line-height: var(--space-4);
  text-align: center;
}
/* Absolute fill rather than a percentage height, so the canvas always has real pixels regardless of
   how the flex parent resolves its height. */
.map {
  position: absolute;
  inset: 0;
}
/* The floating notes stack in one top column (readout, then status note) so they can never overlap,
   and stay mounted for reliable live-region announcement; an empty note is invisible and inert. */
/* The notes align to the trailing edge so the readout clears the floating layers trigger at the
   leading edge; the status note re-centers itself (align-self below). */
.map-notes {
  position: absolute;
  inset-block-start: var(--space-2);
  inset-inline: var(--space-2);
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: var(--space-2);
  pointer-events: none;
}
/* The floating-pill frame shared by the point readout and the status note, hidden until it has
   something to say. The status modifier is the small centered note that explains an offline open,
   a rate-limited fetch, a stale fallback, or the zoom cap rather than reading as a blank or
   silently outdated map; the readout modifier carries the tapped-point conditions. */
.map-note {
  /* Leave the leading column clear for the floating trigger so a wide readout never slides under it. */
  max-inline-size: calc(100% - var(--control-size) - var(--space-3));
  padding: 0.3rem 0.6rem;
  font-size: var(--text-sm);
  opacity: 0;
}
.map-note.show {
  opacity: 1;
  pointer-events: auto;
}
.map-note--status {
  align-self: center;
  color: var(--text-muted);
  text-align: center;
}
.map-note--readout {
  position: relative;
  padding-inline-end: var(--space-5);
  color: var(--text);
}
.map-note--readout b {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}
.readout-source {
  display: block;
  margin-block-start: 0.1rem;
  font-size: var(--text-xs);
  color: var(--text-muted);
}
/* Composes the shared .icon-btn (44px target, hover affordance); only the absolute placement in the
   readout corner stays scoped. */
.readout-close {
  position: absolute;
  inset-block-start: 0;
  inset-inline-end: 0;
}
.conditions-slot {
  position: absolute;
  inset-block: var(--space-2);
  inset-inline-end: var(--space-2);
  max-block-size: calc(100% - 2 * var(--space-2));
  display: flex;
}
.hint {
  position: absolute;
  inset-block-end: 0.6rem;
  inset-inline: 0.6rem;
  margin: 0;
  text-align: center;
  font-size: var(--text-sm);
  color: var(--text-muted);
}
.panel-foot {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  padding: 0.45rem 0.6rem;
  border-block-start: 1px solid var(--border);
}
.provenance {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--text-muted);
}
@media (max-width: 600px) {
  /* The "Here" conditions become a full-width bottom sheet instead of a 15rem card covering most of
     the small map, lifted clear of the map attribution line. */
  .conditions-slot {
    inset-block: auto;
    inset-block-end: var(--space-6);
    inset-inline: var(--space-2);
  }
}
</style>
