import { type Header, PMTiles, type Source, TileType } from 'pmtiles';
import { hasControlCharacters, isRecord } from '$shared/lib';
import { createArchiveSource } from './pmtiles';

export interface PmtilesMeta {
  name?: string;
  kind: 'vector' | 'raster';
  bounds?: [number, number, number, number]; // [west, south, east, north] WGS84 degrees
  minzoom: number;
  maxzoom: number;
  vectorLayers?: string[]; // source-layer ids, for a vector archive (from metadata vector_layers)
}

const MAX_NAME_LENGTH = 256;
const MAX_VECTOR_LAYERS = 512;
const MAX_LAYER_ID_LENGTH = 256;

// The pmtiles header decodes its packed int32 lon/lat fields by dividing by 1e7, so the
// Header's minLon/minLat/maxLon/maxLat are already WGS84 decimal degrees (see bytesToHeader
// in the pmtiles source). They map straight onto [west, south, east, north].
function boundsFromHeader(header: Header): [number, number, number, number] | undefined {
  const { minLon, minLat, maxLon, maxLat } = header;
  if (![minLon, minLat, maxLon, maxLat].every(Number.isFinite)) return undefined;
  if (minLon < -180 || minLon > 180 || maxLon < -180 || maxLon > 180) return undefined;
  if (minLat < -90 || maxLat > 90 || minLat >= maxLat || minLon === maxLon) return undefined;
  return [minLon, minLat, maxLon, maxLat];
}

function vectorLayerIds(metadata: unknown): string[] | undefined {
  if (!isRecord(metadata)) return undefined;
  const raw = metadata.vector_layers;
  if (!Array.isArray(raw)) return undefined;
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const id = (entry as { id?: unknown } | null)?.id;
    if (typeof id !== 'string') continue;
    const trimmed = id.trim();
    if (
      !trimmed ||
      trimmed.length > MAX_LAYER_ID_LENGTH ||
      hasControlCharacters(trimmed) ||
      seen.has(trimmed)
    ) {
      continue;
    }
    seen.add(trimmed);
    ids.push(trimmed);
    if (ids.length >= MAX_VECTOR_LAYERS) break;
  }
  return ids.length > 0 ? ids : undefined;
}

function nameFrom(metadata: unknown): string | undefined {
  if (!isRecord(metadata)) return undefined;
  const name = metadata.name;
  if (typeof name !== 'string') return undefined;
  const trimmed = name.trim();
  return trimmed && trimmed.length <= MAX_NAME_LENGTH && !hasControlCharacters(trimmed)
    ? trimmed
    : undefined;
}

function safeZoom(value: number, fallback: number): number {
  return Number.isInteger(value) && value >= 0 && value <= 30 ? value : fallback;
}

// Pure mapping from a decoded header and its (arbitrary JSON) metadata onto PmtilesMeta.
// Separated from the I/O so it can be tested without a binary archive fixture.
export function mapPmtilesMeta(header: Header, metadata: unknown): PmtilesMeta {
  const minzoom = safeZoom(header.minZoom, 0);
  const maxzoom = Math.max(minzoom, safeZoom(header.maxZoom, minzoom));
  return {
    name: nameFrom(metadata),
    // Mvt and Mlt are vector tile formats; Png, Jpeg, Webp, and Avif are raster.
    kind:
      header.tileType === TileType.Mvt || header.tileType === TileType.Mlt ? 'vector' : 'raster',
    bounds: boundsFromHeader(header),
    minzoom,
    maxzoom,
    vectorLayers: vectorLayerIds(metadata),
  };
}

// Read a PMTiles archive header and metadata from a remote URL through the same block-cached,
// retrying archive source the map tiles use, so the header and metadata range reads are cached in
// IndexedDB: re-probing the same URL, and the first render once the chart is registered, hit the
// cache instead of refetching. A blob: URL is local bytes, so createArchiveSource skips the cache.
function sourceWithSignal(source: Source, signal: AbortSignal | undefined): Source {
  if (!signal) return source;
  return {
    getKey: () => source.getKey(),
    getBytes: (offset, length, _requestSignal, etag) =>
      source.getBytes(offset, length, signal, etag),
  };
}

export async function readPmtilesMeta(url: string, signal?: AbortSignal): Promise<PmtilesMeta> {
  signal?.throwIfAborted();
  const pm = new PMTiles(sourceWithSignal(createArchiveSource(url), signal));
  const header = await pm.getHeader();
  signal?.throwIfAborted();
  // Metadata is optional convenience data (name, vector_layers); a malformed or absent
  // metadata block must not sink an otherwise-readable archive.
  let metadata: unknown;
  try {
    metadata = await pm.getMetadata();
  } catch {
    signal?.throwIfAborted();
    metadata = undefined;
  }
  signal?.throwIfAborted();
  return mapPmtilesMeta(header, metadata);
}
