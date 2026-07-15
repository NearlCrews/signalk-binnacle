import * as maplibregl from 'maplibre-gl';
import { PMTiles, Protocol, type RangeResponse, type Source } from 'pmtiles';
import { isAbort } from './abort';
import { BlockCachedSource, type BlockStore, createBlockStore } from './pmtiles-block-cache';

let protocol: Protocol | undefined;

// Range reads are retried because the archive bypasses the HTTP cache (cache: 'no-store',
// see below), so a block-cache miss depends on a live range read. Over a real network a
// transient drop or a server hiccup under a burst of reads (e.g. a zoom that pulls in new
// tiles) would otherwise blank that tile until a later zoom re-requests it. A caller abort
// is not retried: MapLibre aborts in-flight tiles on view change by design.
const MAX_RETRIES = 2;
const RETRY_BACKOFF_MS = [200, 500];

interface ValidatedRange {
  data: ArrayBuffer;
  validator?: string;
  cacheControl?: string;
  expires?: string;
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<ArrayBuffer> {
  if (!response.body) return response.arrayBuffer();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error('PMTiles server returned more bytes than requested.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const data = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return data.buffer;
}

function parseContentRange(value: string | null): { start: number; end: number; total?: number } {
  const match = value?.match(/^bytes (\d+)-(\d+)\/(\d+|\*)$/i);
  if (!match) throw new Error('PMTiles range response is missing a valid Content-Range header.');
  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = match[3] === '*' ? undefined : Number(match[3]);
  if (end < start || (total !== undefined && (total <= end || total <= 0))) {
    throw new Error('PMTiles range response has inconsistent bounds.');
  }
  return { start, end, total };
}

async function validateRangeResponse(
  response: Response,
  offset: number,
  length: number,
): Promise<ValidatedRange> {
  let declaredLength: number | undefined;
  let total: number | undefined;
  if (response.status === 206) {
    const range = parseContentRange(response.headers.get('Content-Range'));
    declaredLength = range.end - range.start + 1;
    const shortBeforeEnd =
      declaredLength < length && (range.total === undefined || range.end + 1 !== range.total);
    if (range.start !== offset || declaredLength > length || shortBeforeEnd) {
      throw new Error('PMTiles server returned bytes outside the requested range.');
    }
    total = range.total;
  } else if (response.status === 200) {
    // A 200 is only valid when the request started at zero and the complete archive fits inside the
    // requested span. Accepting a larger body would mean the server ignored Range and could pull an
    // entire multi-gigabyte archive into memory.
    if (offset !== 0) {
      throw new Error('PMTiles server ignored the requested byte range.');
    }
  } else {
    throw new Error(`PMTiles fetch returned unexpected status ${response.status}.`);
  }

  const contentLengthHeader = response.headers.get('Content-Length');
  const contentLength = contentLengthHeader === null ? undefined : Number(contentLengthHeader);
  if (contentLength !== undefined && (!Number.isSafeInteger(contentLength) || contentLength < 0)) {
    throw new Error('PMTiles server declared an invalid response length.');
  }
  if (
    contentLength !== undefined &&
    (contentLength > length || (declaredLength !== undefined && contentLength !== declaredLength))
  ) {
    throw new Error('PMTiles server declared bytes outside the requested range.');
  }
  const data = await readBoundedBody(response, length);
  if (
    data.byteLength > length ||
    (declaredLength !== undefined && data.byteLength !== declaredLength)
  ) {
    throw new Error('PMTiles server returned bytes outside the requested range.');
  }
  total ??= data.byteLength;

  let validator = response.headers.get('ETag') ?? undefined;
  if (validator?.startsWith('W/')) validator = undefined;
  if (!validator) {
    const modified = response.headers.get('Last-Modified');
    if (modified && total !== undefined) validator = `binnacle:${modified}:${total}`;
  }
  return {
    data,
    validator,
    cacheControl: response.headers.get('Cache-Control') ?? undefined,
    expires: response.headers.get('Expires') ?? undefined,
  };
}

// A PMTiles source that fetches ranges with `cache: 'no-store'`. A large PMTiles
// archive served with a weak ETag over range requests makes Chrome fail the HTTP
// disk-cache write (ERR_CACHE_WRITE_FAILURE), which rejects the whole fetch and blanks
// the chart. Bypassing the HTTP cache for these range reads avoids that. The service
// worker can never cache them either (range reads answer 206, which the Cache API
// refuses to store), so durable caching is the IndexedDB block cache that wraps this
// source (pmtiles-block-cache.ts). Exported for testing the retry behavior.
export class NoStoreSource implements Source {
  // The protocol keys instances by getKey(). Both of its lookup paths use the bare http
  // url: the TileJSON request strips the pmtiles:// scheme, and the tile-request regex
  // captures the url without the scheme. So the key is the bare url.
  #url: string;

  constructor(httpUrl: string) {
    this.#url = httpUrl;
  }

  getKey(): string {
    return this.#url;
  }

  async getBytes(offset: number, length: number, signal?: AbortSignal): Promise<RangeResponse> {
    const headers = { Range: `bytes=${offset}-${offset + length - 1}` };
    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await fetch(this.#url, { signal, cache: 'no-store', headers });
      } catch (error) {
        // A network error is transient and retryable; a caller abort is not.
        if (isAbort(error, signal) || attempt >= MAX_RETRIES) throw error;
        await this.#backoff(attempt, signal);
        continue;
      }
      if (response.status === 200 || response.status === 206) {
        const validated = await validateRangeResponse(response, offset, length);
        return {
          data: validated.data,
          etag: validated.validator,
          cacheControl: validated.cacheControl,
          expires: validated.expires,
        };
      }
      // 5xx is a transient server condition worth retrying; any other error status will not.
      if (response.status >= 500 && attempt < MAX_RETRIES) {
        await this.#backoff(attempt, signal);
        continue;
      }
      throw new Error(`PMTiles fetch failed: ${response.status} for ${this.#url}`);
    }
  }

  #backoff(attempt: number, signal?: AbortSignal): Promise<void> {
    const ms = RETRY_BACKOFF_MS[attempt] ?? RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1];
    return new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          reject(new DOMException('Aborted', 'AbortError'));
        },
        { once: true },
      );
    });
  }
}

// A PMTiles source for companion-provided archives. Uses the default browser HTTP cache (the
// companion serves with strong ETags so range-request cache writes succeed, unlike remote archives
// that may have weak ETags). Reads the auth token from a getter on every fetch so a token refresh
// is picked up without re-registering the archive. Exported for testing.
export class CompanionSource implements Source {
  #url: string;
  #getToken: () => string | undefined;

  constructor(url: string, getToken: () => string | undefined) {
    this.#url = url;
    this.#getToken = getToken;
  }

  getKey(): string {
    return this.#url;
  }

  async getBytes(offset: number, length: number, signal?: AbortSignal): Promise<RangeResponse> {
    const headers: Record<string, string> = { Range: `bytes=${offset}-${offset + length - 1}` };
    const token = this.#getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(this.#url, {
      signal,
      headers,
      credentials: 'omit',
      redirect: 'error',
    });
    if (response.url && new URL(response.url).origin !== new URL(this.#url).origin) {
      throw new Error('PMTiles companion redirected outside the Signal K origin.');
    }
    if (response.status !== 200 && response.status !== 206) {
      throw new Error(`PMTiles fetch failed: ${response.status} for ${this.#url}`);
    }
    const validated = await validateRangeResponse(response, offset, length);
    return {
      data: validated.data,
      etag: validated.validator,
      cacheControl: validated.cacheControl,
      expires: validated.expires,
    };
  }
}

export function registerPmtilesProtocol(): void {
  if (protocol) return;
  protocol = new Protocol();
  maplibregl.addProtocol('pmtiles', protocol.tile);
}

let blockStore: BlockStore | undefined;

// The companion serve route path. An archive served from it carries a strong ETag, so the browser
// HTTP cache works and the no-store workaround plus the IndexedDB block cache are not needed. The
// match is on the exact url path: a false positive that routed a blob or a remote weak-ETag archive
// through this path would reintroduce the Chrome cache-write failure.
const COMPANION_PMTILES_PREFIX = '/plugins/signalk-chart-locker/pmtiles/';

function isCompanionProvided(httpUrl: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const u = new URL(httpUrl, window.location.href);
    return u.origin === window.location.origin && u.pathname.startsWith(COMPANION_PMTILES_PREFIX);
  } catch {
    return false;
  }
}

// The source for an archive url. A companion-provided archive uses a CompanionSource with the
// default browser HTTP cache (its strong ETag makes the range-cache write succeed) and a dynamic
// auth token getter so the auth header is attached on every fetch. A blob: archive is already local
// bytes, so it skips the block cache too. Any other network archive keeps the no-store source
// wrapped in the IndexedDB block cache. Exported for testing.
export function createArchiveSource(httpUrl: string, getToken?: () => string | undefined): Source {
  if (isCompanionProvided(httpUrl)) {
    return new CompanionSource(httpUrl, getToken ?? (() => undefined));
  }
  const inner = new NoStoreSource(httpUrl);
  if (httpUrl.startsWith('blob:')) return inner;
  blockStore ??= createBlockStore();
  return new BlockCachedSource(inner, blockStore);
}

// Register a PMTiles archive with the appropriate source so MapLibre resolves `pmtiles://<httpUrl>`
// to it. Pass getToken for companion-provided archives so each fetch carries the current auth token.
export function registerPmtilesArchive(httpUrl: string, getToken?: () => string | undefined): void {
  if (!protocol) registerPmtilesProtocol();
  if (protocol?.get(httpUrl)) return;
  protocol?.add(new PMTiles(createArchiveSource(httpUrl, getToken)));
}

// Drop a registered archive when its chart is removed, or each user-chart delete would leak a
// PMTiles instance (for a blob: URL, a permanently dead one). The protocol exposes add and get
// but no remove, so this reaches into its keyed instance map directly. The archive's cached
// blocks are dropped too, best-effort, so a deleted chart stops holding cache budget.
export function unregisterPmtilesArchive(httpUrl: string): void {
  // Guard against an internal property rename across pmtiles versions: if `tiles` is not a Map,
  // the delete would be a silent no-op that leaks the archive, so warn instead of failing hard.
  if (protocol && protocol.tiles instanceof Map) {
    protocol.tiles.delete(httpUrl);
  } else if (protocol) {
    console.warn('[pmtiles] protocol.tiles is not a Map; cannot unregister archive', httpUrl);
  }
  void blockStore?.purgeArchive(httpUrl);
}
