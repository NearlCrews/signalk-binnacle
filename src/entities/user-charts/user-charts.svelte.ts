import { type Bbox4, isBbox4 } from '$shared/geo';
import { hasControlCharacters, isRecord, uuidv4 } from '$shared/lib';
import { readPmtilesMeta, type SignalKChart } from '$shared/map';

const MAX_USER_CHARTS = 1_000;
const MAX_USER_CHART_ID_LENGTH = 512;
export const MAX_USER_CHART_NAME_LENGTH = 256;
export const MAX_USER_CHART_URL_LENGTH = 4_096;
const MAX_USER_CHART_LAYERS = 512;
const MAX_USER_CHART_LAYER_ID_LENGTH = 256;
const MAX_CHART_ZOOM = 30;

function cleanText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength || hasControlCharacters(trimmed)) return undefined;
  return trimmed;
}

function normalizeUserChartUrl(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_USER_CHART_URL_LENGTH || hasControlCharacters(trimmed)) {
    return undefined;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
    // Credentials in URL authority are easy to disclose through logs, history, and server sync.
    // Query credentials are handled separately because signed PMTiles URLs commonly require them.
    if (parsed.username || parsed.password) return undefined;
    // Fragments are never sent in the range request, so retaining one only creates multiple stored
    // descriptors for the same archive and risks persisting client-side secrets unnecessarily.
    parsed.hash = '';
    return parsed.href;
  } catch {
    return undefined;
  }
}

const CREDENTIAL_QUERY_NAMES = new Set([
  'apiaccesskey',
  'auth',
  'authorization',
  'xamzsecuritytoken',
]);
const CREDENTIAL_QUERY_NAME_PATTERN =
  /^(?:(?:api|access|auth|bearer|client|private|public|session|secret|security|signing|xamz|xgoog))?(?:token|key|password|passwd|pwd|secret|signature|sig|credential|credentials)$/;

function isCredentialQueryName(name: string): boolean {
  const normalized = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  return CREDENTIAL_QUERY_NAMES.has(normalized) || CREDENTIAL_QUERY_NAME_PATTERN.test(normalized);
}

// Signed archive URLs remain supported, but their query parameter names make server sharing an
// explicit opt-in. Values are never inspected or surfaced because they may themselves be secrets.
export function userChartUrlHasCredentialQuery(value: string): boolean {
  try {
    const parsed = new URL(value);
    for (const name of parsed.searchParams.keys()) {
      if (isCredentialQueryName(name)) return true;
    }
  } catch {
    // Invalid URLs are rejected by normalization. They do not need a separate privacy result.
  }
  return false;
}

export function userChartUrlForDisplay(value: string): string {
  try {
    const parsed = new URL(value);
    const sensitiveNames = new Set([...parsed.searchParams.keys()].filter(isCredentialQueryName));
    for (const name of sensitiveNames) parsed.searchParams.set(name, 'REDACTED');
    return parsed.toString();
  } catch {
    return value;
  }
}

function validZoom(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= MAX_CHART_ZOOM;
}

function validBounds(value: unknown): value is Bbox4 {
  if (!isBbox4(value)) return false;
  const [west, south, east, north] = value;
  return (
    west >= -180 &&
    west <= 180 &&
    east >= -180 &&
    east <= 180 &&
    south >= -90 &&
    north <= 90 &&
    south <= north
  );
}

// A chart the user imported by URL, persisted as a descriptor pointing at a remote archive. Both
// vector and raster archives are supported. Local .pmtiles files are served by the
// signalk-pmtiles-plugin as ordinary chart resources, so there is no browser-local file origin.
export interface UserChartSource {
  id: string;
  name: string;
  kind: 'vector' | 'raster';
  origin: { type: 'url'; url: string };
  // Older descriptors omit this field. They migrate to shared for ordinary URLs and local-only for
  // URLs with credential-like query names, preserving discovery without disclosing likely secrets.
  shareWithServer?: boolean;
  // Signed descriptors migrated from releases that automatically synced every URL can retain an
  // opaque server-cleanup obligation without sending their URL again.
  serverCleanupRequired?: boolean;
  bounds?: Bbox4;
  minzoom?: number;
  maxzoom?: number;
  layers?: string[];
}

// Guards a persisted chart descriptor against schema drift across releases: a renamed or removed
// field would otherwise flow in as undefined and surface deep in rendering (or as a NaN passed to
// fitBounds). A descriptor that fails the guard is dropped at load rather than trusted. Rejecting
// non-url origins here also silently drops the browser-local file charts of older builds, whose
// blobs no longer have a store.
export function cleanUserChartSource(value: unknown): UserChartSource | undefined {
  if (!isRecord(value)) return undefined;
  const id = cleanText(value.id, MAX_USER_CHART_ID_LENGTH);
  const name = cleanText(value.name, MAX_USER_CHART_NAME_LENGTH);
  if (!id || !name) return undefined;
  if (value.kind !== 'vector' && value.kind !== 'raster') return undefined;
  const origin = value.origin;
  if (!isRecord(origin)) return undefined;
  if (origin.type !== 'url' || typeof origin.url !== 'string') return undefined;
  const url = normalizeUserChartUrl(origin.url);
  if (!url) return undefined;
  if (value.shareWithServer !== undefined && typeof value.shareWithServer !== 'boolean') {
    return undefined;
  }
  if (
    value.serverCleanupRequired !== undefined &&
    typeof value.serverCleanupRequired !== 'boolean'
  ) {
    return undefined;
  }
  if (value.bounds !== undefined && !validBounds(value.bounds)) return undefined;
  if (value.minzoom !== undefined && !validZoom(value.minzoom)) return undefined;
  if (value.maxzoom !== undefined && !validZoom(value.maxzoom)) return undefined;
  if (
    value.minzoom !== undefined &&
    value.maxzoom !== undefined &&
    (value.minzoom as number) > (value.maxzoom as number)
  ) {
    return undefined;
  }
  let layers: string[] | undefined;
  if (value.layers !== undefined) {
    if (!Array.isArray(value.layers) || value.layers.length > MAX_USER_CHART_LAYERS)
      return undefined;
    const seen = new Set<string>();
    layers = [];
    for (const layer of value.layers) {
      const cleaned = cleanText(layer, MAX_USER_CHART_LAYER_ID_LENGTH);
      if (!cleaned) return undefined;
      if (!seen.has(cleaned)) layers.push(cleaned);
      seen.add(cleaned);
    }
  }
  const inferredLocalOnly =
    value.shareWithServer === undefined && userChartUrlHasCredentialQuery(url);
  return {
    id,
    name,
    kind: value.kind,
    origin: { type: 'url', url },
    shareWithServer:
      value.shareWithServer === true || value.shareWithServer === false
        ? value.shareWithServer
        : !userChartUrlHasCredentialQuery(url),
    ...(value.serverCleanupRequired === true || inferredLocalOnly
      ? { serverCleanupRequired: true }
      : {}),
    ...(value.bounds === undefined ? {} : { bounds: [...value.bounds] as Bbox4 }),
    ...(value.minzoom === undefined ? {} : { minzoom: value.minzoom }),
    ...(value.maxzoom === undefined ? {} : { maxzoom: value.maxzoom }),
    ...(layers === undefined ? {} : { layers }),
  };
}

export function isUserChartSource(value: unknown): value is UserChartSource {
  return cleanUserChartSource(value) !== undefined;
}

export function shouldShareUserChart(source: UserChartSource): boolean {
  return source.shareWithServer ?? !userChartUrlHasCredentialQuery(source.origin.url);
}

export function userChartNeedsServerDelete(source: UserChartSource): boolean {
  return shouldShareUserChart(source) || source.serverCleanupRequired === true;
}

// A staged import: the resolved descriptor, not yet saved. Staging reads the PMTiles metadata so
// the user can review and rename before save.
export interface DraftChart {
  source: UserChartSource;
}

// Build the SignalKChart the existing chart overlay renders, with the tile url already resolved to
// a remote .pmtiles URL.
export function userChartToSignalK(source: UserChartSource, url: string): SignalKChart {
  const vector = source.kind !== 'raster';
  const chart: SignalKChart = {
    identifier: source.id,
    name: source.name,
    type: vector ? 'tileJSON' : 'tilelayer',
    format: vector ? 'mvt' : 'png',
    url,
  };
  if (source.bounds) chart.bounds = source.bounds;
  if (source.minzoom !== undefined) chart.minzoom = source.minzoom;
  if (source.maxzoom !== undefined) chart.maxzoom = source.maxzoom;
  if (source.layers) chart.layers = source.layers;
  return chart;
}

// The chart's zoom span as a "min to max" string for the spec readouts, with sensible fallbacks when
// a bound is missing (a chart may declare only a min). Shared by the import-review and detail panels.
export function zoomRange(source: UserChartSource): string {
  return `${source.minzoom ?? 0} to ${source.maxzoom ?? source.minzoom ?? 0}`;
}

function nameFromUrl(url: string): string {
  try {
    const path = new URL(url).pathname;
    const file = path.slice(path.lastIndexOf('/') + 1);
    return file.replace(/\.pmtiles$/i, '') || url;
  } catch {
    return url;
  }
}

export class UserCharts {
  sources = $state<UserChartSource[]>([]);

  #persist: (sources: UserChartSource[]) => void;
  // Fires only when the user commits an imported chart, never for the persisted set restored at
  // startup, so the app can fly the map to a freshly imported chart and sync it to the server.
  #onAdd?: (source: UserChartSource) => void;
  // Fires when a chart is removed, so the app can also delete its server-registered resource. Runs
  // before the local descriptor is dropped, so the source is still available to the handler.
  #onRemove?: (source: UserChartSource) => void;
  // Fires with the updated descriptor after a rename, so the app can re-register the overlay
  // under the new title and re-put the server-synced chart's resource.
  #onRename?: (source: UserChartSource) => void;

  constructor(
    persisted: UserChartSource[],
    persist: (sources: UserChartSource[]) => void,
    onAdd?: (source: UserChartSource) => void,
    onRemove?: (source: UserChartSource) => void,
    onRename?: (source: UserChartSource) => void,
  ) {
    // Drop any persisted descriptor that no longer matches the schema, so a drifted entry from an
    // older build cannot flow in as a partly-undefined source. This also drops the file-origin
    // charts of older builds, whose browser-local blobs are gone with the file import path.
    const ids = new Set<string>();
    this.sources = persisted
      .map(cleanUserChartSource)
      .filter((source): source is UserChartSource => source !== undefined)
      .filter((source) => {
        if (ids.has(source.id)) return false;
        ids.add(source.id);
        return true;
      })
      .slice(0, MAX_USER_CHARTS);
    this.#persist = persist;
    this.#onAdd = onAdd;
    this.#onRemove = onRemove;
    this.#onRename = onRename;
  }

  // Read a remote archive's metadata and stage it as a draft, without saving, so the user can review
  // and rename it before committing.
  async stageUrl(url: string): Promise<DraftChart> {
    const safeUrl = normalizeUserChartUrl(url);
    if (!safeUrl) throw new Error('Enter a valid HTTP or HTTPS PMTiles URL.');
    let meta: Awaited<ReturnType<typeof readPmtilesMeta>>;
    try {
      meta = await readPmtilesMeta(safeUrl);
    } catch {
      // PMTiles transport errors can include the full request URL. Keep signed query values out of
      // the panel error surface while preserving the specific validation message above.
      throw new Error('Could not read chart metadata.');
    }
    return {
      source: {
        id: uuidv4(),
        name: (meta.name ?? nameFromUrl(safeUrl)).slice(0, MAX_USER_CHART_NAME_LENGTH),
        kind: meta.kind,
        origin: { type: 'url', url: safeUrl },
        shareWithServer: !userChartUrlHasCredentialQuery(safeUrl),
        bounds: meta.bounds,
        minzoom: meta.minzoom,
        maxzoom: meta.maxzoom,
        layers: meta.vectorLayers,
      },
    };
  }

  // Save a staged draft with the reviewed name, which fires onAdd so the map flies to the new chart.
  commit(
    draft: DraftChart,
    name: string,
    shareWithServer = shouldShareUserChart(draft.source),
  ): void {
    if (this.sources.length >= MAX_USER_CHARTS) throw new Error('Chart limit reached.');
    if (this.sources.some((source) => source.id === draft.source.id)) {
      throw new Error('That chart is already saved.');
    }
    const nextName = cleanText(name, MAX_USER_CHART_NAME_LENGTH) ?? draft.source.name;
    const source = cleanUserChartSource({ ...draft.source, name: nextName, shareWithServer });
    if (!source) throw new Error('Chart metadata is invalid.');
    this.sources = [...this.sources, source];
    this.#persist(this.sources);
    this.#onAdd?.(source);
  }

  rename(id: string, name: string): void {
    const index = this.sources.findIndex((source) => source.id === id);
    if (index < 0) return;
    const safeName = cleanText(name, MAX_USER_CHART_NAME_LENGTH);
    if (!safeName) return;
    const renamed = { ...this.sources[index], name: safeName };
    this.sources = this.sources.with(index, renamed);
    this.#persist(this.sources);
    this.#onRename?.(renamed);
  }

  remove(id: string): void {
    const source = this.sources.find((s) => s.id === id);
    if (!source) return;
    this.#onRemove?.(source);
    this.sources = this.sources.filter((s) => s.id !== id);
    this.#persist(this.sources);
  }
}
