/** The webapp client for the companion regions and config routes. The panel never calls the container
 * directly; it always goes through the admin-gated plugin routes, so the container port stays private.
 * Auth uses the browser's Signal K administrator session because every route is protected
 * by the server's administrator middleware. The Binnacle device token must not be attached. */

import type { LngLatBbox } from 'signalk-chart-sources';
import { companionApiUrl } from '$shared/companion';
import {
  hasControlCharacters,
  isRecord,
  isSafeNonNegativeInteger,
  readBoundedJson,
  withTimeout,
} from '$shared/lib';
import { adminSessionInit } from '$shared/signalk';
import {
  CHART_LOCKER_MAX_REGION_NAME_LENGTH,
  CHART_LOCKER_MAX_SOURCE_ID_LENGTH,
  CHART_LOCKER_MAX_SOURCES,
  CHART_LOCKER_MAX_WARM_ZOOM,
} from './contract.js';

/** A non-ok HTTP response from a companion route, carrying the status so a caller can branch on it
 * (401 and 403 are a missing or refused token, other codes are a server or transport fault). Thrown
 * rather than parsing an error body as a valid payload. */
export class HttpStatusError extends Error {
  constructor(
    readonly status: number,
    readonly detail?: string,
  ) {
    super(
      detail === undefined
        ? `Chart Locker request failed (HTTP ${status})`
        : `Chart Locker: ${detail}`,
    );
    this.name = 'HttpStatusError';
  }
}

export class InvalidCacheStatsError extends TypeError {
  constructor() {
    super('invalid cache stats');
    this.name = 'InvalidCacheStatsError';
  }
}

export interface WarmStatus {
  total: number;
  done: number;
  skipped: number;
  bytes: number;
  errors: number;
  state: 'running' | 'done' | 'cancelled' | 'capped' | 'error';
}

export interface CacheStats {
  rows: number;
  bytes: number;
  cap: number;
  // The two-budget accounting fields, optional for backward compatibility with older containers.
  pinnedBytes?: number;
  scrollBytes?: number;
  regionsBudgetBytes?: number;
  positionWarmBudgetBytes?: number;
  positionWarmBytes?: number;
  regionsFreeBytes?: number;
  perSourceAvgBytes: Record<string, number>;
  // The per-source scroll totals and the current TTL days, optional for backward compatibility.
  bySource?: { source: string; bytes: number; rows: number }[];
  ttlDays?: number;
}

const isPositiveSafeNumber = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value > 0 &&
  value <= Number.MAX_SAFE_INTEGER;

const MAX_REGION_COUNT = 10_000;
const MAX_SOURCE_STATS_COUNT = 10_000;
const MAX_ID_LENGTH = 256;
const MAX_NAME_LENGTH = 512;
const MAX_JSON_RESPONSE_BYTES = 2 * 1024 * 1024;
const REGION_STATUSES: ReadonlySet<unknown> = new Set([
  'downloading',
  'ready',
  'capped',
  'error',
  'needs-redownload',
]);
const WARM_STATES: ReadonlySet<unknown> = new Set([
  'running',
  'done',
  'cancelled',
  'capped',
  'error',
]);

function safeText(value: unknown, maxLength: number): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maxLength &&
    !hasControlCharacters(value)
  );
}

/** Validate the cache statistics before strict estimate code consumes them. Invalid server or stale
 * cache data fails as a load error instead of throwing during Svelte rendering. */
function parseCacheStats(value: unknown): CacheStats {
  if (!isRecord(value)) throw new InvalidCacheStatsError();
  if (
    !isSafeNonNegativeInteger(value.rows) ||
    !isSafeNonNegativeInteger(value.bytes) ||
    !isSafeNonNegativeInteger(value.cap) ||
    !isRecord(value.perSourceAvgBytes)
  ) {
    throw new InvalidCacheStatsError();
  }

  const perSourceAvgBytes = Object.create(null) as Record<string, number>;
  const perSourceEntries = Object.entries(value.perSourceAvgBytes);
  if (perSourceEntries.length > MAX_SOURCE_STATS_COUNT) throw new InvalidCacheStatsError();
  for (const [source, bytes] of perSourceEntries) {
    // Chart Locker reports fractional measured averages, while the shared estimator requires
    // positive safe integers. Round up at this boundary to preserve a conservative planning value.
    if (
      !safeText(source, CHART_LOCKER_MAX_SOURCE_ID_LENGTH) ||
      source === '__proto__' ||
      source === 'prototype' ||
      source === 'constructor' ||
      !isPositiveSafeNumber(bytes)
    ) {
      throw new InvalidCacheStatsError();
    }
    perSourceAvgBytes[source] = Math.ceil(bytes);
  }

  const optionalByteFields = [
    'pinnedBytes',
    'scrollBytes',
    'regionsBudgetBytes',
    'positionWarmBudgetBytes',
    'positionWarmBytes',
    'regionsFreeBytes',
  ] as const;
  for (const field of optionalByteFields) {
    if (value[field] !== undefined && !isSafeNonNegativeInteger(value[field])) {
      throw new InvalidCacheStatsError();
    }
  }
  if (value.ttlDays !== undefined && !isSafeNonNegativeInteger(value.ttlDays)) {
    throw new InvalidCacheStatsError();
  }

  let bySource: CacheStats['bySource'];
  if (value.bySource !== undefined) {
    if (!Array.isArray(value.bySource) || value.bySource.length > MAX_SOURCE_STATS_COUNT) {
      throw new InvalidCacheStatsError();
    }
    const sources = new Set<string>();
    bySource = value.bySource.map((row) => {
      if (
        !isRecord(row) ||
        !safeText(row.source, CHART_LOCKER_MAX_SOURCE_ID_LENGTH) ||
        sources.has(row.source) ||
        !isSafeNonNegativeInteger(row.bytes) ||
        !isSafeNonNegativeInteger(row.rows)
      ) {
        throw new InvalidCacheStatsError();
      }
      sources.add(row.source);
      return { source: row.source, bytes: row.bytes, rows: row.rows };
    });
  }

  return {
    rows: value.rows,
    bytes: value.bytes,
    cap: value.cap,
    perSourceAvgBytes,
    ...(value.pinnedBytes !== undefined ? { pinnedBytes: value.pinnedBytes as number } : {}),
    ...(value.scrollBytes !== undefined ? { scrollBytes: value.scrollBytes as number } : {}),
    ...(value.regionsBudgetBytes !== undefined
      ? { regionsBudgetBytes: value.regionsBudgetBytes as number }
      : {}),
    ...(value.positionWarmBudgetBytes !== undefined
      ? { positionWarmBudgetBytes: value.positionWarmBudgetBytes as number }
      : {}),
    ...(value.positionWarmBytes !== undefined
      ? { positionWarmBytes: value.positionWarmBytes as number }
      : {}),
    ...(value.regionsFreeBytes !== undefined
      ? { regionsFreeBytes: value.regionsFreeBytes as number }
      : {}),
    ...(bySource !== undefined ? { bySource } : {}),
    ...(value.ttlDays !== undefined ? { ttlDays: value.ttlDays as number } : {}),
  };
}

export interface SavedRegionDto {
  id: string;
  name: string;
  bbox: LngLatBbox;
  sourceIds: string[];
  minzoom: number;
  maxzoom: number;
  createdAt: number;
  lastDownloadedAt: number | null;
  bytes: number;
  status: 'downloading' | 'ready' | 'capped' | 'error' | 'needs-redownload';
  // Cache-derived from the container: SELECT SUM(bytes) WHERE region_id = ?.
  cachedBytes: number;
  // Sources retained by the saved definition but absent from Chart Locker's current catalog.
  unavailableSourceIds: string[];
}

interface RegionRequest {
  bbox: LngLatBbox;
  sourceIds: string[];
  minzoom: number;
  maxzoom: number;
  name: string;
}

type RegionJobStart = { jobId: string; recovery?: never } | { jobId?: never; recovery: 'pending' };

type PostRegionResult = { region: SavedRegionDto } & RegionJobStart;

type SavedRegionResponse = 'list' | 'mutation';

export interface RegionsClient {
  getConfig(signal?: AbortSignal): Promise<unknown>;
  postConfig(config: unknown): Promise<void>;
  setCacheConfig(ttlDays: number): Promise<void>;
  clearScrollCache(): Promise<{ freedBytes: number; freedRows: number }>;
  getCacheStats(signal?: AbortSignal): Promise<CacheStats>;
  getRegions(signal?: AbortSignal): Promise<SavedRegionDto[]>;
  postRegion(body: RegionRequest): Promise<PostRegionResult>;
  deleteRegion(id: string): Promise<void>;
  redownloadRegion(id: string): Promise<RegionJobStart>;
  getRegionJobStatus(id: string, signal?: AbortSignal): Promise<WarmStatus | null>;
  geocode(lat: number, lon: number, signal?: AbortSignal): Promise<string | null>;
}

function parseBbox(value: unknown): LngLatBbox {
  if (
    !Array.isArray(value) ||
    value.length !== 4 ||
    !value.every((part) => typeof part === 'number' && Number.isFinite(part)) ||
    value[0] < -180 ||
    value[0] > 180 ||
    value[2] < -180 ||
    value[2] > 180 ||
    value[1] < -90 ||
    value[1] > 90 ||
    value[3] < -90 ||
    value[3] > 90 ||
    value[1] > value[3]
  ) {
    throw new TypeError('invalid saved region');
  }
  return [value[0], value[1], value[2], value[3]] as LngLatBbox;
}

function parseSavedRegion(value: unknown, response: SavedRegionResponse): SavedRegionDto {
  if (!isRecord(value)) throw new TypeError('invalid saved region');
  // Chart Locker 0.5.0 omitted this cache-derived field from create responses even though its list
  // response included it. A newly accepted region has no confirmed cached bytes yet, so zero is the
  // safe compatibility value until the next list or status refresh.
  const cachedBytes =
    response === 'mutation' && value.cachedBytes === undefined ? 0 : value.cachedBytes;
  const sourceIds = Array.isArray(value.sourceIds) ? value.sourceIds : [];
  const unavailableSourceIds =
    value.unavailableSourceIds === undefined ? [] : value.unavailableSourceIds;
  if (
    !safeText(value.id, MAX_ID_LENGTH) ||
    !safeText(value.name, CHART_LOCKER_MAX_REGION_NAME_LENGTH) ||
    sourceIds.length === 0 ||
    sourceIds.length > CHART_LOCKER_MAX_SOURCES ||
    !sourceIds.every((source) => safeText(source, CHART_LOCKER_MAX_SOURCE_ID_LENGTH)) ||
    new Set(sourceIds).size !== sourceIds.length ||
    !Array.isArray(unavailableSourceIds) ||
    unavailableSourceIds.length > sourceIds.length ||
    !unavailableSourceIds.every((source) => safeText(source, CHART_LOCKER_MAX_SOURCE_ID_LENGTH)) ||
    new Set(unavailableSourceIds).size !== unavailableSourceIds.length ||
    !unavailableSourceIds.every((source) => sourceIds.includes(source)) ||
    !isSafeNonNegativeInteger(value.minzoom) ||
    !isSafeNonNegativeInteger(value.maxzoom) ||
    value.minzoom > value.maxzoom ||
    value.maxzoom > CHART_LOCKER_MAX_WARM_ZOOM ||
    !isSafeNonNegativeInteger(value.createdAt) ||
    !(value.lastDownloadedAt === null || isSafeNonNegativeInteger(value.lastDownloadedAt)) ||
    !isSafeNonNegativeInteger(value.bytes) ||
    !isSafeNonNegativeInteger(cachedBytes) ||
    !REGION_STATUSES.has(value.status)
  ) {
    throw new TypeError('invalid saved region');
  }
  return {
    id: value.id,
    name: value.name,
    bbox: parseBbox(value.bbox),
    sourceIds: [...(sourceIds as string[])],
    minzoom: value.minzoom,
    maxzoom: value.maxzoom,
    createdAt: value.createdAt,
    lastDownloadedAt: value.lastDownloadedAt as number | null,
    bytes: value.bytes,
    status: value.status as SavedRegionDto['status'],
    cachedBytes,
    unavailableSourceIds: [...(unavailableSourceIds as string[])],
  };
}

function parseSavedRegions(value: unknown): SavedRegionDto[] {
  if (!Array.isArray(value) || value.length > MAX_REGION_COUNT) {
    throw new TypeError('invalid saved regions');
  }
  const ids = new Set<string>();
  return value.map((region) => {
    const parsed = parseSavedRegion(region, 'list');
    if (ids.has(parsed.id)) throw new TypeError('invalid saved regions');
    ids.add(parsed.id);
    return parsed;
  });
}

function parseJobResponse(value: unknown, status: number): RegionJobStart {
  if (!isRecord(value)) throw new TypeError('invalid region job');
  if (status === 200 && safeText(value.jobId, MAX_ID_LENGTH) && value.recovery === undefined) {
    return { jobId: value.jobId };
  }
  if (status === 202 && value.jobId === undefined && value.recovery === 'pending') {
    return { recovery: 'pending' };
  }
  throw new TypeError('invalid region job');
}

function parsePostRegionResponse(value: unknown, status: number): PostRegionResult {
  if (!isRecord(value)) throw new TypeError('invalid region job');
  return {
    region: parseSavedRegion(value.region, 'mutation'),
    ...parseJobResponse(value, status),
  };
}

function parseClearScrollResponse(value: unknown): { freedBytes: number; freedRows: number } {
  if (
    !isRecord(value) ||
    !isSafeNonNegativeInteger(value.freedBytes) ||
    !isSafeNonNegativeInteger(value.freedRows)
  ) {
    throw new TypeError('invalid cache clear result');
  }
  return { freedBytes: value.freedBytes, freedRows: value.freedRows };
}

function parseWarmStatus(value: unknown): WarmStatus {
  if (!isRecord(value)) throw new TypeError('invalid region status');
  if (
    !isSafeNonNegativeInteger(value.total) ||
    !isSafeNonNegativeInteger(value.done) ||
    value.done > value.total ||
    !isSafeNonNegativeInteger(value.skipped) ||
    value.done + value.skipped > value.total ||
    !isSafeNonNegativeInteger(value.bytes) ||
    !isSafeNonNegativeInteger(value.errors) ||
    !WARM_STATES.has(value.state)
  ) {
    throw new TypeError('invalid region status');
  }
  return {
    total: value.total,
    done: value.done,
    skipped: value.skipped,
    bytes: value.bytes,
    errors: value.errors,
    state: value.state as WarmStatus['state'],
  };
}

export function createRegionsClient(
  origin: string,
  fetchImpl: typeof fetch = fetch,
): RegionsClient {
  const url = (path: string): string => companionApiUrl(origin, path);
  const readJson = async <T>(response: Response): Promise<T> => {
    if (!response.body) throw new TypeError('companion response has no body');
    try {
      return await readBoundedJson<T>(response, MAX_JSON_RESPONSE_BYTES);
    } catch (error) {
      if (error instanceof TypeError && error.message === 'invalid JSON response length') {
        throw new TypeError('invalid companion response length');
      }
      if (error instanceof TypeError && error.message === 'JSON response is too large') {
        throw new TypeError('companion response is too large');
      }
      throw error;
    }
  };
  const statusError = async (response: Response): Promise<HttpStatusError> => {
    try {
      const body = await readJson<unknown>(response);
      const detail =
        isRecord(body) && safeText(body.error, MAX_NAME_LENGTH) ? body.error : undefined;
      return new HttpStatusError(response.status, detail);
    } catch {
      return new HttpStatusError(response.status);
    }
  };
  // Without an ok check a 401 or 500 could parse an error body into feature state or vanish on a void
  // route. Preserve a bounded Chart Locker reason when available so deterministic rejections explain
  // what the user can change, while malformed error bodies remain generic.
  const ensureOk = async (response: Response): Promise<Response> => {
    if (!response.ok) throw await statusError(response);
    return response;
  };
  const json = async <T>(response: Response): Promise<T> => readJson<T>(await ensureOk(response));
  // Every management call carries the administrator session cookie and a request timeout, so a
  // half-open link on a boat bounds the wait without masking the session with a device bearer token.
  const init = (extra?: RequestInit): RequestInit => withTimeout(adminSessionInit(extra));
  const jsonPost = (body: unknown): RequestInit =>
    init({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  return {
    async getConfig(signal) {
      return json(await fetchImpl(url('/position-warm/config'), init({ signal })));
    },
    async postConfig(config) {
      await ensureOk(await fetchImpl(url('/position-warm/config'), jsonPost(config)));
    },
    async setCacheConfig(ttlDays) {
      await ensureOk(await fetchImpl(url('/cache/config'), jsonPost({ ttlDays })));
    },
    async clearScrollCache() {
      return parseClearScrollResponse(
        await json<unknown>(await fetchImpl(url('/cache/clear-scroll'), init({ method: 'POST' }))),
      );
    },
    async getCacheStats(signal) {
      return parseCacheStats(
        await json<unknown>(await fetchImpl(url('/cache/stats'), init({ signal }))),
      );
    },
    async getRegions(signal) {
      return parseSavedRegions(
        await json<unknown>(await fetchImpl(url('/regions'), init({ signal }))),
      );
    },
    async postRegion(body) {
      const response = await fetchImpl(url('/regions'), jsonPost(body));
      return parsePostRegionResponse(await json<unknown>(response), response.status);
    },
    async deleteRegion(id) {
      await ensureOk(
        await fetchImpl(url(`/regions/${encodeURIComponent(id)}`), init({ method: 'DELETE' })),
      );
    },
    async redownloadRegion(id) {
      const response = await fetchImpl(
        url(`/regions/${encodeURIComponent(id)}/redownload`),
        init({ method: 'POST' }),
      );
      return parseJobResponse(await json<unknown>(response), response.status);
    },
    async getRegionJobStatus(id, signal) {
      const r = await fetchImpl(url(`/regions/${encodeURIComponent(id)}/status`), init({ signal }));
      // A 404 means the job is gone (the region reconciled server-side): treat it as terminal, not a
      // failure. Any other non-ok is a real failure, so throw rather than parse an error body as a
      // status snapshot, letting the poller count it and stop after a small cap.
      if (r.status === 404) return null;
      return parseWarmStatus(await json<unknown>(r));
    },
    async geocode(lat, lon, signal) {
      try {
        const r = await fetchImpl(
          url(`/geocode?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`),
          init({ signal }),
        );
        if (!r.ok) return null;
        const data = await json<unknown>(r);
        return isRecord(data) && safeText(data.display_name, MAX_NAME_LENGTH)
          ? data.display_name
          : null;
      } catch {
        return null;
      }
    },
  };
}
