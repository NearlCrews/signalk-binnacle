import { type Bbox4, isBbox4 } from '$shared/geo';
import { hasControlCharacters, isRecord, uuidv4 } from '$shared/lib';
import { readPmtilesMeta, type SignalKChart } from '$shared/map';

export const MAX_USER_CHARTS = 1_000;
export const MAX_USER_CHART_ID_LENGTH = 512;
export const MAX_USER_CHART_NAME_LENGTH = 256;
export const MAX_USER_CHART_URL_LENGTH = 4_096;
export const MAX_USER_CHART_LAYERS = 512;
export const MAX_USER_CHART_LAYER_ID_LENGTH = 256;
const MAX_CHART_ZOOM = 30;

function cleanText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength || hasControlCharacters(trimmed)) return undefined;
  return trimmed;
}

export function normalizeUserChartUrl(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_USER_CHART_URL_LENGTH || hasControlCharacters(trimmed)) {
    return undefined;
  }
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : undefined;
  } catch {
    return undefined;
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
export function isUserChartSource(value: unknown): value is UserChartSource {
  if (!isRecord(value)) return false;
  if (!cleanText(value.id, MAX_USER_CHART_ID_LENGTH)) return false;
  if (!cleanText(value.name, MAX_USER_CHART_NAME_LENGTH)) return false;
  if (value.kind !== 'vector' && value.kind !== 'raster') return false;
  const origin = value.origin;
  if (!isRecord(origin)) return false;
  if (origin.type !== 'url' || typeof origin.url !== 'string') return false;
  if (!normalizeUserChartUrl(origin.url)) return false;
  if (value.bounds !== undefined && !validBounds(value.bounds)) return false;
  if (value.minzoom !== undefined && !validZoom(value.minzoom)) return false;
  if (value.maxzoom !== undefined && !validZoom(value.maxzoom)) return false;
  if (
    value.minzoom !== undefined &&
    value.maxzoom !== undefined &&
    (value.minzoom as number) > (value.maxzoom as number)
  ) {
    return false;
  }
  if (value.layers !== undefined) {
    if (!Array.isArray(value.layers) || value.layers.length > MAX_USER_CHART_LAYERS) return false;
    if (!value.layers.every((layer) => cleanText(layer, MAX_USER_CHART_LAYER_ID_LENGTH))) {
      return false;
    }
  }
  return true;
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
      .filter(isUserChartSource)
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
    const meta = await readPmtilesMeta(safeUrl);
    return {
      source: {
        id: uuidv4(),
        name: (meta.name ?? nameFromUrl(safeUrl)).slice(0, MAX_USER_CHART_NAME_LENGTH),
        kind: meta.kind,
        origin: { type: 'url', url: safeUrl },
        bounds: meta.bounds,
        minzoom: meta.minzoom,
        maxzoom: meta.maxzoom,
        layers: meta.vectorLayers,
      },
    };
  }

  // Save a staged draft with the reviewed name, which fires onAdd so the map flies to the new chart.
  commit(draft: DraftChart, name: string): void {
    if (this.sources.length >= MAX_USER_CHARTS) throw new Error('Chart limit reached.');
    if (this.sources.some((source) => source.id === draft.source.id)) {
      throw new Error('That chart is already saved.');
    }
    const nextName = cleanText(name, MAX_USER_CHART_NAME_LENGTH) ?? draft.source.name;
    const source: UserChartSource = { ...draft.source, name: nextName };
    if (!isUserChartSource(source)) throw new Error('Chart metadata is invalid.');
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
