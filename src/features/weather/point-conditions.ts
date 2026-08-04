import { HOUR_MS, isRecord } from '$shared/lib';
import { createExpiringStore, type ExpiringStore } from '$shared/storage';
import {
  type EndpointOutcome,
  type EndpointStatus,
  fetchObservationsResult,
  fetchPointForecastsResult,
  fetchWeatherWarningsResult,
  isSignalKWeatherData,
  MAX_WEATHER_WARNINGS,
  normalizeSignalKForecasts,
  normalizeWeatherWarnings,
  parseWeatherWarning,
  type SignalKWeatherData,
  type WeatherWarning,
} from './signalk-weather';

interface EndpointState {
  status: EndpointStatus;
  fetchedAt?: number;
  stale: boolean;
}

export type WarningAvailability = 'fresh' | 'stale' | 'unavailable';
export const WARNING_REFRESH_MS = 10 * 60_000;

export interface ProviderPoint {
  requestKey: string;
  fetchedAt: number;
  obs?: SignalKWeatherData;
  series?: SignalKWeatherData[];
  warnings?: WeatherWarning[];
  observationsState: EndpointState;
  forecastsState: EndpointState;
  warningsState: EndpointState;
  observationStatus: EndpointStatus;
  forecastStatus: EndpointStatus;
  warningAvailability: WarningAvailability;
  warningsFetchedAt?: number;
}

type WarningPoint = Pick<
  ProviderPoint,
  'requestKey' | 'warnings' | 'warningAvailability' | 'warningsFetchedAt'
>;

interface LoaderDeps {
  observations: typeof fetchObservationsResult;
  forecasts: typeof fetchPointForecastsResult;
  warnings: typeof fetchWeatherWarningsResult;
  now: () => number;
  persist: ExpiringStore<ProviderPoint>;
}

export interface PointConditionsLoader {
  load(
    origin: string,
    providerId: string,
    lat: number,
    lon: number,
    token?: string,
  ): Promise<ProviderPoint>;
  loadWarnings(
    origin: string,
    providerId: string,
    lat: number,
    lon: number,
    token?: string,
  ): Promise<WarningPoint>;
}

const POINT_TTL_MS = HOUR_MS;
const MAX_POINT_ENTRIES = 8;
const FORECAST_COUNT = 12;
const CACHE_DECIMALS = 3;
const ENDPOINT_STATUSES: ReadonlySet<string> = new Set([
  'success',
  'empty',
  'failure',
  'unsupported',
]);
const WARNING_AVAILABILITIES: ReadonlySet<string> = new Set(['fresh', 'stale', 'unavailable']);

export function pointConditionsKey(providerId: string, lat: number, lon: number): string {
  return `${providerId}:${lat.toFixed(CACHE_DECIMALS)},${lon.toFixed(CACHE_DECIMALS)}`;
}

function isCachedWeatherData(value: unknown): value is SignalKWeatherData {
  return isSignalKWeatherData(value) && Number.isFinite(Date.parse(value.date));
}

function normalizedCachedForecasts(value: unknown): SignalKWeatherData[] | undefined {
  if (!Array.isArray(value) || value.length > FORECAST_COUNT || !value.every(isCachedWeatherData)) {
    return undefined;
  }
  return normalizeSignalKForecasts(value);
}

function normalizedCachedWarnings(value: unknown): WeatherWarning[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_WEATHER_WARNINGS) return undefined;
  const warnings: WeatherWarning[] = [];
  for (const entry of value) {
    const warning = parseWeatherWarning(entry);
    if (!warning) return undefined;
    warnings.push(warning);
  }
  return normalizeWeatherWarnings(warnings);
}

function isEndpointState(value: unknown): value is EndpointState {
  return (
    isRecord(value) &&
    ENDPOINT_STATUSES.has(value.status as string) &&
    typeof value.stale === 'boolean' &&
    (value.fetchedAt === undefined ||
      (typeof value.fetchedAt === 'number' && Number.isFinite(value.fetchedAt)))
  );
}

function normalizedCachedPoint(value: unknown, requestKey: string): ProviderPoint | undefined {
  const series =
    isRecord(value) && value.series !== undefined
      ? normalizedCachedForecasts(value.series)
      : undefined;
  const warnings =
    isRecord(value) && value.warnings !== undefined
      ? normalizedCachedWarnings(value.warnings)
      : undefined;
  if (
    !isRecord(value) ||
    value.requestKey !== requestKey ||
    typeof value.fetchedAt !== 'number' ||
    !Number.isFinite(value.fetchedAt) ||
    !isEndpointState(value.observationsState) ||
    !isEndpointState(value.forecastsState) ||
    !isEndpointState(value.warningsState) ||
    !ENDPOINT_STATUSES.has(value.observationStatus as string) ||
    !ENDPOINT_STATUSES.has(value.forecastStatus as string) ||
    !WARNING_AVAILABILITIES.has(value.warningAvailability as string) ||
    (value.warningsFetchedAt !== undefined &&
      (typeof value.warningsFetchedAt !== 'number' || !Number.isFinite(value.warningsFetchedAt))) ||
    (value.obs !== undefined && !isCachedWeatherData(value.obs)) ||
    (value.series !== undefined && series === undefined) ||
    (value.warnings !== undefined && warnings === undefined)
  ) {
    return undefined;
  }
  const cached = value as unknown as ProviderPoint;
  return {
    ...cached,
    series,
    warnings,
  };
}

const realDeps: LoaderDeps = {
  observations: fetchObservationsResult,
  forecasts: fetchPointForecastsResult,
  warnings: fetchWeatherWarningsResult,
  now: () => Date.now(),
  persist: createExpiringStore<ProviderPoint>('binnacle-weather-point', {
    maxEntries: MAX_POINT_ENTRIES,
  }),
};

function resolveEndpoint<T>(
  outcome: EndpointOutcome<T>,
  cached: T | undefined,
  cachedState: EndpointState | undefined,
  nowMs: number,
  emptyValue?: T,
): { data: T | undefined; state: EndpointState } {
  if (outcome.status === 'success') {
    return { data: outcome.value, state: { status: 'success', fetchedAt: nowMs, stale: false } };
  }
  if (outcome.status === 'empty') {
    return { data: emptyValue, state: { status: 'empty', fetchedAt: nowMs, stale: false } };
  }
  if (outcome.status === 'failure' && cached !== undefined) {
    return {
      data: cached,
      state: { status: 'failure', fetchedAt: cachedState?.fetchedAt, stale: true },
    };
  }
  return {
    data: undefined,
    state: { status: outcome.status, fetchedAt: nowMs, stale: false },
  };
}

function warningsAvailability(
  state: EndpointState,
  warnings: WeatherWarning[] | undefined,
): WarningAvailability {
  // A cached EMPTY list is not stale data being withheld: the last answer was "no warnings here",
  // so a failed refresh over it reports unavailable rather than implying hidden warnings.
  if (state.status === 'failure') return (warnings?.length ?? 0) > 0 ? 'stale' : 'unavailable';
  if (state.status === 'unsupported') return 'unavailable';
  return 'fresh';
}

function warningPoint(
  requestKey: string,
  warnings: { data: WeatherWarning[] | undefined; state: EndpointState },
): WarningPoint {
  return {
    requestKey,
    warnings: warnings.data,
    warningAvailability: warningsAvailability(warnings.state, warnings.data),
    warningsFetchedAt: warnings.state.fetchedAt,
  };
}

export function createPointConditionsLoader(
  overrides: Partial<LoaderDeps> = {},
): PointConditionsLoader {
  const deps = { ...realDeps, ...overrides };
  const pointLoads = new Map<string, Promise<ProviderPoint>>();
  const warningLoads = new Map<string, Promise<WarningPoint>>();

  async function loadPoint(
    origin: string,
    providerId: string,
    lat: number,
    lon: number,
    token?: string,
  ): Promise<ProviderPoint> {
    const nowMs = deps.now();
    const requestKey = pointConditionsKey(providerId, lat, lon);
    const stored = await deps.persist.get(requestKey);
    const cached =
      stored && stored.expires > nowMs
        ? normalizedCachedPoint(stored.value as unknown, requestKey)
        : undefined;
    const [obsOutcome, forecastOutcome, warningsOutcome] = await Promise.all([
      deps.observations(origin, providerId, lat, lon, token),
      deps.forecasts(origin, providerId, lat, lon, FORECAST_COUNT, token),
      deps.warnings(origin, providerId, lat, lon, token),
    ]);
    const observations = resolveEndpoint(obsOutcome, cached?.obs, cached?.observationsState, nowMs);
    const forecasts = resolveEndpoint(
      forecastOutcome,
      cached?.series,
      cached?.forecastsState,
      nowMs,
    );
    const warnings = resolveEndpoint(
      warningsOutcome,
      cached?.warnings,
      cached?.warningsState,
      nowMs,
      [],
    );
    const point: ProviderPoint = {
      requestKey,
      fetchedAt:
        observations.state.stale || forecasts.state.stale ? (cached?.fetchedAt ?? nowMs) : nowMs,
      obs: observations.data,
      series: forecasts.data,
      warnings: warnings.data,
      observationsState: observations.state,
      forecastsState: forecasts.state,
      warningsState: warnings.state,
      observationStatus: observations.state.status,
      forecastStatus: forecasts.state.status,
      warningAvailability: warningsAvailability(warnings.state, warnings.data),
      warningsFetchedAt: warnings.state.fetchedAt,
    };
    const allFailed = [obsOutcome, forecastOutcome, warningsOutcome].every(
      (outcome) => outcome.status === 'failure',
    );
    if (!allFailed) await deps.persist.put(requestKey, point, nowMs + POINT_TTL_MS);
    void deps.persist.prune(nowMs);
    return point;
  }

  async function loadWarningPoint(
    origin: string,
    providerId: string,
    lat: number,
    lon: number,
    token?: string,
  ): Promise<WarningPoint> {
    const nowMs = deps.now();
    const requestKey = pointConditionsKey(providerId, lat, lon);
    const stored = await deps.persist.get(requestKey);
    const cached =
      stored && stored.expires > nowMs
        ? normalizedCachedPoint(stored.value as unknown, requestKey)
        : undefined;
    const outcome = await deps.warnings(origin, providerId, lat, lon, token);
    const warnings = resolveEndpoint(outcome, cached?.warnings, cached?.warningsState, nowMs, []);
    if (cached && outcome.status !== 'failure') {
      const updated: ProviderPoint = {
        ...cached,
        warnings: warnings.data,
        warningsState: warnings.state,
        warningAvailability: warningsAvailability(warnings.state, warnings.data),
        warningsFetchedAt: warnings.state.fetchedAt,
      };
      await deps.persist.put(requestKey, updated, nowMs + POINT_TTL_MS);
    }
    void deps.persist.prune(nowMs);
    return warningPoint(requestKey, warnings);
  }

  return {
    load(origin, providerId, lat, lon, token) {
      const requestKey = pointConditionsKey(providerId, lat, lon);
      const existing = pointLoads.get(requestKey);
      if (existing) return existing;
      const pending = loadPoint(origin, providerId, lat, lon, token).finally(() => {
        if (pointLoads.get(requestKey) === pending) pointLoads.delete(requestKey);
      });
      pointLoads.set(requestKey, pending);
      return pending;
    },

    loadWarnings(origin, providerId, lat, lon, token) {
      const requestKey = pointConditionsKey(providerId, lat, lon);
      const pointPending = pointLoads.get(requestKey);
      if (pointPending) return pointPending.then((point) => warningPointFromProviderPoint(point));
      const existing = warningLoads.get(requestKey);
      if (existing) return existing;
      const pending = loadWarningPoint(origin, providerId, lat, lon, token).finally(() => {
        if (warningLoads.get(requestKey) === pending) warningLoads.delete(requestKey);
      });
      warningLoads.set(requestKey, pending);
      return pending;
    },
  };
}

function warningPointFromProviderPoint(point: ProviderPoint): WarningPoint {
  return {
    requestKey: point.requestKey,
    warnings: point.warnings,
    warningAvailability: point.warningAvailability,
    warningsFetchedAt: point.warningsFetchedAt,
  };
}
