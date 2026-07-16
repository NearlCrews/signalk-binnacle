import type { RangeResponse, Source } from 'pmtiles';
import { isAbort } from './abort';
import type { BlockStore } from './block-store';
import { requestedRangeEnd } from './pmtiles-range';

const BLOCK_SIZE = 64 * 1024;
const WRITES_PER_PRUNE = 16;

export interface BlockCacheOptions {
  // Test seams: production uses the 64 KB block, a 16-write prune cadence, and Date.now.
  blockSize?: number;
  pruneEvery?: number;
  now?: () => number;
}

function toRuns(indexes: number[]): Array<{ start: number; count: number }> {
  const runs: Array<{ start: number; count: number }> = [];
  for (const index of indexes) {
    const last = runs[runs.length - 1];
    if (last && index === last.start + last.count) last.count += 1;
    else runs.push({ start: index, count: 1 });
  }
  return runs;
}

// A pmtiles Source that serves aligned blocks cache-first from a BlockStore, fetching
// misses through the inner source as one coalesced range per contiguous run. The block
// holding the archive header is network-first so a replaced archive is detected by its
// strong validator and purged; when that fetch fails the cached block serves (offline).
export class BlockCachedSource implements Source {
  #inner: Source;
  #store: BlockStore;
  #blockSize: number;
  #pruneEvery: number;
  #now: () => number;
  #writesSincePrune = 0;
  #etag: string | undefined;
  #etagLoaded = false;

  constructor(inner: Source, store: BlockStore, options: BlockCacheOptions = {}) {
    this.#inner = inner;
    this.#store = store;
    this.#blockSize = options.blockSize ?? BLOCK_SIZE;
    this.#pruneEvery = options.pruneEvery ?? WRITES_PER_PRUNE;
    this.#now = options.now ?? Date.now;
  }

  getKey(): string {
    return this.#inner.getKey();
  }

  async getBytes(
    offset: number,
    length: number,
    signal?: AbortSignal,
    etag?: string,
  ): Promise<RangeResponse> {
    requestedRangeEnd(offset, length);
    const bs = this.#blockSize;
    const url = this.#inner.getKey();
    const first = Math.floor(offset / bs);
    const last = Math.floor((offset + length - 1) / bs);
    const indexes: number[] = [];
    for (let index = first; index <= last; index++) indexes.push(index);

    const cached = await this.#store.getBlocks(url, indexes);
    const fetched = new Map<number, ArrayBuffer>();
    let cacheControl: string | undefined;
    let expires: string | undefined;

    if (first === 0) {
      let res: RangeResponse | undefined;
      try {
        res = await this.#inner.getBytes(0, bs, signal, etag);
      } catch (error) {
        if (!cached.has(0) || isAbort(error, signal)) throw error;
      }
      if (res) {
        const prior = await this.#store.getValidator(url);
        if (res.etag === undefined) {
          // A successful header read without a validator cannot prove that any cached block belongs
          // to the current archive. Drop the old archive before caching the fresh header. A failed
          // header read still takes the offline fallback below and preserves the validated cache.
          await this.#store.purgeArchive(url);
          cached.clear();
          this.#etag = undefined;
          this.#etagLoaded = true;
        } else {
          if (prior !== undefined && prior !== res.etag) {
            // The archive was replaced: every cached block is from the old bytes.
            await this.#store.purgeArchive(url);
            cached.clear();
          }
          if (prior !== res.etag) await this.#store.setValidator(url, res.etag);
          this.#etag = res.etag;
          this.#etagLoaded = true;
        }
        fetched.set(0, res.data);
        cached.set(0, res.data);
        cacheControl = res.cacheControl;
        expires = res.expires;
      }
    }

    // A cached short block marks the archive tail: nothing past it exists, so a request
    // running beyond it truncates (as a raw range read would) instead of fetching a range
    // that is fully past the end and would be refused.
    let tail = Number.POSITIVE_INFINITY;
    for (const [index, data] of cached) {
      if (data.byteLength < bs) tail = Math.min(tail, index);
    }
    const missing = indexes.filter((index) => !cached.has(index) && index < tail);
    const runs = toRuns(missing);
    const responses = await Promise.all(
      runs.map((run) => this.#inner.getBytes(run.start * bs, run.count * bs, signal, etag)),
    );
    responses.forEach((res, at) => {
      const run = runs[at];
      for (let k = 0; k < run.count; k++) {
        const from = k * bs;
        // A run can come back short when it reaches the end of the archive; the tail
        // block stores its actual bytes, unpadded, and anything past it stores nothing.
        if (from >= res.data.byteLength) break;
        const block = res.data.slice(from, Math.min(from + bs, res.data.byteLength));
        fetched.set(run.start + k, block);
        cached.set(run.start + k, block);
      }
      cacheControl ??= res.cacheControl;
      expires ??= res.expires;
    });

    const now = this.#now();
    if (fetched.size > 0) {
      await this.#store.putBlocks(url, fetched, now);
      this.#writesSincePrune += fetched.size;
      if (this.#writesSincePrune >= this.#pruneEvery) {
        this.#writesSincePrune = 0;
        void this.#store.prune(now);
      }
    }
    const hits = indexes.filter((index) => cached.has(index) && !fetched.has(index));
    if (hits.length > 0) void this.#store.touch(url, hits, now);

    return {
      data: this.#assemble(cached, first, last, offset, length),
      etag: await this.#archiveEtag(url),
      cacheControl,
      expires,
    };
  }

  // The exact requested sub-range, copied out of the covered blocks. Only the archive's
  // tail block is short, so assembly stops at the first gap or short block, truncating a
  // read past the end of the archive to what a raw range request would have returned.
  #assemble(
    blocks: Map<number, ArrayBuffer>,
    first: number,
    last: number,
    offset: number,
    length: number,
  ): ArrayBuffer {
    const bs = this.#blockSize;
    const lead = offset - first * bs;
    const out = new Uint8Array(length);
    let filled = 0;
    for (let index = first; index <= last; index++) {
      const block = blocks.get(index);
      if (!block) break;
      const blockStart = (index - first) * bs;
      const from = Math.max(lead, blockStart);
      const to = Math.min(lead + length, blockStart + block.byteLength);
      if (to <= from) break;
      out.set(new Uint8Array(block, from - blockStart, to - from), from - lead);
      filled = to - lead;
      if (block.byteLength < bs) break;
    }
    return filled === length ? out.buffer : out.buffer.slice(0, filled);
  }

  async #archiveEtag(url: string): Promise<string | undefined> {
    if (this.#etagLoaded) return this.#etag;
    const stored = await this.#store.getValidator(url);
    // Latch as loaded only once a validator is actually known. An undefined result means the header
    // block has not been fetched yet, so leaving it unlatched lets a later block-0 header fetch
    // populate the etag instead of pinning undefined for the life of the source.
    if (stored !== undefined) {
      this.#etag = stored;
      this.#etagLoaded = true;
    }
    return stored;
  }
}
