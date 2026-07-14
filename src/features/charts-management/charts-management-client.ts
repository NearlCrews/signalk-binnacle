/** Talks to the companion chart-management routes. They use Signal K's administrator middleware, so
 * requests carry the browser's admin session and never Binnacle's device bearer token.
 * Never throws: a failed read returns undefined so the panel keeps its last list. */

import { companionApiUrl } from '$shared/companion';
import { isLatitude, isLongitude } from '$shared/geo';
import { hasControlCharacters, isFiniteNumber, isRecord, withTimeout } from '$shared/lib';
import { adminSessionInit } from '$shared/signalk';

const MAX_MANAGED_CHARTS = 5_000;
const MAX_INVALID_CHARTS = 5_000;
const MAX_ID_LENGTH = 512;
const MAX_FILE_NAME_LENGTH = 1_024;
const MAX_TEXT_LENGTH = 4_096;

export interface ManagedChart {
  identifier: string;
  fileName: string;
  name: string;
  description: string;
  scale: number;
  bounds?: [number, number, number, number];
  minzoom: number;
  maxzoom: number;
  format: string;
  override: { name?: string; description?: string; scale?: number };
}

export interface ManagedChartsResponse {
  charts: ManagedChart[];
  invalid: Array<{ fileName: string; error: string }>;
}

function boundedString(value: unknown, maxLength: number, allowEmpty = false): string | undefined {
  if (typeof value !== 'string' || value.length > maxLength || hasControlCharacters(value)) {
    return undefined;
  }
  return allowEmpty || value.length > 0 ? value : undefined;
}

function parseBounds(value: unknown): [number, number, number, number] | undefined {
  if (!Array.isArray(value) || value.length !== 4) return undefined;
  const [west, south, east, north] = value;
  return isLongitude(west) &&
    isLatitude(south) &&
    isLongitude(east) &&
    isLatitude(north) &&
    south <= north
    ? [west, south, east, north]
    : undefined;
}

function parseOverride(value: unknown): ManagedChart['override'] {
  if (!isRecord(value)) return {};
  const name = boundedString(value.name, MAX_TEXT_LENGTH, true);
  const description = boundedString(value.description, MAX_TEXT_LENGTH, true);
  const scale = isFiniteNumber(value.scale) && value.scale > 0 ? value.scale : undefined;
  return {
    ...(name !== undefined ? { name } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(scale !== undefined ? { scale } : {}),
  };
}

function parseManagedChart(value: unknown): ManagedChart | undefined {
  if (!isRecord(value)) return undefined;
  const identifier = boundedString(value.identifier, MAX_ID_LENGTH);
  const fileName = boundedString(value.fileName, MAX_FILE_NAME_LENGTH);
  const name = boundedString(value.name, MAX_TEXT_LENGTH, true);
  const description = boundedString(value.description, MAX_TEXT_LENGTH, true);
  const format = boundedString(value.format, 64);
  const scale = value.scale;
  const minzoom = value.minzoom;
  const maxzoom = value.maxzoom;
  if (
    identifier === undefined ||
    fileName === undefined ||
    name === undefined ||
    description === undefined ||
    format === undefined ||
    !isFiniteNumber(scale) ||
    scale <= 0 ||
    !Number.isInteger(minzoom) ||
    !Number.isInteger(maxzoom) ||
    (minzoom as number) < 0 ||
    (maxzoom as number) > 24 ||
    (minzoom as number) > (maxzoom as number)
  ) {
    return undefined;
  }
  const bounds = value.bounds === undefined ? undefined : parseBounds(value.bounds);
  if (value.bounds !== undefined && bounds === undefined) return undefined;
  return {
    identifier,
    fileName,
    name,
    description,
    scale,
    minzoom: minzoom as number,
    maxzoom: maxzoom as number,
    format,
    ...(bounds ? { bounds } : {}),
    override: parseOverride(value.override),
  };
}

export function parseManagedChartsResponse(value: unknown): ManagedChartsResponse | undefined {
  if (!isRecord(value) || !Array.isArray(value.charts) || !Array.isArray(value.invalid)) {
    return undefined;
  }
  if (value.charts.length > MAX_MANAGED_CHARTS || value.invalid.length > MAX_INVALID_CHARTS) {
    return undefined;
  }
  const charts: ManagedChart[] = [];
  for (const raw of value.charts) {
    const chart = parseManagedChart(raw);
    if (!chart) return undefined;
    charts.push(chart);
  }
  const invalid: ManagedChartsResponse['invalid'] = [];
  for (const raw of value.invalid) {
    if (!isRecord(raw)) return undefined;
    const fileName = boundedString(raw.fileName, MAX_FILE_NAME_LENGTH);
    const error = boundedString(raw.error, MAX_TEXT_LENGTH);
    if (!fileName || !error) return undefined;
    invalid.push({ fileName, error });
  }
  return { charts, invalid };
}

export async function fetchManagedCharts(
  origin: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ManagedChartsResponse | undefined> {
  try {
    const response = await fetchImpl(
      companionApiUrl(origin, '/charts'),
      withTimeout(adminSessionInit()),
    );
    if (!response.ok) return undefined;
    return parseManagedChartsResponse(await response.json());
  } catch {
    return undefined;
  }
}

export async function putChartOverride(
  origin: string,
  id: string,
  override: { name?: string; description?: string; scale?: number },
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const response = await fetchImpl(
      companionApiUrl(origin, `/charts/${encodeURIComponent(id)}/override`),
      withTimeout(
        adminSessionInit({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(override),
        }),
      ),
    );
    return response.ok;
  } catch {
    return false;
  }
}
