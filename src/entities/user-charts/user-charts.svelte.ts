import { type Bbox4, isBbox4 } from '$shared/geo';
import { cleanBoundedText, hasControlCharacters, isRecord, uuidv4 } from '$shared/lib';
import { readPmtilesMeta, type SignalKChart } from '$shared/map';

const MAX_USER_CHARTS = 1_000;
const MAX_USER_CHART_ID_LENGTH = 512;
export const MAX_USER_CHART_NAME_LENGTH = 256;
export const MAX_USER_CHART_URL_LENGTH = 4_096;
const MAX_USER_CHART_LAYERS = 512;
const MAX_USER_CHART_LAYER_ID_LENGTH = 256;
const MAX_CHART_ZOOM = 30;

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

export function userChartUrlHasQuery(value: string): boolean {
  try {
    return new URL(value).searchParams.size > 0;
  } catch {
    return false;
  }
}

export function userChartUrlForDisplay(value: string): string {
  try {
    const parsed = new URL(value);
    for (const name of new Set(parsed.searchParams.keys())) {
      parsed.searchParams.set(name, 'REDACTED');
    }
    return parsed.toString();
  } catch {
    const queryStart = value.indexOf('?');
    if (queryStart < 0) return value;
    const fragmentStart = value.indexOf('#', queryStart);
    const queryEnd = fragmentStart < 0 ? value.length : fragmentStart;
    const searchParams = new URLSearchParams(value.slice(queryStart + 1, queryEnd));
    for (const name of new Set(searchParams.keys())) {
      searchParams.set(name, 'REDACTED');
    }
    const fragment = fragmentStart < 0 ? '' : value.slice(fragmentStart);
    return `${value.slice(0, queryStart)}?${searchParams.toString()}${fragment}`;
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
  // Older descriptors omit this field. Plain URLs migrate to shared, while every query-bearing URL
  // migrates to local-only because query values may contain private controls or credentials.
  shareWithServer?: boolean;
  // Query-bearing descriptors migrated from releases that automatically synced every URL retain an
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
  const id = cleanBoundedText(value.id, MAX_USER_CHART_ID_LENGTH);
  const name = cleanBoundedText(value.name, MAX_USER_CHART_NAME_LENGTH);
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
      const cleaned = cleanBoundedText(layer, MAX_USER_CHART_LAYER_ID_LENGTH);
      if (!cleaned) return undefined;
      if (!seen.has(cleaned)) layers.push(cleaned);
      seen.add(cleaned);
    }
  }
  const inferredLocalOnly = value.shareWithServer === undefined && userChartUrlHasQuery(url);
  return {
    id,
    name,
    kind: value.kind,
    origin: { type: 'url', url },
    shareWithServer:
      value.shareWithServer === true || value.shareWithServer === false
        ? value.shareWithServer
        : !userChartUrlHasQuery(url),
    ...(value.serverCleanupRequired === true || inferredLocalOnly
      ? { serverCleanupRequired: true }
      : {}),
    ...(value.bounds === undefined ? {} : { bounds: [...value.bounds] as Bbox4 }),
    ...(value.minzoom === undefined ? {} : { minzoom: value.minzoom }),
    ...(value.maxzoom === undefined ? {} : { maxzoom: value.maxzoom }),
    ...(layers === undefined ? {} : { layers }),
  };
}

export function shouldShareUserChart(source: UserChartSource): boolean {
  return source.shareWithServer ?? !userChartUrlHasQuery(source.origin.url);
}

export function userChartNeedsServerDelete(source: UserChartSource): boolean {
  return shouldShareUserChart(source) || source.serverCleanupRequired === true;
}

// A staged import: the resolved descriptor, not yet saved. Staging reads the PMTiles metadata so
// the user can review and rename before save.
export interface DraftChart {
  source: UserChartSource;
}

type UserChartReplaceHandler = (
  previous: UserChartSource,
  replacement: UserChartSource,
) => Promise<void>;
type UserChartTransitionHandler = (previous: UserChartSource, replacement: UserChartSource) => void;

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
  // A replacement first swaps the live overlay through this handler. The local descriptor is
  // committed only after that succeeds, so a failed archive keeps the accepted chart intact.
  #onReplace?: UserChartReplaceHandler;
  // Runs after a replacement or sharing preference is accepted locally. The app translates the
  // old and new descriptors into the final serialized Signal K server intent.
  #onTransition?: UserChartTransitionHandler;

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

  setReplaceHandler(handler: UserChartReplaceHandler): void {
    this.#onReplace = handler;
  }

  setTransitionHandler(handler: UserChartTransitionHandler): void {
    this.#onTransition = handler;
  }

  // Read a remote archive's metadata and stage it as a draft, without saving, so the user can review
  // and rename it before committing.
  async stageUrl(url: string, signal?: AbortSignal): Promise<DraftChart> {
    const safeUrl = normalizeUserChartUrl(url);
    if (!safeUrl) throw new Error('Enter a valid HTTP or HTTPS PMTiles URL.');
    signal?.throwIfAborted();
    let meta: Awaited<ReturnType<typeof readPmtilesMeta>>;
    try {
      meta = await readPmtilesMeta(safeUrl, signal);
    } catch {
      signal?.throwIfAborted();
      // PMTiles transport errors can include the full request URL. Keep query values out of
      // the panel error surface while preserving the specific validation message above.
      throw new Error('Could not read chart metadata.');
    }
    return {
      source: {
        id: uuidv4(),
        name: (meta.name ?? nameFromUrl(safeUrl)).slice(0, MAX_USER_CHART_NAME_LENGTH),
        kind: meta.kind,
        origin: { type: 'url', url: safeUrl },
        shareWithServer: !userChartUrlHasQuery(safeUrl),
        bounds: meta.bounds,
        minzoom: meta.minzoom,
        maxzoom: meta.maxzoom,
        layers: meta.vectorLayers,
      },
    };
  }

  // Read replacement metadata without changing the accepted chart. The chart id and name remain
  // stable. A new query-bearing URL defaults to device-only, while refreshing the same URL keeps
  // the navigator's prior explicit sharing choice.
  async stageReplacement(id: string, url: string, signal?: AbortSignal): Promise<DraftChart> {
    const current = this.sources.find((source) => source.id === id);
    if (!current) throw new Error('That chart is no longer available.');
    const staged = await this.stageUrl(url, signal);
    const sameUrl = staged.source.origin.url === current.origin.url;
    return {
      source: {
        ...staged.source,
        id: current.id,
        name: current.name,
        shareWithServer: sameUrl
          ? shouldShareUserChart(current)
          : shouldShareUserChart(current) && !userChartUrlHasQuery(staged.source.origin.url),
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
    const nextName = cleanBoundedText(name, MAX_USER_CHART_NAME_LENGTH) ?? draft.source.name;
    const source = cleanUserChartSource({ ...draft.source, name: nextName, shareWithServer });
    if (!source) throw new Error('Chart metadata is invalid.');
    this.sources = [...this.sources, source];
    this.#persist(this.sources);
    this.#onAdd?.(source);
  }

  rename(id: string, name: string): void {
    const index = this.sources.findIndex((source) => source.id === id);
    if (index < 0) return;
    const safeName = cleanBoundedText(name, MAX_USER_CHART_NAME_LENGTH);
    if (!safeName) return;
    const renamed = { ...this.sources[index], name: safeName };
    this.sources = this.sources.with(index, renamed);
    this.#persist(this.sources);
    this.#onRename?.(renamed);
  }

  // Atomically accept staged metadata after the live map replacement succeeds. A switch from a
  // shared chart to a device-only chart retains an opaque cleanup obligation until the server
  // confirms its DELETE, without exposing the replacement URL.
  async replace(
    draft: DraftChart,
    shareWithServer = shouldShareUserChart(draft.source),
  ): Promise<void> {
    const previous = this.sources.find((source) => source.id === draft.source.id);
    if (!previous) throw new Error('That chart is no longer available.');
    const replacement = cleanUserChartSource({
      ...draft.source,
      id: previous.id,
      name: previous.name,
      shareWithServer,
      serverCleanupRequired:
        !shareWithServer && userChartNeedsServerDelete(previous) ? true : undefined,
    });
    if (!replacement) throw new Error('Chart metadata is invalid.');
    try {
      await this.#onReplace?.(previous, replacement);
    } catch {
      throw new Error('Could not apply the replacement chart.');
    }
    // A chart can be removed while the replacement resolves, so the position has to be resolved
    // again: an index captured before the await would overwrite an unrelated chart, or throw past
    // the end of a shrunken list.
    const index = this.sources.findIndex((source) => source.id === replacement.id);
    if (index < 0) throw new Error('That chart is no longer available.');
    this.#commitUpdate(index, previous, replacement);
  }

  async setSharing(id: string, shareWithServer: boolean): Promise<void> {
    const index = this.sources.findIndex((source) => source.id === id);
    if (index < 0) throw new Error('That chart is no longer available.');
    const previous = this.sources[index];
    if (shouldShareUserChart(previous) === shareWithServer) return;
    const replacement = cleanUserChartSource({
      ...previous,
      shareWithServer,
      serverCleanupRequired:
        !shareWithServer && userChartNeedsServerDelete(previous) ? true : undefined,
    });
    if (!replacement) throw new Error('Chart metadata is invalid.');
    this.#commitUpdate(index, previous, replacement);
  }

  // Clear an accepted server-cleanup obligation only after the serialized DELETE succeeds. A newer
  // choice to share wins, so a late cleanup completion cannot mark a shared chart as device-only.
  markServerClean(id: string): void {
    const index = this.sources.findIndex((source) => source.id === id);
    if (index < 0) return;
    const current = this.sources[index];
    if (shouldShareUserChart(current) || current.serverCleanupRequired !== true) return;
    const cleaned = cleanUserChartSource({ ...current, serverCleanupRequired: undefined });
    if (!cleaned) return;
    this.sources = this.sources.with(index, cleaned);
    this.#persist(this.sources);
  }

  #commitUpdate(index: number, previous: UserChartSource, replacement: UserChartSource): void {
    this.sources = this.sources.with(index, replacement);
    this.#persist(this.sources);
    this.#onTransition?.(previous, replacement);
  }

  remove(id: string): void {
    const source = this.sources.find((s) => s.id === id);
    if (!source) return;
    this.#onRemove?.(source);
    this.sources = this.sources.filter((s) => s.id !== id);
    this.#persist(this.sources);
  }
}
