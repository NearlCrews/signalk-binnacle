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
      if (response.status < 300) {
        // A weak ETag cannot validate range requests, so report none rather than one the
        // library would reject as a mismatch and retry on.
        let etag = response.headers.get('ETag') ?? undefined;
        if (etag?.startsWith('W/')) etag = undefined;
        return {
          data: await response.arrayBuffer(),
          etag,
          cacheControl: response.headers.get('Cache-Control') ?? undefined,
          expires: response.headers.get('Expires') ?? undefined,
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
    const response = await fetch(this.#url, { signal, headers });
    if (response.status >= 300) {
      throw new Error(`PMTiles fetch failed: ${response.status} for ${this.#url}`);
    }
    let etag = response.headers.get('ETag') ?? undefined;
    if (etag?.startsWith('W/')) etag = undefined;
    return {
      data: await response.arrayBuffer(),
      etag,
      cacheControl: response.headers.get('Cache-Control') ?? undefined,
      expires: response.headers.get('Expires') ?? undefined,
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
  protocol?.tiles.delete(httpUrl);
  void blockStore?.purgeArchive(httpUrl);
}
