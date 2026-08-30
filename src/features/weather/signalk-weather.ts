import {
  capitalize,
  cleanBoundedText,
  HOUR_MS,
  isFiniteNumber,
  isRecord,
  MINUTE_MS,
  nearestBy,
  readBoundedJson,
  sameJsonValue,
  withTimeout,
} from '$shared/lib';
import { authInit, safeProviderId } from '$shared/signalk';
import type { WeatherReadout } from './weather-readout';

const WEATHER_BASE = '/signalk/v2/api/weather';
const METERS_TO_MM = 1000;
export const MAX_WEATHER_PROVIDERS = 32;
export const MAX_WEATHER_OBSERVATIONS = 256;
export const MAX_WEATHER_FORECASTS = 512;
export const MAX_WEATHER_WARNINGS = 64;
const MAX_PROVIDER_NAME_LENGTH = 256;
const MAX_WEATHER_TEXT_LENGTH = 2_048;
const MAX_WARNING_DETAILS_LENGTH = 4_096;
const WARNING_TYPE_FALLBACK = 'Weather warning';
const WARNING_DETAILS_FALLBACK = 'Details unavailable.';
const WARNING_SOURCE_FALLBACK = 'Weather provider';

export const NEAR_NOW_MS = 90 * MINUTE_MS;
export const OBSERVATION_STALE_MS = HOUR_MS;
export const MAX_OBSERVATION_AGE_MS = 3 * HOUR_MS;

interface WaveWire {
  significantHeight?: number;
  height?: number;
  period?: number;
  direction?: number;
  directionTrue?: number;
}

interface CurrentWire {
  speed?: number;
  drift?: number;
  direction?: number;
  set?: number;
}

export interface SignalKWeatherData {
  date: string;
  description?: string;
  outside?: {
    temperature?: number;
    feelsLikeTemperature?: number;
    minTemperature?: number;
    maxTemperature?: number;
    dewPointTemperature?: number;
    pressure?: number;
    pressureTendency?: string | number;
    relativeHumidity?: number;
    cloudCover?: number;
    precipitationVolume?: number; // m, per the Signal K schema
    precipitationType?: string;
    uvIndex?: number;
    horizontalVisibility?: number;
  };
  wind?: {
    speedTrue?: number;
    directionTrue?: number;
    gust?: number;
    gustDirection?: number;
  };
  water?: {
    temperature?: number;
    // Legacy flat fields.
    waveSignificantHeight?: number;
    wavePeriod?: number;
    waveDirection?: number;
    swellHeight?: number;
    swellPeriod?: number;
    swellDirection?: number;
    surfaceCurrentSpeed?: number;
    surfaceCurrentDirection?: number;
    // Current server-api fields.
    waves?: WaveWire;
    swell?: WaveWire;
    current?: CurrentWire;
  };
  current?: CurrentWire;
  sun?: { sunrise?: string; sunset?: string };
}

export interface WeatherWarning {
  startTime: string;
  endTime: string;
  details: string;
  source: string;
  type: string;
}

interface WeatherProviderInfo {
  name?: string;
  isDefault: boolean;
}

export interface WeatherProvider {
  id: string;
  name: string;
}

export type EndpointOutcome<T> =
  | { status: 'success'; value: T }
  | { status: 'empty' | 'failure' | 'unsupported' };
export type EndpointStatus = EndpointOutcome<never>['status'];

type Fetch = typeof fetch;
const defaultFetch: Fetch = globalThis.fetch.bind(globalThis);

function safePointQuery(providerId: string, lat: number, lon: number): boolean {
  return (
    safeProviderId(providerId) &&
    Number.isFinite(lat) &&
    lat >= -90 &&
    lat <= 90 &&
    Number.isFinite(lon) &&
    lon >= -180 &&
    lon <= 180
  );
}

function hasOnlyFiniteNumbers(
  value: Record<string, unknown> | undefined,
  fields: readonly string[],
): boolean {
  return (
    value === undefined ||
    fields.every((field) => value[field] === undefined || isFiniteNumber(value[field]))
  );
}

const OUTSIDE_NUMBER_FIELDS = [
  'temperature',
  'feelsLikeTemperature',
  'minTemperature',
  'maxTemperature',
  'dewPointTemperature',
  'pressure',
  'relativeHumidity',
  'cloudCover',
  'precipitationVolume',
  'uvIndex',
  'horizontalVisibility',
] as const;
const WIND_NUMBER_FIELDS = ['speedTrue', 'directionTrue', 'gust', 'gustDirection'] as const;
const WATER_NUMBER_FIELDS = [
  'temperature',
  'waveSignificantHeight',
  'wavePeriod',
  'waveDirection',
  'swellHeight',
  'swellPeriod',
  'swellDirection',
  'surfaceCurrentSpeed',
  'surfaceCurrentDirection',
] as const;
const WAVE_NUMBER_FIELDS = [
  'significantHeight',
  'height',
  'period',
  'direction',
  'directionTrue',
] as const;
const CURRENT_NUMBER_FIELDS = ['speed', 'drift', 'direction', 'set'] as const;

function validNumericRecord(value: unknown, fields: readonly string[]): boolean {
  return value === undefined || (isRecord(value) && hasOnlyFiniteNumbers(value, fields));
}

export function isSignalKWeatherData(value: unknown): value is SignalKWeatherData {
  if (!isRecord(value)) return false;
  const date = cleanBoundedText(value.date, 64);
  if (!date) return false;
  if (
    value.description !== undefined &&
    cleanBoundedText(value.description, MAX_WEATHER_TEXT_LENGTH) === undefined
  ) {
    return false;
  }
  for (const field of ['outside', 'wind', 'water', 'current', 'sun'] as const) {
    if (value[field] !== undefined && !isRecord(value[field])) return false;
  }
  const outside = isRecord(value.outside) ? value.outside : undefined;
  const wind = isRecord(value.wind) ? value.wind : undefined;
  const water = isRecord(value.water) ? value.water : undefined;
  const current = isRecord(value.current) ? value.current : undefined;
  if (
    !hasOnlyFiniteNumbers(outside, OUTSIDE_NUMBER_FIELDS) ||
    !hasOnlyFiniteNumbers(wind, WIND_NUMBER_FIELDS) ||
    !hasOnlyFiniteNumbers(water, WATER_NUMBER_FIELDS) ||
    !hasOnlyFiniteNumbers(current, CURRENT_NUMBER_FIELDS) ||
    !validNumericRecord(water?.waves, WAVE_NUMBER_FIELDS) ||
    !validNumericRecord(water?.swell, WAVE_NUMBER_FIELDS) ||
    !validNumericRecord(water?.current, CURRENT_NUMBER_FIELDS)
  ) {
    return false;
  }
  if (
    outside?.precipitationType !== undefined &&
    cleanBoundedText(outside.precipitationType, 128) === undefined
  ) {
    return false;
  }
  if (outside?.pressureTendency !== undefined) {
    const tendency = outside.pressureTendency;
    if (
      !(
        (typeof tendency === 'number' && Number.isFinite(tendency)) ||
        cleanBoundedText(tendency, 128) !== undefined
      )
    ) {
      return false;
    }
  }
  const sun = isRecord(value.sun) ? value.sun : undefined;
  for (const field of ['sunrise', 'sunset'] as const) {
    if (sun?.[field] !== undefined && cleanBoundedText(sun[field], 64) === undefined) return false;
  }
  return true;
}

export function parseWeatherWarning(value: unknown): WeatherWarning | undefined {
  if (!isRecord(value)) return undefined;
  const startTime = cleanBoundedText(value.startTime, 64);
  const endTime = cleanBoundedText(value.endTime, 64);
  if (!startTime || !endTime) return undefined;
  const startMs = Date.parse(startTime);
  const endMs = Date.parse(endTime);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return undefined;
  const details =
    cleanBoundedText(value.details, MAX_WARNING_DETAILS_LENGTH) ?? WARNING_DETAILS_FALLBACK;
  const source =
    cleanBoundedText(value.source, MAX_PROVIDER_NAME_LENGTH) ?? WARNING_SOURCE_FALLBACK;
  const type = cleanBoundedText(value.type, MAX_PROVIDER_NAME_LENGTH) ?? WARNING_TYPE_FALLBACK;
  return { startTime, endTime, details, source, type };
}

export function weatherWarningIdentity(warning: WeatherWarning): string {
  return JSON.stringify([
    warning.startTime,
    warning.endTime,
    warning.type,
    warning.source,
    warning.details,
  ]);
}

export function normalizeWeatherWarnings(warnings: WeatherWarning[]): WeatherWarning[] {
  const accepted = new Map<string, WeatherWarning>();
  for (const warning of warnings) {
    const identity = weatherWarningIdentity(warning);
    if (!accepted.has(identity)) accepted.set(identity, warning);
  }
  return [...accepted.values()];
}

export function normalizeSignalKForecasts(forecasts: SignalKWeatherData[]): SignalKWeatherData[] {
  const accepted = new Map<number, SignalKWeatherData>();
  const conflicted = new Set<number>();
  for (const forecast of forecasts) {
    const timeMs = Date.parse(forecast.date);
    if (!Number.isFinite(timeMs) || conflicted.has(timeMs)) continue;
    const previous = accepted.get(timeMs);
    if (!previous) {
      accepted.set(timeMs, forecast);
    } else {
      const { date: _previousDate, ...previousData } = previous;
      const { date: _forecastDate, ...forecastData } = forecast;
      if (sameJsonValue(previousData, forecastData)) continue;
      accepted.delete(timeMs);
      conflicted.add(timeMs);
    }
  }
  return [...accepted.entries()].sort(([left], [right]) => left - right).map(([, value]) => value);
}

export async function fetchWeatherProviders(
  origin: string,
  token?: string,
  fetchFn: Fetch = defaultFetch,
): Promise<Record<string, WeatherProviderInfo> | undefined> {
  const result = await fetchOutcome<unknown>(`${origin}${WEATHER_BASE}/_providers`, token, fetchFn);
  if (result.status !== 'success') return result.status === 'empty' ? {} : undefined;
  const body = result.value;
  if (!isRecord(body)) return undefined;
  const providers: Record<string, WeatherProviderInfo> = {};
  let count = 0;
  for (const id in body) {
    if (!Object.hasOwn(body, id)) continue;
    count += 1;
    if (count > MAX_WEATHER_PROVIDERS || !safeProviderId(id)) return undefined;
    const raw = body[id];
    if (!isRecord(raw) || typeof raw.isDefault !== 'boolean') return undefined;
    const name =
      raw.name === undefined ? undefined : cleanBoundedText(raw.name, MAX_PROVIDER_NAME_LENGTH);
    if (raw.name !== undefined && name === undefined) return undefined;
    providers[id] = { isDefault: raw.isDefault, ...(name ? { name } : {}) };
  }
  return providers;
}

export function defaultProviderName(
  providers: Record<string, WeatherProviderInfo> | undefined,
): string | undefined {
  return defaultProvider(providers)?.name;
}

export function defaultProvider(
  providers: Record<string, WeatherProviderInfo> | undefined,
): WeatherProvider | undefined {
  if (!providers) return undefined;
  const entries = Object.entries(providers).filter(
    (entry): entry is [string, WeatherProviderInfo] => !!entry[1] && typeof entry[1] === 'object',
  );
  if (entries.length === 0) return undefined;
  const [id, info] = entries.find(([, candidate]) => candidate.isDefault) ?? entries[0];
  const name = info.name ?? prettyProviderId(id);
  return { id, name };
}

export function providerDisplayName(id: string): string {
  return prettyProviderId(id);
}

const PROVIDER_PREFIX = /^(?:(?:signalk|sk)-)?weather-/;
const PROVIDER_WORD_SPLIT = /[-_]+/;

function prettyProviderId(id: string): string {
  const words = id.replace(PROVIDER_PREFIX, '').split(PROVIDER_WORD_SPLIT).filter(Boolean);
  return words.length > 0 ? words.map(capitalize).join(' ') : id;
}

function pointUrl(
  origin: string,
  path: string,
  providerId: string,
  lat: number,
  lon: number,
  count?: number,
): string {
  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
    provider: providerId,
  });
  if (count !== undefined) params.set('count', String(count));
  return `${origin}${WEATHER_BASE}/${path}?${params.toString()}`;
}

async function fetchOutcome<T>(
  url: string,
  token: string | undefined,
  fetchFn: Fetch,
): Promise<EndpointOutcome<T>> {
  try {
    const response = await fetchFn(url, withTimeout(authInit(token)));
    if (response.status === 404 || response.status === 405 || response.status === 501) {
      return { status: 'unsupported' };
    }
    if (!response.ok) return { status: 'failure' };
    if (response.status === 204) return { status: 'empty' };
    const body = await readBoundedJson<T>(response);
    return body === null || body === undefined
      ? { status: 'empty' }
      : { status: 'success', value: body };
  } catch {
    return { status: 'failure' };
  }
}

async function fetchWeatherListResult(
  url: string,
  token: string | undefined,
  fetchFn: Fetch,
  maxEntries: number,
): Promise<EndpointOutcome<SignalKWeatherData[]>> {
  const result = await fetchOutcome<unknown>(url, token, fetchFn);
  if (result.status !== 'success') return result;
  const list: unknown[] = Array.isArray(result.value)
    ? result.value
    : result.value && typeof result.value === 'object'
      ? [result.value]
      : [];
  if (list.length > maxEntries) return { status: 'failure' };
  const entries: SignalKWeatherData[] = [];
  for (const entry of list) {
    if (!isSignalKWeatherData(entry)) return { status: 'failure' };
    entries.push(entry);
  }
  return entries.length > 0 ? { status: 'success', value: entries } : { status: 'empty' };
}

function entryMs(entry: SignalKWeatherData | undefined): number {
  return entry ? Date.parse(entry.date) : Number.NaN;
}

export async function fetchObservationsResult(
  origin: string,
  providerId: string,
  lat: number,
  lon: number,
  token?: string,
  fetchFn: Fetch = defaultFetch,
): Promise<EndpointOutcome<SignalKWeatherData>> {
  if (!safePointQuery(providerId, lat, lon)) return { status: 'failure' };
  const result = await fetchWeatherListResult(
    pointUrl(origin, 'observations', providerId, lat, lon),
    token,
    fetchFn,
    MAX_WEATHER_OBSERVATIONS,
  );
  if (result.status !== 'success') return result;
  const latest = nearestBy(result.value, entryMs, Number.MAX_SAFE_INTEGER);
  return latest ? { status: 'success', value: latest } : { status: 'empty' };
}

export async function fetchPointForecastsResult(
  origin: string,
  providerId: string,
  lat: number,
  lon: number,
  count: number,
  token?: string,
  fetchFn: Fetch = defaultFetch,
): Promise<EndpointOutcome<SignalKWeatherData[]>> {
  if (
    !safePointQuery(providerId, lat, lon) ||
    !Number.isSafeInteger(count) ||
    count <= 0 ||
    count > MAX_WEATHER_FORECASTS
  ) {
    return { status: 'failure' };
  }
  const result = await fetchWeatherListResult(
    pointUrl(origin, 'forecasts/point', providerId, lat, lon, count),
    token,
    fetchFn,
    MAX_WEATHER_FORECASTS,
  );
  if (result.status !== 'success') return result;
  const sorted = normalizeSignalKForecasts(result.value).slice(0, count);
  return sorted.length > 0 ? { status: 'success', value: sorted } : { status: 'empty' };
}

export async function fetchWeatherWarningsResult(
  origin: string,
  providerId: string,
  lat: number,
  lon: number,
  token?: string,
  fetchFn: Fetch = defaultFetch,
): Promise<EndpointOutcome<WeatherWarning[]>> {
  if (!safePointQuery(providerId, lat, lon)) return { status: 'failure' };
  const result = await fetchOutcome<unknown>(
    pointUrl(origin, 'warnings', providerId, lat, lon),
    token,
    fetchFn,
  );
  if (result.status !== 'success') return result;
  if (!Array.isArray(result.value)) return { status: 'failure' };
  if (result.value.length > MAX_WEATHER_WARNINGS) return { status: 'failure' };
  const warnings: WeatherWarning[] = [];
  for (const entry of result.value) {
    const warning = parseWeatherWarning(entry);
    if (!warning) return { status: 'failure' };
    warnings.push(warning);
  }
  const normalized = normalizeWeatherWarnings(warnings);
  return normalized.length > 0 ? { status: 'success', value: normalized } : { status: 'empty' };
}

export async function fetchObservations(
  origin: string,
  providerId: string,
  lat: number,
  lon: number,
  token?: string,
  fetchFn: Fetch = defaultFetch,
): Promise<SignalKWeatherData | undefined> {
  const result = await fetchObservationsResult(origin, providerId, lat, lon, token, fetchFn);
  return result.status === 'success' ? result.value : undefined;
}

export async function fetchPointForecasts(
  origin: string,
  providerId: string,
  lat: number,
  lon: number,
  count: number,
  token?: string,
  fetchFn: Fetch = defaultFetch,
): Promise<SignalKWeatherData[] | undefined> {
  const result = await fetchPointForecastsResult(
    origin,
    providerId,
    lat,
    lon,
    count,
    token,
    fetchFn,
  );
  return result.status === 'success' ? result.value : undefined;
}

type ConditionsProvenance = 'provider' | 'Open-Meteo' | 'mixed';

export interface PointConditions {
  timeMs: number;
  provenance?: ConditionsProvenance;
  windMs?: number;
  fromRad?: number;
  gustMs?: number;
  pressurePa?: number;
  pressureTendency?: string;
  airTempK?: number;
  feelsLikeK?: number;
  dewPointK?: number;
  humidityFraction?: number;
  cloudFraction?: number;
  waveHeightM?: number;
  wavePeriodS?: number;
  waveFromRad?: number;
  windWaveHeightM?: number;
  windWavePeriodS?: number;
  windWaveFromRad?: number;
  swellHeightM?: number;
  swellPeriodS?: number;
  swellFromRad?: number;
  currentSpeedMs?: number;
  currentDirectionRad?: number;
  visibilityM?: number;
  // WMO weather interpretation code, carried by the free grid; a Signal K provider never sets it.
  weatherCode?: number;
  waterTempK?: number;
  precipitationMm?: number;
  precipitationType?: string;
  precipIsRate?: boolean;
  uvIndex?: number;
  sunriseMs?: number;
  sunsetMs?: number;
  riskCues?: string[];
}

// Hoisted: these are re-parsed on every weather record otherwise, and a provider sends one per
// forecast step per fetch.
const TENDENCY_RISING = /^(rising|rise|increasing|increase|up)$/;
const TENDENCY_FALLING = /^(falling|fall|decreasing|decrease|down)$/;
const TENDENCY_STEADY = /^(steady|stable|unchanged|level)$/;

export function normalizePressureTendency(value: string | number | undefined): string | undefined {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return undefined;
    if (Math.abs(value) < 0.5) return 'steady';
    return value > 0 ? 'rising' : 'falling';
  }
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;
  if (TENDENCY_RISING.test(normalized)) return 'rising';
  if (TENDENCY_FALLING.test(normalized)) return 'falling';
  if (TENDENCY_STEADY.test(normalized)) return 'steady';
  return undefined;
}

function precipitationMm(d: SignalKWeatherData): number | undefined {
  const meters = d.outside?.precipitationVolume;
  return meters === undefined ? undefined : meters * METERS_TO_MM;
}

function waveFields(d: SignalKWeatherData) {
  const water = d.water;
  return {
    waveHeightM:
      water?.waves?.significantHeight ?? water?.waves?.height ?? water?.waveSignificantHeight,
    wavePeriodS: water?.waves?.period ?? water?.wavePeriod,
    waveFromRad: water?.waves?.directionTrue ?? water?.waves?.direction ?? water?.waveDirection,
    swellHeightM: water?.swell?.height ?? water?.swell?.significantHeight ?? water?.swellHeight,
    swellPeriodS: water?.swell?.period ?? water?.swellPeriod,
    swellFromRad: water?.swell?.directionTrue ?? water?.swell?.direction ?? water?.swellDirection,
    currentSpeedMs:
      d.current?.drift ??
      d.current?.speed ??
      water?.current?.drift ??
      water?.current?.speed ??
      water?.surfaceCurrentSpeed,
    currentDirectionRad:
      d.current?.set ??
      d.current?.direction ??
      water?.current?.set ??
      water?.current?.direction ??
      water?.surfaceCurrentDirection,
  };
}

function parsedTime(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

export function conditionsFromSignalK(d: SignalKWeatherData): PointConditions {
  return {
    timeMs: Date.parse(d.date),
    provenance: 'provider',
    windMs: d.wind?.speedTrue,
    fromRad: d.wind?.directionTrue,
    gustMs: d.wind?.gust,
    pressurePa: d.outside?.pressure,
    pressureTendency: normalizePressureTendency(d.outside?.pressureTendency),
    airTempK: d.outside?.temperature,
    feelsLikeK: d.outside?.feelsLikeTemperature,
    dewPointK: d.outside?.dewPointTemperature,
    humidityFraction: d.outside?.relativeHumidity,
    cloudFraction: d.outside?.cloudCover,
    ...waveFields(d),
    visibilityM: d.outside?.horizontalVisibility,
    waterTempK: d.water?.temperature,
    precipitationMm: precipitationMm(d),
    precipitationType: d.outside?.precipitationType,
    precipIsRate: false,
    uvIndex: d.outside?.uvIndex,
    sunriseMs: parsedTime(d.sun?.sunrise),
    sunsetMs: parsedTime(d.sun?.sunset),
  };
}

// Provider fields are applied over the grid sample independently. A pressure-only provider answer,
// for example, still improves a tap while retaining grid wind.
export function providerReadoutContribution(d: SignalKWeatherData): Partial<WeatherReadout> {
  const waves = waveFields(d);
  return {
    speedMs: d.wind?.speedTrue,
    fromRad: d.wind?.directionTrue,
    gustMs: d.wind?.gust,
    pressurePa: d.outside?.pressure,
    waveHeightM: waves.waveHeightM,
    wavePeriodS: waves.wavePeriodS,
    waveFromRad: waves.waveFromRad,
    swellHeightM: waves.swellHeightM,
    swellPeriodS: waves.swellPeriodS,
    swellFromRad: waves.swellFromRad,
    currentSpeedMs: waves.currentSpeedMs,
    currentDirectionRad: waves.currentDirectionRad,
    waterTempK: d.water?.temperature,
    precipitationMm: precipitationMm(d),
    precipIsRate: d.outside?.precipitationVolume === undefined ? undefined : false,
    cloudCoverFraction: d.outside?.cloudCover,
  };
}

function nearestInTime(
  series: SignalKWeatherData[],
  targetMs: number,
): SignalKWeatherData | undefined {
  return nearestBy(series, entryMs, targetMs);
}

const DEFAULT_SERIES_STEP_MS = 3 * HOUR_MS;

export function nearestInTimeBounded(
  series: SignalKWeatherData[],
  targetMs: number,
): SignalKWeatherData | undefined {
  const sorted = series.slice().sort((a, b) => entryMs(a) - entryMs(b));
  const best = nearestInTime(sorted, targetMs);
  if (!best) return undefined;
  const t0 = entryMs(sorted[0]);
  const t1 = entryMs(sorted[1]);
  const stepMs =
    !Number.isNaN(t0) && !Number.isNaN(t1) && t1 > t0 ? t1 - t0 : DEFAULT_SERIES_STEP_MS;
  return Math.abs(entryMs(best) - targetMs) <= stepMs ? best : undefined;
}

export function pickProviderEntry(
  obs: SignalKWeatherData | undefined,
  series: SignalKWeatherData[] | undefined,
  targetMs: number,
  nowMs: number,
): { entry: SignalKWeatherData; observed: boolean } | undefined {
  const observationMs = obs ? entryMs(obs) : Number.NaN;
  const observationFresh =
    obs &&
    !Number.isNaN(observationMs) &&
    observationMs <= nowMs + MINUTE_MS &&
    nowMs - observationMs <= MAX_OBSERVATION_AGE_MS;
  if (Math.abs(targetMs - nowMs) < NEAR_NOW_MS && observationFresh) {
    return { entry: obs, observed: true };
  }
  const step = series && nearestInTimeBounded(series, targetMs);
  return step ? { entry: step, observed: false } : undefined;
}
