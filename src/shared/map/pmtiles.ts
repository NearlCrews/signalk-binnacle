import * as maplibregl from 'maplibre-gl';
import { PMTiles, Protocol, type RangeResponse, type Source } from 'pmtiles';
import { withTimeout } from '$shared/lib';
import { isAbort } from './abort';
import { BlockCachedSource, type BlockStore, createBlockStore } from './pmtiles-block-cache';
import { requestedRangeEnd } from './pmtiles-range';

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

function pmtilesUrlForError(value: string): string {
  try {
    const parsed = new URL(value);
    for (const name of new Set(parsed.searchParams.keys())) {
      parsed.searchParams.set(name, 'REDACTED');
    }
    return parsed.toString();
  } catch {
    const query = value.indexOf('?');
    return query < 0 ? value : `${value.slice(0, query)}?REDACTED`;
  }
}

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Cancellation is best-effort. Preserve the validation or transport error that prompted it.
  }
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
  const declaredLength = end - start + 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    !Number.isSafeInteger(declaredLength) ||
    (total !== undefined && !Number.isSafeInteger(total)) ||
    end < start ||
    (total !== undefined && (total <= end || total <= 0))
  ) {
    throw new Error('PMTiles range response has inconsistent bounds.');
  }
  return { start, end, total };
}

async function validateRangeResponseUnchecked(
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
    (declaredLength !== undefined && data.byteLength !== declaredLength) ||
    (contentLength !== undefined && data.byteLength !== contentLength)
  ) {
    throw new Error('PMTiles server returned bytes outside the requested range.');
  }
  // A complete 200 response reveals the archive size. A 206 response with an unknown total does
  // not, even when it fills the requested span, so Last-Modified alone cannot identify the archive.
  if (response.status === 200) total = data.byteLength;

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

async function validateRangeResponse(
  response: Response,
  offset: number,
  length: number,
): Promise<ValidatedRange> {
  try {
    return await validateRangeResponseUnchecked(response, offset, length);
  } catch (error) {
    // Header validation can reject before the body is read. Cancel that stream as well as streams
    // that fail during bounded reading so the browser can promptly reuse the connection.
    await cancelResponseBody(response);
    throw error;
  }
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
    const end = requestedRangeEnd(offset, length);
    const headers = { Range: `bytes=${offset}-${end}` };
    for (let attempt = 0; ; attempt++) {
      let response: Response;
      const init = withTimeout({ signal, cache: 'no-store', headers });
      try {
        response = await fetch(this.#url, init);
      } catch (error) {
        // A network error is transient and retryable; a caller abort is not.
        if (isAbort(error, init.signal ?? signal)) throw error;
        if (attempt >= MAX_RETRIES) {
          throw new Error(`PMTiles request failed for ${pmtilesUrlForError(this.#url)}`);
        }
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
        await cancelResponseBody(response);
        await this.#backoff(attempt, signal);
        continue;
      }
      await cancelResponseBody(response);
      throw new Error(
        `PMTiles fetch failed: ${response.status} for ${pmtilesUrlForError(this.#url)}`,
      );
    }
  }

  #backoff(attempt: number, signal?: AbortSignal): Promise<void> {
    const ms = RETRY_BACKOFF_MS[attempt] ?? RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1];
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }
      const cleanup = () => signal?.removeEventListener('abort', onAbort);
      const onAbort = () => {
        clearTimeout(timer);
        cleanup();
        reject(new DOMException('Aborted', 'AbortError'));
      };
      const timer = setTimeout(() => {
        cleanup();
        resolve();
      }, ms);
      signal?.addEventListener('abort', onAbort, { once: true });
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
    const end = requestedRangeEnd(offset, length);
    const headers: Record<string, string> = { Range: `bytes=${offset}-${end}` };
    const token = this.#getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const init = withTimeout({ signal, headers, credentials: 'omit', redirect: 'error' });
    let response: Response;
    try {
      response = await fetch(this.#url, init);
    } catch (error) {
      if (isAbort(error, init.signal ?? signal)) throw error;
      throw new Error(`PMTiles request failed for ${pmtilesUrlForError(this.#url)}`);
    }
    if (response.url && new URL(response.url).origin !== new URL(this.#url).origin) {
      await cancelResponseBody(response);
      throw new Error('PMTiles companion redirected outside the Signal K origin.');
    }
    if (response.status !== 200 && response.status !== 206) {
      await cancelResponseBody(response);
      throw new Error(
        `PMTiles fetch failed: ${response.status} for ${pmtilesUrlForError(this.#url)}`,
      );
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

// How many chart entries currently reference each registered archive url. Two entries can name the
// same archive (a user-added chart duplicating a server-discovered one: only ids are deduplicated,
// and a user chart is minted with a fresh uuid), so unregistering on the first removal would drop
// the archive and purge its blocks out from under the survivor, which then silently loses tiles
// until something re-registers it.
const archiveReferences = new Map<string, number>();

// How many chart entries still hold an archive url. Exported for testing: the reference count is
// the whole point of the fix, and the protocol's own instance map is private to this module.
export function pmtilesArchiveReferences(httpUrl: string): number {
  return archiveReferences.get(httpUrl) ?? 0;
}

// Register a PMTiles archive with the appropriate source so MapLibre resolves `pmtiles://<httpUrl>`
// to it. Pass getToken for companion-provided archives so each fetch carries the current auth token.
export function registerPmtilesArchive(httpUrl: string, getToken?: () => string | undefined): void {
  if (!protocol) registerPmtilesProtocol();
  archiveReferences.set(httpUrl, (archiveReferences.get(httpUrl) ?? 0) + 1);
  if (protocol?.get(httpUrl)) return;
  protocol?.add(new PMTiles(createArchiveSource(httpUrl, getToken)));
}

// Drop a registered archive when its last chart is removed, or each user-chart delete would leak a
// PMTiles instance (for a blob: URL, a permanently dead one). The protocol exposes add and get
// but no remove, so this reaches into its keyed instance map directly. The archive's cached
// blocks are dropped too, best-effort, so a deleted chart stops holding cache budget.
export function unregisterPmtilesArchive(httpUrl: string): void {
  const remaining = (archiveReferences.get(httpUrl) ?? 0) - 1;
  if (remaining > 0) {
    archiveReferences.set(httpUrl, remaining);
    return;
  }
  archiveReferences.delete(httpUrl);
  // Guard against an internal property rename across pmtiles versions: if `tiles` is not a Map,
  // the delete would be a silent no-op that leaks the archive, so warn instead of failing hard.
  if (protocol && protocol.tiles instanceof Map) {
    protocol.tiles.delete(httpUrl);
  } else if (protocol) {
    console.warn(
      '[pmtiles] protocol.tiles is not a Map; cannot unregister archive',
      pmtilesUrlForError(httpUrl),
    );
  }
  void blockStore?.purgeArchive(httpUrl);
}
