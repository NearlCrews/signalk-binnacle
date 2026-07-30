import { type Bbox4, isBbox4 } from '$shared/geo';
import { hasControlCharacters, isFiniteNumber, isRecord } from '$shared/lib';
import type { SignalKChart } from '$shared/map';
import { deleteResource, fetchKeyedResource, putResource } from '$shared/signalk';

const V2 = '/signalk/v2/api/resources/charts';
const V1 = '/signalk/v1/api/resources/charts';
const MAX_CHARTS = 1_000;
const MAX_ID_LENGTH = 512;
const MAX_NAME_LENGTH = 256;
const MAX_DESCRIPTION_LENGTH = 2_048;
const MAX_URL_LENGTH = 4_096;
const MAX_LAYERS = 512;
const MAX_LAYER_ID_LENGTH = 256;
const CHART_TYPES = new Set(['tilelayer', 'WMS', 'WMTS', 'tileJSON', 'mapstyleJSON', 'S-57']);

function cleanString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength || hasControlCharacters(trimmed)) return undefined;
  return trimmed;
}

function safeBounds(value: unknown): Bbox4 | undefined {
  if (!isBbox4(value)) return undefined;
  const [west, south, east, north] = value;
  if (west < -180 || west > 180 || east < -180 || east > 180) return undefined;
  if (south < -90 || north > 90 || south > north) return undefined;
  return value;
}

function safeZoom(value: unknown): number | undefined {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 30
    ? (value as number)
    : undefined;
}

// Validate a keyed chart entry before it becomes a layer, the way notes and symbols are validated.
// The resource key is the canonical identifier because it names the REST resource and is unique
// within the collection. An embedded identifier is provider metadata and cannot replace that key.
function chartFromEntry(id: string, raw: unknown): SignalKChart | undefined {
  if (!isRecord(raw)) return undefined;
  const identifier = cleanString(id, MAX_ID_LENGTH);
  const embeddedIdentifier =
    raw.identifier === undefined ? undefined : cleanString(raw.identifier, MAX_ID_LENGTH);
  const name = cleanString(raw.name, MAX_NAME_LENGTH);
  const type = cleanString(raw.type, 32);
  if (
    !identifier ||
    (raw.identifier !== undefined && !embeddedIdentifier) ||
    !name ||
    !type ||
    !CHART_TYPES.has(type)
  ) {
    return undefined;
  }
  const chart: SignalKChart = { identifier, name, type: type as SignalKChart['type'] };
  const description = cleanString(raw.description, MAX_DESCRIPTION_LENGTH);
  if (description) chart.description = description;
  const bounds = safeBounds(raw.bounds);
  if (bounds) chart.bounds = bounds;
  const minzoom = safeZoom(raw.minzoom);
  const maxzoom = safeZoom(raw.maxzoom);
  if (minzoom !== undefined) chart.minzoom = minzoom;
  if (maxzoom !== undefined && (minzoom === undefined || maxzoom >= minzoom)) {
    chart.maxzoom = maxzoom;
  }
  const format = cleanString(raw.format, 64);
  const url = cleanString(raw.url, MAX_URL_LENGTH);
  const tilemapUrl = cleanString(raw.tilemapUrl, MAX_URL_LENGTH);
  if (format) chart.format = format;
  if (url) chart.url = url;
  if (tilemapUrl) chart.tilemapUrl = tilemapUrl;
  if (isFiniteNumber(raw.scale) && raw.scale > 0) chart.scale = raw.scale;
  if (Array.isArray(raw.layers) && raw.layers.length <= MAX_LAYERS) {
    const layers = raw.layers
      .map((layer) => cleanString(layer, MAX_LAYER_ID_LENGTH))
      .filter((layer): layer is string => layer !== undefined);
    if (layers.length > 0) chart.layers = layers;
  }
  return chart;
}

// Returns undefined when every endpoint is unreachable (so a caller can keep an existing list rather
// than blank it on a transient failure, matching fetchRoutes and fetchNotes), and [] for a reachable
// server with no charts. A reachable error status is surfaced via onError rather than swallowed.
export function fetchCharts(
  serverBase: string,
  token?: string,
): Promise<SignalKChart[] | undefined> {
  let accepted = 0;
  return fetchKeyedResource<SignalKChart>(
    serverBase,
    [V2, V1],
    token,
    (id, raw) => {
      if (accepted >= MAX_CHARTS) return undefined;
      const chart = chartFromEntry(id, raw);
      if (chart) accepted += 1;
      return chart;
    },
    (url, status) => console.warn(`[charts] ${url} returned ${status}`),
  );
}

// Register a chart as a v2 resource on the server so other Signal K clients and devices discover it.
// Used for URL-backed user charts (a file-backed chart's bytes cannot be hosted on a stock server).
// Returns whether the write succeeded; never throws, so a failed sync leaves the chart local-only.
export function putChart(
  serverBase: string,
  token: string | undefined,
  chart: SignalKChart,
): Promise<boolean> {
  return putResource(`${serverBase}${V2}/${encodeURIComponent(chart.identifier)}`, token, chart);
}

// Remove a server-registered chart resource. Best-effort: a 404 (it was never synced) is reported as
// a non-success but is harmless.
export function deleteChart(
  serverBase: string,
  token: string | undefined,
  identifier: string,
): Promise<boolean> {
  return deleteResource(`${serverBase}${V2}/${encodeURIComponent(identifier)}`, token);
}
