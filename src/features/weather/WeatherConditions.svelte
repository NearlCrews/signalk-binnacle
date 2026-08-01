<script lang="ts">
import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
import { onDestroy } from 'svelte';
import type { UnitsStore } from '$entities/units';
import type { WeatherStore } from '$entities/weather';
import { quantizeLatLonKey } from '$shared/geo';
import { Clock, formatDayClock, MINUTE_MS } from '$shared/lib';
import ConditionsBlock from './ConditionsBlock.svelte';
import ForecastList from './ForecastList.svelte';
import { GRID_SOURCE_LABEL } from './fills';
import { mergeConditions, pickForecast, tendencyText as tendencyTextFor } from './forecast-series';

import {
  createPointConditionsLoader,
  type PointConditionsLoader,
  pointConditionsKey,
  WARNING_REFRESH_MS,
  type WarningAvailability,
} from './point-conditions';
import {
  conditionsFromSignalK,
  normalizeSignalKForecasts,
  normalizeWeatherWarnings,
  OBSERVATION_STALE_MS,
  type PointConditions,
  pickProviderEntry,
  providerDisplayName,
  type SignalKWeatherData,
  type WeatherWarning,
  weatherWarningIdentity,
} from './signalk-weather';
import { activeWarnings } from './warning-severity';
import { conditionsFromReadout, readoutAtBracket } from './weather-readout';

interface Props {
  origin: string;
  token?: string;
  // The stable API/cache key and the human-readable source label are separate.
  providerId?: string;
  providerName?: string;
  position?: { latitude: number; longitude: number };
  positionUnavailableReason?: string;
  store: WeatherStore;
  units: UnitsStore;
  // The point-conditions loader, constructed once by the host so reopening the panel reuses one
  // persisted-cache connection instead of opening a fresh one per mount. Falls back to a local
  // instance when a host does not supply it (tests, standalone use).
  pointLoader?: PointConditionsLoader;
}

const {
  origin,
  token,
  providerId,
  providerName,
  position,
  positionUnavailableReason,
  store,
  units,
  pointLoader: pointLoaderProp,
}: Props = $props();

// A coarse minute tick so the "is the target near now" check and the now-fallback target both stay
// live when no grid is loaded. A bare Date.now() inside the deriveds below would freeze at mount,
// since nothing else changes to re-run them, and observations would misclassify as forecasts.
const clock = new Clock(MINUTE_MS);
onDestroy(() => clock.dispose());

// Fetches the provider's point answers and persists them, so a panel opened with a failed or
// absent network replays the last conditions for the spot (within the hour) instead of going blank.
// Derived from the prop so a host-supplied loader is used live; the local fallback (tests, standalone
// use) is built lazily and memoized, so even if the derived recomputes it cannot open a second
// IndexedDB connection.
let ownLoader: PointConditionsLoader | undefined;
function fallbackLoader(): PointConditionsLoader {
  ownLoader ??= createPointConditionsLoader();
  return ownLoader;
}
const pointLoader = $derived(pointLoaderProp ?? fallbackLoader());

let loading = $state(false);
let loadError = $state<string | undefined>();
// The provider's raw answers, kept as data so the conditions DERIVE from them and the selected
// time: scrubbing the slider re-picks the step without refetching. A transient provider failure
// replays the spot's persisted answers while they are within the hour, and past that leaves these
// undefined so the panel falls through to the time-reactive free grid instead of freezing a
// one-shot sample on screen.
let obsData = $state<SignalKWeatherData | undefined>();
let seriesData = $state<SignalKWeatherData[] | undefined>();
let warnings = $state<WeatherWarning[]>([]);
let warningAvailability = $state<WarningAvailability>('unavailable');
let warningsFetchedAt = $state<number | undefined>();
let activeRequestKey = $state('');
let observationStatus = $state<'success' | 'empty' | 'failure' | 'unsupported'>('empty');
let forecastStatus = $state<'success' | 'empty' | 'failure' | 'unsupported'>('empty');
// A sequence guard so a slow earlier load cannot overwrite a newer one.
let seq = 0;
let warningSeq = 0;
let loadKey = '';
let warningsAttemptedAt = 0;

// providerName alone remains accepted while the host migrates from its former id-in-name contract.
const effectiveProviderId = $derived(providerId ?? providerName);
const providerLabel = $derived(
  providerId
    ? (providerName ?? providerDisplayName(providerId))
    : providerName
      ? providerDisplayName(providerName)
      : undefined,
);

// A position rounded to about 110 m, kept as a string so the $derived halts propagation when the
// rounded value is unchanged: the fix jitters every GPS delta, and a fresh tuple each tick would
// refetch (and burst provider 400s), but an equal string does not. parsedPos parses it back, so it
// too only changes when the rounded position does; weather does not change within 110 m.
const posKey = $derived(position ? quantizeLatLonKey(position) : '');

const parsedPos = $derived<[number, number] | undefined>(
  posKey ? (posKey.split(',').map(Number) as [number, number]) : undefined,
);

// Provider data: fetch only when the rounded position or the provider changes, not on every scrub
// or GPS jitter; the deriveds below re-pick the step for the selected time without a request.
$effect(() => {
  const pos = parsedPos;
  const provider = effectiveProviderId;
  // Without a position or a provider there is no provider data to show: clear any stale answers
  // (a provider that disappears at runtime must not keep its warnings on screen).
  if (!pos || !provider) {
    clear();
    return;
  }
  const [lat, lon] = pos;
  const requestKey = pointConditionsKey(provider, lat, lon);
  if (requestKey === loadKey) return;
  loadKey = requestKey;
  clearForRequest(requestKey);
  void loadProvider(provider, lat, lon);
});

function clearForRequest(requestKey: string): void {
  seq += 1;
  warningSeq += 1;
  activeRequestKey = requestKey;
  obsData = undefined;
  seriesData = undefined;
  warnings = [];
  warningAvailability = 'unavailable';
  warningsFetchedAt = undefined;
  observationStatus = 'empty';
  forecastStatus = 'empty';
  warningsAttemptedAt = 0;
  loadError = undefined;
}

function clear(): void {
  seq += 1; // an in-flight provider load must not repopulate what was just cleared
  obsData = undefined;
  seriesData = undefined;
  warnings = [];
  warningAvailability = 'unavailable';
  warningsFetchedAt = undefined;
  activeRequestKey = '';
  loadKey = '';
  observationStatus = 'empty';
  forecastStatus = 'empty';
  warningSeq += 1;
  loading = false;
  loadError = undefined;
}

async function loadProvider(provider: string, lat: number, lon: number): Promise<void> {
  const mine = ++seq;
  loading = true;
  loadError = undefined;
  try {
    const point = await pointLoader.load(origin, provider, lat, lon, token);
    if (mine !== seq || point.requestKey !== activeRequestKey) return;
    obsData = point.obs;
    seriesData = point.series ? normalizeSignalKForecasts(point.series) : undefined;
    observationStatus = point.observationStatus;
    forecastStatus = point.forecastStatus;
    warnings = normalizeWeatherWarnings(point.warnings ?? []);
    warningAvailability = point.warningAvailability;
    warningsFetchedAt = point.warningsFetchedAt;
  } catch {
    if (mine !== seq) return;
    observationStatus = 'failure';
    forecastStatus = 'failure';
    warningAvailability = 'unavailable';
    loadError = 'Weather conditions could not be loaded.';
  } finally {
    if (mine === seq) loading = false;
  }
}

function retryProvider(): void {
  const pos = parsedPos;
  const provider = effectiveProviderId;
  if (!pos || !provider) return;
  const [lat, lon] = pos;
  const requestKey = pointConditionsKey(provider, lat, lon);
  clearForRequest(requestKey);
  void loadProvider(provider, lat, lon);
}

// Warnings change independently of forecast series. Refresh them on a bounded cadence without
// refetching conditions, and reject any answer for a position/provider key that is no longer active.
$effect(() => {
  const now = clock.now;
  const pos = parsedPos;
  const provider = effectiveProviderId;
  if (!pos || !provider || !activeRequestKey || warningsFetchedAt === undefined) return;
  if (now - Math.max(warningsFetchedAt, warningsAttemptedAt) < WARNING_REFRESH_MS) return;
  const [lat, lon] = pos;
  warningsAttemptedAt = now;
  void refreshWarnings(provider, lat, lon, activeRequestKey);
});

async function refreshWarnings(
  provider: string,
  lat: number,
  lon: number,
  requestKey: string,
): Promise<void> {
  const mine = ++warningSeq;
  try {
    const point = await pointLoader.loadWarnings(origin, provider, lat, lon, token);
    if (mine !== warningSeq || requestKey !== activeRequestKey || point.requestKey !== requestKey)
      return;
    warnings = normalizeWeatherWarnings(point.warnings ?? []);
    warningAvailability = point.warningAvailability;
    warningsFetchedAt = point.warningsFetchedAt;
  } catch {
    if (mine !== warningSeq || requestKey !== activeRequestKey) return;
    warningAvailability = warnings.length > 0 ? 'stale' : 'unavailable';
  }
}

// The time the conditions answer for: the scrubbed forecast time once a grid exists, otherwise now.
const targetMs = $derived(store.grid ? store.selectedTime : clock.now);

// The provider's answer for the target time: the latest observation when the target is near now,
// else the bounded nearest forecast step (never an entry days from the target).
const providerCurrent = $derived.by<{ cond: PointConditions; observed: boolean } | undefined>(
  () => {
    if (!effectiveProviderId) return undefined;
    const picked = pickProviderEntry(obsData, seriesData, targetMs, clock.now);
    return picked
      ? { cond: conditionsFromSignalK(picked.entry), observed: picked.observed }
      : undefined;
  },
);

// The free-grid sample at the vessel, blended across the time bracket like the drawn fields.
const freeCurrent = $derived.by<PointConditions | undefined>(() => {
  if (!parsedPos || !store.grid) return undefined;
  const [lat, lon] = parsedPos;
  const r = readoutAtBracket(store.grid, lon, lat, store.bracket);
  return r ? conditionsFromReadout(r, store.selectedTime) : undefined;
});

const current = $derived(mergeConditions(freeCurrent, providerCurrent?.cond));
const currentObserved = $derived(providerCurrent?.observed ?? false);
const observationAgeMs = $derived(
  currentObserved && current ? Math.max(0, clock.now - current.timeMs) : undefined,
);
const currentStale = $derived(
  !!providerCurrent &&
    (providerCurrent.observed
      ? observationStatus === 'failure' || (observationAgeMs ?? 0) >= OBSERVATION_STALE_MS
      : forecastStatus === 'failure'),
);
const currentCached = $derived(
  !!providerCurrent &&
    (providerCurrent.observed ? observationStatus === 'failure' : forecastStatus === 'failure'),
);
const sourceLabel = $derived.by(() => {
  if (current?.provenance === 'mixed') return `${providerLabel} + ${GRID_SOURCE_LABEL}`;
  if (current?.provenance === 'provider') return providerLabel ?? GRID_SOURCE_LABEL;
  return GRID_SOURCE_LABEL;
});

// The barometric tendency, the datum a sailor actually decides by. The provider's qualitative
// string wins when present; otherwise the trailing 3-hour delta computed from the free grid.
const tendencyText = $derived(
  providerCurrent?.cond.pressureTendency ||
    tendencyTextFor(store.grid, parsedPos, targetMs, units.mode),
);

// Parsed once per fetch, so scrubbing (700 ms ticks during playback) filters a stable array
// instead of re-parsing twelve dates per step.
const parsedSeries = $derived(seriesData?.map(conditionsFromSignalK));

// The forecast rows and the window they span; the provider series wins when it carries usable rows,
// otherwise the free grid answers.
const forecastPick = $derived(
  pickForecast(
    store.grid,
    parsedSeries,
    parsedPos,
    store.selectedTime,
    targetMs,
    !!effectiveProviderId,
  ),
);
const forecast = $derived(forecastPick.rows);
const forecastHorizonH = $derived(forecastPick.horizonH);

const sortedWarnings = $derived(activeWarnings(warnings, clock.now));
const warningsAgeMinutes = $derived(
  warningsFetchedAt === undefined
    ? undefined
    : Math.max(0, Math.floor((clock.now - warningsFetchedAt) / MINUTE_MS)),
);

const untilLabel = (endTime: string): string => formatDayClock(Date.parse(endTime));
</script>

<section class="conditions popover-card" aria-label="Conditions at the vessel">
  <header class="cond-head">
    <span class="caps-label">Here</span>
    <span class="cond-source">{sourceLabel}</span>
  </header>

  {#if !position}
    <p class="muted-note" role="status">
      {positionUnavailableReason ?? 'Waiting for a vessel position.'}
    </p>
  {:else}
    {#if loadError}
      <p class="alert-note" role="alert">{loadError}</p>
      <button type="button" class="btn btn-ghost" onclick={retryProvider}>Retry</button>
    {/if}
    {#if sortedWarnings.length > 0}
      <ul class="warnings bare-list" role="alert">
        {#each sortedWarnings as w, index (`${weatherWarningIdentity(w)}:${index}`)}
          {@const until = untilLabel(w.endTime)}
          <li class="alert-note alert-note--filled warning">
            <TriangleAlert size={14} aria-hidden="true" />
            <span>
              <b>{w.type}</b>
              {w.details}
              <span class="warning-meta"> {w.source}{until ? ` · until ${until}` : ''} </span>
            </span>
          </li>
        {/each}
      </ul>
      {#if warningAvailability === 'stale'}
        <p class="muted-note">
          Warnings cached{warningsAgeMinutes !== undefined ? ` ${warningsAgeMinutes} min ago` : ''};
          refresh failed.
        </p>
      {/if}
    {:else if !effectiveProviderId}
      <!-- Silence must be labeled: an empty list would read as "no warnings active" when the free
           sources simply carry none. -->
      <p class="muted-note" role="status">Warnings unavailable without a weather provider.</p>
    {:else if warningAvailability === 'unavailable'}
      <p class="muted-note">Warnings unavailable from this provider.</p>
    {:else if warningAvailability === 'stale'}
      <p class="muted-note">Cached warnings may be stale; refresh failed.</p>
    {:else}
      <p class="muted-note">
        No active warnings{warningsAgeMinutes !== undefined
          ? ` · checked ${warningsAgeMinutes} min ago`
          : ''}.
      </p>
    {/if}

    {#if current}
      <ConditionsBlock
        {current}
        observed={currentObserved}
        stale={currentStale}
        cached={currentCached}
        {observationAgeMs}
        {tendencyText}
        {units}
      />
    {:else if loading}
      <p class="muted-note" role="status">Loading conditions.</p>
    {:else if !effectiveProviderId && !store.grid}
      <p class="muted-note" role="status">Turn on a weather layer to load conditions.</p>
    {:else}
      <p class="muted-note" role="status">No conditions for this point.</p>
    {/if}

    {#if forecast.length > 0}
      <ForecastList {forecast} horizonH={forecastHorizonH} {units} />
    {/if}
  {/if}
</section>

<style>
/* The floating frame is the shared .popover-card; only the column layout, sizing, scroll, padding,
   and text color stay scoped here. */
.conditions {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  inline-size: 15rem;
  max-block-size: 100%;
  overflow-y: auto;
  padding: var(--space-2) 0.6rem;
  color: var(--text);
}
.cond-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-2);
}
.cond-source {
  font-size: var(--text-xs);
  color: var(--text-muted);
}
.warnings {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}
/* The warning banner reuses .alert-note .alert-note--filled for the alarm border, radius, alarm-tint
   fill, text color, and the small-panel body size (text-sm, never the smallest tier, since a gale
   advisory must stay readable on a pitching deck); only the icon-and-text row layout and its tighter
   padding are scoped here. */
.warning {
  display: flex;
  align-items: start;
  gap: 0.35rem;
  padding: 0.35rem 0.45rem;
}
.warning :global(svg) {
  color: var(--alarm);
  flex: 0 0 auto;
  margin-block-start: 0.1rem;
}
/* Let a long unbroken provider string wrap rather than overflow the fixed-width conditions panel. */
.warning span {
  min-inline-size: 0;
  overflow-wrap: anywhere;
}
.warning-meta {
  display: block;
  font-size: var(--text-xs);
  color: var(--text-muted);
}
/* On a phone the conditions span the weather panel's width as a bottom sheet rather than a fixed
   15rem card that would cover most of the small map. */
@media (max-width: 600px) {
  .conditions {
    inline-size: 100%;
    max-block-size: 45vh;
  }
}
</style>
