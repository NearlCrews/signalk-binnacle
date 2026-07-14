/** The webapp client for the companion regions and config routes. The panel never calls the container
 * directly; it always goes through the admin-gated plugin routes, so the container port stays private.
 * Auth uses the browser's Signal K administrator session because every route is protected
 * by the server's administrator middleware. The Binnacle device token must not be attached. */

import type { Bbox } from 'signalk-chart-sources';
import { companionApiUrl } from '$shared/companion';
import { withTimeout } from '$shared/lib';
import { adminSessionInit } from '$shared/signalk';

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

  const perSourceAvgBytes: Record<string, number> = {};
  for (const [source, bytes] of Object.entries(value.perSourceAvgBytes)) {
    // Chart Locker reports measured averages, so fractional positive values are expected. Totals
    // remain integers, but rounding an average here would distort planning estimates.
    if (source.length === 0 || !isPositiveFiniteNumber(bytes)) {
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
    if (!Array.isArray(value.bySource)) throw new InvalidCacheStatsError();
    bySource = value.bySource.map((row) => {
      if (
        !isRecord(row) ||
        typeof row.source !== 'string' ||
        row.source.length === 0 ||
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

export interface RegionsClient {
  getConfig(): Promise<unknown>;
  postConfig(config: unknown): Promise<void>;
  setCacheConfig(ttlDays: number): Promise<void>;
  clearScrollCache(): Promise<{ freedBytes: number; freedRows: number }>;
  getCacheStats(): Promise<CacheStats>;
  getRegions(): Promise<SavedRegionDto[]>;
  postRegion(body: RegionRequest): Promise<{ region: SavedRegionDto; jobId: string }>;
  deleteRegion(id: string): Promise<void>;
  redownloadRegion(id: string): Promise<{ jobId: string }>;
  getRegionJobStatus(id: string): Promise<WarmStatus | null>;
  geocode(lat: number, lon: number): Promise<string | null>;
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
  const json = async <T>(r: Response): Promise<T> => (await ensureOk(r).json()) as T;
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
    async getConfig() {
      return json(await fetchImpl(url('/position-warm/config'), init()));
    },
    async postConfig(config) {
      ensureOk(await fetchImpl(url('/position-warm/config'), jsonPost(config)));
    },
    async setCacheConfig(ttlDays) {
      ensureOk(await fetchImpl(url('/cache/config'), jsonPost({ ttlDays })));
    },
    async clearScrollCache() {
      return json<{ freedBytes: number; freedRows: number }>(
        await fetchImpl(url('/cache/clear-scroll'), init({ method: 'POST' })),
      );
    },
    async getCacheStats() {
      return parseCacheStats(await json<unknown>(await fetchImpl(url('/cache/stats'), init())));
    },
    async getRegions() {
      return json<SavedRegionDto[]>(await fetchImpl(url('/regions'), init()));
    },
    async postRegion(body) {
      return json<{ region: SavedRegionDto; jobId: string }>(
        await fetchImpl(url('/regions'), jsonPost(body)),
      );
    },
    async deleteRegion(id) {
      ensureOk(
        await fetchImpl(url(`/regions/${encodeURIComponent(id)}`), init({ method: 'DELETE' })),
      );
    },
    async redownloadRegion(id) {
      return json<{ jobId: string }>(
        await fetchImpl(
          url(`/regions/${encodeURIComponent(id)}/redownload`),
          init({ method: 'POST' }),
        ),
      );
    },
    async getRegionJobStatus(id) {
      const r = await fetchImpl(url(`/regions/${encodeURIComponent(id)}/status`), init());
      // A 404 means the job is gone (the region reconciled server-side): treat it as terminal, not a
      // failure. Any other non-ok is a real failure, so throw rather than parse an error body as a
      // status snapshot, letting the poller count it and stop after a small cap.
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`region status ${r.status}`);
      return json<WarmStatus>(r);
    },
    async geocode(lat, lon) {
      try {
        const r = await fetchImpl(
          url(`/geocode?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`),
          init(),
        );
        if (!r.ok) return null;
        const data = (await r.json()) as Record<string, unknown>;
        return typeof data.display_name === 'string' ? data.display_name : null;
      } catch {
        return null;
      }
    },
  };
}
