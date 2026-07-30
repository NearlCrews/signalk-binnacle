import { fetchJsonOrUndefined, hasControlCharacters, isRecord } from '$shared/lib';
import { fetchProviderIds, type ProviderIds, safeProviderId } from './provider-probe';
import { authInit } from './resource';

// The server's v2 History API (signalk-server 2.19 and later): the server core mounts
// /signalk/v2/api/history and proxies to pluggable providers (signalk-questdb,
// signalk-to-influxdb2 2.x, signalk-parquet). The shape is columnar: one row per bucket,
// [timestamp, ...one value per requested path], nulls filling gaps. Stock servers have the
// routes but no provider; /values then answers 501, and _providers answers {}.
const HISTORY_API = '/signalk/v2/api/history';
export const MAX_HISTORY_PROVIDERS = 8;
export const MAX_HISTORY_CATALOG_PATHS = 2_000;
const MAX_HISTORY_PATH_LENGTH = 512;
export const MAX_HISTORY_QUERY_PATHS = 100;
const MAX_HISTORY_ROWS = 100_000;
const MAX_HISTORY_DURATION_SECONDS = 366 * 24 * 60 * 60;
const MAX_HISTORY_METHOD_LENGTH = 64;
const HISTORY_VALIDATION_BATCH_SIZE = 25;

function safeDuration(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0 && value <= MAX_HISTORY_DURATION_SECONDS;
}

function safeHistoryPath(path: unknown): path is string {
  return (
    typeof path === 'string' &&
    path.length > 0 &&
    path.length <= MAX_HISTORY_PATH_LENGTH &&
    !path.includes(',') &&
    !hasControlCharacters(path)
  );
}

function safeHistoryTimestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 64 &&
    !hasControlCharacters(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function parseHistoryRange(value: unknown): { from: string; to: string } | undefined {
  if (!isRecord(value) || !safeHistoryTimestamp(value.from) || !safeHistoryTimestamp(value.to)) {
    return undefined;
  }
  if (Date.parse(value.from) > Date.parse(value.to)) return undefined;
  return { from: value.from, to: value.to };
}

function safeQueryPaths(paths: readonly string[]): boolean {
  return (
    paths.length > 0 && paths.length <= MAX_HISTORY_QUERY_PATHS && paths.every(safeHistoryPath)
  );
}

// The history-track window and bucket resolution. Time travel reuses these values for its default
// 24-hour preset, while its other presets define their own bounded resolutions.
export const HISTORY_WINDOW_SECONDS = 24 * 60 * 60;
export const HISTORY_RESOLUTION_SECONDS = 60;

export type HistoryProviders = ProviderIds;

interface HistoryColumn {
  path: string;
  method: string;
}

export interface HistoryValues {
  from: string;
  to: string;
  columns: readonly HistoryColumn[];
  rows: ReadonlyArray<readonly [string, ...unknown[]]>;
}

export interface HistoryQuery {
  // path or path:aggregate entries (average, min, max, first, last).
  paths: readonly string[];
  durationSeconds: number;
  resolutionSeconds?: number;
  provider?: string;
  signal?: AbortSignal;
}

export interface HistoryPathsQuery {
  durationSeconds: number;
  provider?: string;
  signal?: AbortSignal;
}

// The column index for a path, method-aware. When a method is given, prefer the exact
// path-plus-method column (duplicate paths with different aggregates are legal in one query), then
// fall back to the first column matching the path alone for a provider that omits the method echo.
// Returns -1 when nothing matches. Shared by the trends, time-travel, and history-track readers so the
// column lookup lives in one place.
export function columnIndex(values: HistoryValues, path: string, method?: string): number {
  if (method !== undefined) {
    const exact = values.columns.findIndex((c) => c.path === path && c.method === method);
    if (exact >= 0) return exact;
  }
  return values.columns.findIndex((c) => c.path === path);
}

export function fetchHistoryProviders(
  base: string,
  token?: string,
): Promise<HistoryProviders | undefined> {
  return fetchProviderIds(`${base}${HISTORY_API}/_providers`, token, MAX_HISTORY_PROVIDERS);
}

export async function fetchHistoryValues(
  base: string,
  token: string | undefined,
  query: HistoryQuery,
): Promise<HistoryValues | undefined> {
  if (
    !safeQueryPaths(query.paths) ||
    !safeDuration(query.durationSeconds) ||
    !safeProviderId(query.provider) ||
    (query.resolutionSeconds !== undefined &&
      (!Number.isSafeInteger(query.resolutionSeconds) ||
        query.resolutionSeconds <= 0 ||
        query.resolutionSeconds > query.durationSeconds))
  ) {
    return undefined;
  }
  const params = new URLSearchParams({
    paths: query.paths.join(','),
    duration: String(query.durationSeconds),
  });
  if (query.resolutionSeconds !== undefined) {
    params.set('resolution', String(query.resolutionSeconds));
  }
  if (query.provider) params.set('provider', query.provider);
  const body = await fetchJsonOrUndefined<{
    range?: unknown;
    values?: unknown;
    data?: unknown;
  }>(
    `${base}${HISTORY_API}/values?${params}`,
    authInit(token, query.signal ? { signal: query.signal } : undefined),
  );
  const range = parseHistoryRange(body?.range);
  // A non-ok or malformed body is undefined (unreachable); a 2xx with a valid range, columns, and an
  // empty data array is a real empty result (provider present, no samples in the window), kept
  // distinct so the panel can say "no data" rather than treating it as a transport failure.
  if (
    !body ||
    !range ||
    !Array.isArray(body.values) ||
    body.values.length > MAX_HISTORY_QUERY_PATHS ||
    !Array.isArray(body.data) ||
    body.data.length > MAX_HISTORY_ROWS
  ) {
    return undefined;
  }
  const columns: HistoryColumn[] = [];
  const columnIds = new Set<string>();
  for (const col of body.values) {
    const { path, method } = (col ?? {}) as { path?: unknown; method?: unknown };
    if (
      !safeHistoryPath(path) ||
      (method !== undefined &&
        (typeof method !== 'string' ||
          method.length > MAX_HISTORY_METHOD_LENGTH ||
          hasControlCharacters(method)))
    ) {
      return undefined;
    }
    const normalizedMethod = typeof method === 'string' ? method : '';
    const columnId = `${path}\u0000${normalizedMethod}`;
    if (columnIds.has(columnId)) return undefined;
    columnIds.add(columnId);
    columns.push({ path, method: normalizedMethod });
  }
  const rows = body.data.filter(
    (row): row is [string, ...unknown[]] =>
      Array.isArray(row) &&
      typeof row[0] === 'string' &&
      row[0].length <= 64 &&
      !hasControlCharacters(row[0]) &&
      row.length === columns.length + 1,
  );
  return {
    from: range.from,
    to: range.to,
    columns,
    rows,
  };
}

// Lists paths recorded by one history provider during a bounded time window. This is useful for
// catalog discovery, but it does not imply that any listed path is reporting live data now.
export async function fetchHistoryPaths(
  base: string,
  token: string | undefined,
  query: HistoryPathsQuery,
): Promise<readonly string[] | undefined> {
  if (!safeDuration(query.durationSeconds) || !safeProviderId(query.provider)) return undefined;
  const params = new URLSearchParams({ duration: String(query.durationSeconds) });
  if (query.provider) params.set('provider', query.provider);
  const body = await fetchJsonOrUndefined<unknown>(
    `${base}${HISTORY_API}/paths?${params}`,
    authInit(token, query.signal ? { signal: query.signal } : undefined),
  );
  if (!Array.isArray(body)) return undefined;
  const bounded = body.slice(0, MAX_HISTORY_CATALOG_PATHS);
  if (bounded.some((path) => typeof path !== 'string')) return undefined;
  return [...new Set(bounded.filter(safeHistoryPath))].sort();
}

export interface HistoryProviderPathCatalogs {
  catalogs: ReadonlyArray<{ provider: string; paths: readonly string[] }>;
  complete: boolean;
}

// Preserve which provider owns each catalog so context validation never sprays every path across
// every database. Sequential requests cap concurrency at one during this infrequent setup scan.
export async function fetchHistoryProviderPathCatalogs(
  base: string,
  token: string | undefined,
  providers: HistoryProviders,
  query: Omit<HistoryPathsQuery, 'provider'>,
): Promise<HistoryProviderPathCatalogs> {
  const catalogs: Array<{ provider: string; paths: readonly string[] }> = [];
  let complete = true;
  for (const provider of providers.ids.slice(0, MAX_HISTORY_PROVIDERS)) {
    if (query.signal?.aborted) {
      complete = false;
      break;
    }
    const paths = await fetchHistoryPaths(base, token, { ...query, provider });
    if (paths) catalogs.push({ provider, paths });
    else complete = false;
  }
  return { catalogs, complete };
}

// The paths endpoint is intentionally context-free. Confirm candidate instrument paths through
// context-scoped values queries before treating them as belonging to vessels.self. A one-window
// resolution asks only whether each path populated at least once, not for its stored samples.
export async function fetchPopulatedHistoryPathsForProvider(
  base: string,
  token: string | undefined,
  provider: string,
  paths: readonly string[],
  durationSeconds: number,
  signal?: AbortSignal,
): Promise<{ paths: readonly string[]; complete: boolean; answered: boolean }> {
  const candidates = [...new Set(paths)]
    .filter(safeHistoryPath)
    .slice(0, MAX_HISTORY_CATALOG_PATHS);
  const populated = new Set<string>();
  let complete = true;
  let answered = false;
  for (let offset = 0; offset < candidates.length; offset += HISTORY_VALIDATION_BATCH_SIZE) {
    if (signal?.aborted) {
      complete = false;
      break;
    }
    const batch = candidates.slice(offset, offset + HISTORY_VALIDATION_BATCH_SIZE);
    const values = await fetchHistoryValues(base, token, {
      paths: batch,
      durationSeconds,
      resolutionSeconds: durationSeconds,
      provider,
      signal,
    });
    if (!values) {
      complete = false;
      continue;
    }
    answered = true;
    const columnsByPath = new Map<string, number[]>();
    for (let column = 0; column < values.columns.length; column += 1) {
      const path = values.columns[column].path;
      const columns = columnsByPath.get(path) ?? [];
      columns.push(column);
      columnsByPath.set(path, columns);
    }
    for (const path of batch) {
      const columns = columnsByPath.get(path) ?? [];
      if (columns.length !== 1) {
        complete = false;
        continue;
      }
      const column = columns[0];
      if (values.rows.some((row) => row[column + 1] != null)) populated.add(path);
    }
  }
  return { paths: [...populated].sort(), complete, answered };
}

// One query that survives a default provider with no data: providers register independently
// (KIP registers its own beside signalk-questdb, and it can be the empty default), so when the
// default answers with zero rows, each remaining provider is asked once. Returns the response
// plus the provider that actually answered with rows, so a caller can pin later queries to it.
export async function fetchHistoryValuesAcrossProviders(
  base: string,
  token: string | undefined,
  providers: HistoryProviders,
  query: Omit<HistoryQuery, 'provider'>,
): Promise<{ values: HistoryValues; provider: string | undefined } | undefined> {
  let first: { values: HistoryValues; provider: string | undefined } | undefined;
  for (const provider of providers.ids.length > 0 ? providers.ids : [undefined]) {
    const values = await fetchHistoryValues(base, token, { ...query, provider });
    if (!values) continue;
    if (values.rows.some((row) => row.some((cell, i) => i > 0 && cell != null))) {
      return { values, provider };
    }
    first ??= { values, provider };
  }
  return first;
}
