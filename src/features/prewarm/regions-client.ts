/** The webapp client for the companion regions and config routes. The panel never calls the container
 * directly; it always goes through the admin-gated plugin routes, so the container port stays private.
 * Auth uses the browser's Signal K administrator session because every route is protected
 * by the server's administrator middleware. The Binnacle device token must not be attached. */

import type { Bbox } from 'signalk-chart-sources';
import { companionApiUrl } from '$shared/companion';
import { withTimeout } from '$shared/lib';
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
  constructor(readonly status: number) {
    super(`companion request failed with ${status}`);
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isNonNegativeSafeInteger = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;

const isPositiveFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

const MAX_REGION_COUNT = 10_000;
const MAX_SOURCE_STATS_COUNT = 10_000;
const MAX_ID_LENGTH = 256;
const MAX_NAME_LENGTH = 512;
const MAX_JSON_RESPONSE_BYTES = 2 * 1024 * 1024;

function safeText(value: unknown, maxLength: number): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maxLength &&
    ![...value].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code <= 0x1f || code === 0x7f;
    })
  );
}

/** Validate the cache statistics before strict estimate code consumes them. Invalid server or stale
 * cache data fails as a load error instead of throwing during Svelte rendering. */
function parseCacheStats(value: unknown): CacheStats {
  if (!isRecord(value)) throw new InvalidCacheStatsError();
  if (
    !isNonNegativeSafeInteger(value.rows) ||
    !isNonNegativeSafeInteger(value.bytes) ||
    !isNonNegativeSafeInteger(value.cap) ||
    !isRecord(value.perSourceAvgBytes)
  ) {
    throw new InvalidCacheStatsError();
  }

  const perSourceAvgBytes = Object.create(null) as Record<string, number>;
  const perSourceEntries = Object.entries(value.perSourceAvgBytes);
  if (perSourceEntries.length > MAX_SOURCE_STATS_COUNT) throw new InvalidCacheStatsError();
  for (const [source, bytes] of perSourceEntries) {
    // Chart Locker reports measured averages, so fractional positive values are expected. Totals
    // remain integers, but rounding an average here would distort planning estimates.
    if (
      !safeText(source, CHART_LOCKER_MAX_SOURCE_ID_LENGTH) ||
      source === '__proto__' ||
      source === 'prototype' ||
      source === 'constructor' ||
      !isPositiveFiniteNumber(bytes)
    ) {
      throw new InvalidCacheStatsError();
    }
    perSourceAvgBytes[source] = bytes;
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
    if (value[field] !== undefined && !isNonNegativeSafeInteger(value[field])) {
      throw new InvalidCacheStatsError();
    }
  }
  if (value.ttlDays !== undefined && !isNonNegativeSafeInteger(value.ttlDays)) {
    throw new InvalidCacheStatsError();
  }

  let bySource: CacheStats['bySource'];
  if (value.bySource !== undefined) {
    if (!Array.isArray(value.bySource) || value.bySource.length > MAX_SOURCE_STATS_COUNT) {
      throw new InvalidCacheStatsError();
    }
    bySource = value.bySource.map((row) => {
      if (
        !isRecord(row) ||
        !safeText(row.source, CHART_LOCKER_MAX_SOURCE_ID_LENGTH) ||
        !isNonNegativeSafeInteger(row.bytes) ||
        !isNonNegativeSafeInteger(row.rows)
      ) {
        throw new InvalidCacheStatsError();
      }
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
  bbox: Bbox;
  sourceIds: string[];
  minzoom: number;
  maxzoom: number;
  createdAt: number;
  lastDownloadedAt: number | null;
  bytes: number;
  status: 'downloading' | 'ready' | 'capped' | 'error' | 'needs-redownload';
  // Cache-derived from the container: SELECT SUM(bytes) WHERE region_id = ?.
  cachedBytes: number;
}

interface RegionRequest {
  bbox: Bbox;
  sourceIds: string[];
  minzoom: number;
  maxzoom: number;
  name: string;
}

type RegionJobStart = { jobId: string; recovery?: never } | { jobId?: never; recovery: 'pending' };

type PostRegionResult = { region: SavedRegionDto } & RegionJobStart;

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

function parseBbox(value: unknown): Bbox {
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
  return value as unknown as Bbox;
}

function parseSavedRegion(value: unknown, allowMissingCachedBytes = false): SavedRegionDto {
  if (!isRecord(value)) throw new TypeError('invalid saved region');
  // Chart Locker 0.5.0 omitted this cache-derived field from create responses even though its list
  // response included it. A newly accepted region has no confirmed cached bytes yet, so zero is the
  // safe compatibility value until the next list or status refresh.
  const cachedBytes =
    allowMissingCachedBytes && value.cachedBytes === undefined ? 0 : value.cachedBytes;
  const statuses: ReadonlySet<unknown> = new Set([
    'downloading',
    'ready',
    'capped',
    'error',
    'needs-redownload',
  ]);
  if (
    !safeText(value.id, MAX_ID_LENGTH) ||
    !safeText(value.name, CHART_LOCKER_MAX_REGION_NAME_LENGTH) ||
    !Array.isArray(value.sourceIds) ||
    value.sourceIds.length > CHART_LOCKER_MAX_SOURCES ||
    !value.sourceIds.every((source) => safeText(source, CHART_LOCKER_MAX_SOURCE_ID_LENGTH)) ||
    !isNonNegativeSafeInteger(value.minzoom) ||
    !isNonNegativeSafeInteger(value.maxzoom) ||
    value.minzoom > value.maxzoom ||
    value.maxzoom > CHART_LOCKER_MAX_WARM_ZOOM ||
    !isNonNegativeSafeInteger(value.createdAt) ||
    !(value.lastDownloadedAt === null || isNonNegativeSafeInteger(value.lastDownloadedAt)) ||
    !isNonNegativeSafeInteger(value.bytes) ||
    !isNonNegativeSafeInteger(cachedBytes) ||
    !statuses.has(value.status)
  ) {
    throw new TypeError('invalid saved region');
  }
  return {
    id: value.id,
    name: value.name,
    bbox: parseBbox(value.bbox),
    sourceIds: [...new Set(value.sourceIds as string[])],
    minzoom: value.minzoom,
    maxzoom: value.maxzoom,
    createdAt: value.createdAt,
    lastDownloadedAt: value.lastDownloadedAt as number | null,
    bytes: value.bytes,
    status: value.status as SavedRegionDto['status'],
    cachedBytes,
  };
}

function parseSavedRegions(value: unknown): SavedRegionDto[] {
  if (!Array.isArray(value) || value.length > MAX_REGION_COUNT) {
    throw new TypeError('invalid saved regions');
  }
  return value.map((region) => parseSavedRegion(region));
}

function parseJobResponse(value: unknown): RegionJobStart {
  if (!isRecord(value)) throw new TypeError('invalid region job');
  if (safeText(value.jobId, MAX_ID_LENGTH) && value.recovery === undefined) {
    return { jobId: value.jobId };
  }
  if (value.jobId === undefined && value.recovery === 'pending') {
    return { recovery: 'pending' };
  }
  throw new TypeError('invalid region job');
}

function parsePostRegionResponse(value: unknown): PostRegionResult {
  if (!isRecord(value)) throw new TypeError('invalid region job');
  return { region: parseSavedRegion(value.region, true), ...parseJobResponse(value) };
}

function parseClearScrollResponse(value: unknown): { freedBytes: number; freedRows: number } {
  if (
    !isRecord(value) ||
    !isNonNegativeSafeInteger(value.freedBytes) ||
    !isNonNegativeSafeInteger(value.freedRows)
  ) {
    throw new TypeError('invalid cache clear result');
  }
  return { freedBytes: value.freedBytes, freedRows: value.freedRows };
}

function parseWarmStatus(value: unknown): WarmStatus {
  if (!isRecord(value)) throw new TypeError('invalid region status');
  const states: ReadonlySet<unknown> = new Set(['running', 'done', 'cancelled', 'capped', 'error']);
  if (
    !isNonNegativeSafeInteger(value.total) ||
    !isNonNegativeSafeInteger(value.done) ||
    value.done > value.total ||
    !isNonNegativeSafeInteger(value.skipped) ||
    value.done + value.skipped > value.total ||
    !isNonNegativeSafeInteger(value.bytes) ||
    !isNonNegativeSafeInteger(value.errors) ||
    !states.has(value.state)
  ) {
    throw new TypeError('invalid region status');
  }
  return value as unknown as WarmStatus;
}

export function createRegionsClient(
  origin: string,
  fetchImpl: typeof fetch = fetch,
): RegionsClient {
  const url = (path: string): string => companionApiUrl(origin, path);
  // Without an r.ok check a 401 or a 500 would parse an error body into garbage data (or vanish
  // entirely on the void routes). Throw the status so the caller maps 401 and 403 to an administrator
  // access prompt and any other fault to a not-responding state.
  const ensureOk = (r: Response): Response => {
    if (!r.ok) throw new HttpStatusError(r.status);
    return r;
  };
  const json = async <T>(r: Response): Promise<T> => {
    const response = ensureOk(r);
    if (!response.body) throw new TypeError('companion response has no body');
    const declaredLength = response.headers.get('Content-Length');
    if (declaredLength !== null) {
      if (!/^(0|[1-9]\d*)$/.test(declaredLength)) {
        await response.body.cancel().catch(() => undefined);
        throw new TypeError('invalid companion response length');
      }
      const length = Number(declaredLength);
      if (!Number.isSafeInteger(length) || length > MAX_JSON_RESPONSE_BYTES) {
        await response.body.cancel().catch(() => undefined);
        throw new TypeError('companion response is too large');
      }
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let total = 0;
    let text = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_JSON_RESPONSE_BYTES) {
          throw new TypeError('companion response is too large');
        }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
      return JSON.parse(text) as T;
    } catch (error) {
      await reader.cancel().catch(() => undefined);
      throw error;
    }
  };
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
      ensureOk(await fetchImpl(url('/position-warm/config'), jsonPost(config)));
    },
    async setCacheConfig(ttlDays) {
      ensureOk(await fetchImpl(url('/cache/config'), jsonPost({ ttlDays })));
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
      return parsePostRegionResponse(
        await json<unknown>(await fetchImpl(url('/regions'), jsonPost(body))),
      );
    },
    async deleteRegion(id) {
      ensureOk(
        await fetchImpl(url(`/regions/${encodeURIComponent(id)}`), init({ method: 'DELETE' })),
      );
    },
    async redownloadRegion(id) {
      return parseJobResponse(
        await json<unknown>(
          await fetchImpl(
            url(`/regions/${encodeURIComponent(id)}/redownload`),
            init({ method: 'POST' }),
          ),
        ),
      );
    },
    async getRegionJobStatus(id, signal) {
      const r = await fetchImpl(url(`/regions/${encodeURIComponent(id)}/status`), init({ signal }));
      // A 404 means the job is gone (the region reconciled server-side): treat it as terminal, not a
      // failure. Any other non-ok is a real failure, so throw rather than parse an error body as a
      // status snapshot, letting the poller count it and stop after a small cap.
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`region status ${r.status}`);
      return parseWarmStatus(await json<unknown>(r));
    },
    async geocode(lat, lon, signal) {
      try {
        const r = await fetchImpl(
          url(`/geocode?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`),
          init({ signal }),
        );
        if (!r.ok) return null;
        const data = await json<Record<string, unknown>>(r);
        return safeText(data.display_name, MAX_NAME_LENGTH) ? data.display_name : null;
      } catch {
        return null;
      }
    },
  };
}
