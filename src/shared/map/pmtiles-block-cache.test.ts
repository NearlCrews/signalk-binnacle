import type { Source } from 'pmtiles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { failingIdbFactory, fakeIdbFactory } from '$shared/testing';
import { BlockCachedSource, type BlockStore, createBlockStore } from './pmtiles-block-cache';

const URL_A = 'http://x/a.pmtiles';
const URL_B = 'http://x/b.pmtiles';
// A small block size keeps the alignment math readable; production uses 64 KB.
const BS = 16;
const BLOCKS_STORE = 'blocks';

let clock = 0;

beforeEach(() => {
  clock = 1000;
});

function pattern(length: number): Uint8Array {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = i % 251;
  return out;
}

function bytes(data: ArrayBuffer): number[] {
  return [...new Uint8Array(data)];
}

function block(fill: number, length = BS): ArrayBuffer {
  return new Uint8Array(length).fill(fill).buffer;
}

interface FakeInner {
  source: Source;
  calls: Array<{ offset: number; length: number; signal?: AbortSignal; etag?: string }>;
  options: { etag?: string; failing?: boolean };
}

// A scripted inner source over an in-memory archive, recording every requested range. It
// truncates a range at the end of the archive and rejects one fully past it, mirroring
// what NoStoreSource does over HTTP.
function fakeInner(archive: Uint8Array, options: FakeInner['options'] = {}): FakeInner {
  const calls: FakeInner['calls'] = [];
  const source: Source = {
    getKey: () => URL_A,
    getBytes: async (offset, length, signal, etag) => {
      calls.push({ offset, length, signal, etag });
      if (options.failing) throw new TypeError('network down');
      if (offset >= archive.length) {
        throw new Error(`PMTiles fetch failed: 416 for ${URL_A}`);
      }
      const end = Math.min(offset + length, archive.length);
      return { data: archive.slice(offset, end).buffer, etag: options.etag };
    },
  };
  return { source, calls, options };
}

function cachedSource(
  inner: FakeInner,
  store: BlockStore,
  extra: { pruneEvery?: number } = {},
): BlockCachedSource {
  return new BlockCachedSource(inner.source, store, {
    blockSize: BS,
    now: () => clock,
    ...extra,
  });
}

function memStore(): BlockStore {
  return createBlockStore({ factory: undefined });
}

describe('BlockCachedSource block alignment', () => {
  it.each([
    [-1, 4],
    [0, 0],
    [0, 1.5],
    [1.5, 4],
    [0, 64 * 1024 * 1024 + 1],
    [Number.MAX_SAFE_INTEGER, 2],
  ])(
    'rejects an unsafe requested range (%s, %s) before reading storage',
    async (offset, length) => {
      const inner = fakeInner(pattern(64));
      const store = memStore();
      const getBlocks = vi.spyOn(store, 'getBlocks');

      await expect(cachedSource(inner, store).getBytes(offset, length)).rejects.toThrow(RangeError);

      expect(getBlocks).not.toHaveBeenCalled();
      expect(inner.calls).toHaveLength(0);
    },
  );

  it('serves a single mid-archive block and returns the exact sub-range', async () => {
    const archive = pattern(64);
    const inner = fakeInner(archive);
    const source = cachedSource(inner, memStore());

    const out = await source.getBytes(20, 8);

    expect(inner.calls).toEqual([{ offset: 16, length: 16 }]);
    expect(bytes(out.data)).toEqual([...archive.slice(20, 28)]);
  });

  it('forwards the abort signal and etag through to the inner source', async () => {
    const archive = pattern(64);
    const inner = fakeInner(archive);
    const source = cachedSource(inner, memStore());
    const controller = new AbortController();

    await source.getBytes(20, 8, controller.signal, 'W/"v1"');

    expect(inner.calls[0].signal).toBe(controller.signal);
    expect(inner.calls[0].etag).toBe('W/"v1"');
  });

  it('coalesces a read spanning two blocks into one aligned range', async () => {
    const archive = pattern(64);
    const inner = fakeInner(archive);
    const source = cachedSource(inner, memStore());

    const out = await source.getBytes(20, 20);

    expect(inner.calls).toEqual([{ offset: 16, length: 32 }]);
    expect(bytes(out.data)).toEqual([...archive.slice(20, 40)]);
  });

  it('requests exactly one block for an exactly block-aligned read', async () => {
    const archive = pattern(64);
    const inner = fakeInner(archive);
    const source = cachedSource(inner, memStore());

    const out = await source.getBytes(16, 16);

    expect(inner.calls).toEqual([{ offset: 16, length: 16 }]);
    expect(bytes(out.data)).toEqual([...archive.slice(16, 32)]);
  });

  it('stores the short tail block unpadded and serves it from cache', async () => {
    const archive = pattern(40);
    const inner = fakeInner(archive);
    const source = cachedSource(inner, memStore());

    const fresh = await source.getBytes(32, 16);
    expect(inner.calls).toEqual([{ offset: 32, length: 16 }]);
    expect(bytes(fresh.data)).toEqual([...archive.slice(32, 40)]);

    const cached = await source.getBytes(32, 16);
    expect(inner.calls).toHaveLength(1);
    expect(bytes(cached.data)).toEqual([...archive.slice(32, 40)]);
  });

  it('rejects a read fully past the end of the archive, mirroring the inner source', async () => {
    const inner = fakeInner(pattern(40));
    const source = cachedSource(inner, memStore());

    await expect(source.getBytes(64, 16)).rejects.toThrow(/416/);
  });

  it('truncates a read running past a cached tail without fetching beyond it', async () => {
    const archive = pattern(40);
    const inner = fakeInner(archive);
    const source = cachedSource(inner, memStore());

    await source.getBytes(32, 8); // primes the short tail block
    const out = await source.getBytes(32, 32); // would cover a block fully past the end

    expect(inner.calls).toEqual([{ offset: 32, length: 16 }]);
    expect(bytes(out.data)).toEqual([...archive.slice(32, 40)]);
  });

  it('truncates an uncached read running past the end to what the inner source returns', async () => {
    const archive = pattern(40);
    const inner = fakeInner(archive);
    const source = cachedSource(inner, memStore());

    const out = await source.getBytes(32, 32);

    expect(inner.calls).toEqual([{ offset: 32, length: 32 }]);
    expect(bytes(out.data)).toEqual([...archive.slice(32, 40)]);
  });
});

describe('BlockCachedSource coalesced miss runs', () => {
  it('fetches adjacent misses as one range and disjoint misses as two', async () => {
    const archive = pattern(96);
    const inner = fakeInner(archive);
    const source = cachedSource(inner, memStore());

    await source.getBytes(48, 16); // primes block 3
    const out = await source.getBytes(16, 64); // blocks 1..4: misses are 1,2 and 4

    expect(inner.calls).toEqual([
      { offset: 48, length: 16 },
      { offset: 16, length: 32 },
      { offset: 64, length: 16 },
    ]);
    expect(bytes(out.data)).toEqual([...archive.slice(16, 80)]);
  });

  it('issues zero inner requests when every block is cached', async () => {
    const archive = pattern(64);
    const inner = fakeInner(archive);
    const source = cachedSource(inner, memStore());

    await source.getBytes(16, 32);
    const out = await source.getBytes(20, 24);

    expect(inner.calls).toHaveLength(1);
    expect(bytes(out.data)).toEqual([...archive.slice(20, 44)]);
  });
});

describe('BlockCachedSource header revalidation', () => {
  it('fetches the header block network-first even when cached', async () => {
    const archive = pattern(48);
    const store = memStore();
    const inner = fakeInner(archive, { etag: 'v1' });
    const source = cachedSource(inner, store);

    await source.getBytes(0, 16);
    await source.getBytes(0, 16);

    expect(inner.calls).toEqual([
      { offset: 0, length: 16 },
      { offset: 0, length: 16 },
    ]);
  });

  it('stores the validator on first sight and returns it', async () => {
    const store = memStore();
    const inner = fakeInner(pattern(48), { etag: 'v1' });
    const source = cachedSource(inner, store);

    const out = await source.getBytes(0, 16);

    expect(out.etag).toBe('v1');
    expect(await store.getValidator(URL_A)).toBe('v1');
  });

  it('keeps cached blocks when the validator matches', async () => {
    const archive = pattern(48);
    const store = memStore();
    const primer = fakeInner(archive, { etag: 'v1' });
    await cachedSource(primer, store).getBytes(0, 32); // primes blocks 0 and 1

    const inner = fakeInner(archive, { etag: 'v1' });
    const source = cachedSource(inner, store);
    await source.getBytes(0, 16);
    const out = await source.getBytes(16, 16);

    // Only the network-first header fetch; block 1 stayed cached.
    expect(inner.calls).toEqual([{ offset: 0, length: 16 }]);
    expect(bytes(out.data)).toEqual([...archive.slice(16, 32)]);
  });

  it('purges the archive blocks when the validator changes', async () => {
    const store = memStore();
    const primer = fakeInner(pattern(48), { etag: 'v1' });
    await cachedSource(primer, store).getBytes(0, 32);

    const replaced = pattern(48).reverse();
    const inner = fakeInner(replaced, { etag: 'v2' });
    const source = cachedSource(inner, store);
    await source.getBytes(0, 16);
    const out = await source.getBytes(16, 16);

    // Block 1 was purged with the rest of the archive, so it refetches.
    expect(inner.calls).toEqual([
      { offset: 0, length: 16 },
      { offset: 16, length: 16 },
    ]);
    expect(bytes(out.data)).toEqual([...replaced.slice(16, 32)]);
    expect(await store.getValidator(URL_A)).toBe('v2');
  });

  it('purges cached blocks when a successful header response carries no validator', async () => {
    const archive = pattern(48);
    const store = memStore();
    const primer = fakeInner(archive, { etag: 'v1' });
    await cachedSource(primer, store).getBytes(0, 32);

    const replaced = pattern(48).reverse();
    const inner = fakeInner(replaced); // no etag
    const source = cachedSource(inner, store);
    await source.getBytes(0, 16);
    const out = await source.getBytes(16, 16);

    expect(inner.calls).toEqual([
      { offset: 0, length: 16 },
      { offset: 16, length: 16 },
    ]);
    expect(bytes(out.data)).toEqual([...replaced.slice(16, 32)]);
    expect(await store.getValidator(URL_A)).toBeUndefined();
  });

  it('does not treat a cache purge failure as an offline header fetch', async () => {
    const archive = pattern(48);
    const base = memStore();
    const primer = fakeInner(archive, { etag: 'v1' });
    await cachedSource(primer, base).getBytes(0, 16);
    const store: BlockStore = {
      ...base,
      purgeArchive: vi.fn().mockRejectedValue(new Error('cache purge failed')),
    };
    const inner = fakeInner(archive); // successful response without a validator requires a purge

    await expect(cachedSource(inner, store).getBytes(0, 16)).rejects.toThrow('cache purge failed');
  });
});

describe('BlockCachedSource offline behavior', () => {
  it('serves cached blocks when the network fails', async () => {
    const archive = pattern(48);
    const store = memStore();
    const primer = fakeInner(archive, { etag: 'v1' });
    await cachedSource(primer, store).getBytes(0, 32);

    const inner = fakeInner(archive, { failing: true });
    const source = cachedSource(inner, store);
    const head = await source.getBytes(0, 16);
    const body = await source.getBytes(16, 16);

    expect(inner.calls).toEqual([{ offset: 0, length: 16 }]); // the failed header attempt
    expect(bytes(head.data)).toEqual([...archive.slice(0, 16)]);
    expect(bytes(body.data)).toEqual([...archive.slice(16, 32)]);
    expect(head.etag).toBe('v1'); // the stored validator still flows through
  });

  it('rethrows when a miss cannot be fetched and nothing is cached', async () => {
    const inner = fakeInner(pattern(48), { failing: true });
    const source = cachedSource(inner, memStore());

    await expect(source.getBytes(0, 16)).rejects.toThrow('network down');
    await expect(source.getBytes(16, 16)).rejects.toThrow('network down');
  });

  it('keeps serving cached blocks after a failed miss elsewhere', async () => {
    const archive = pattern(48);
    const store = memStore();
    const primer = fakeInner(archive);
    await cachedSource(primer, store).getBytes(16, 16);

    const inner = fakeInner(archive, { failing: true });
    const source = cachedSource(inner, store);
    await expect(source.getBytes(16, 32)).rejects.toThrow('network down');

    const out = await source.getBytes(16, 16);
    expect(bytes(out.data)).toEqual([...archive.slice(16, 32)]);
  });

  it('rethrows a caller abort on the header block even when cached', async () => {
    const archive = pattern(48);
    const store = memStore();
    const primer = fakeInner(archive);
    await cachedSource(primer, store).getBytes(0, 16);

    const controller = new AbortController();
    controller.abort();
    const inner: FakeInner = {
      source: {
        getKey: () => URL_A,
        getBytes: async () => {
          throw new DOMException('Aborted', 'AbortError');
        },
      },
      calls: [],
      options: {},
    };
    const source = cachedSource(inner, store);

    await expect(source.getBytes(0, 16, controller.signal)).rejects.toThrow('Aborted');
  });
});

describe('BlockCachedSource prune cadence', () => {
  it('prunes opportunistically after enough writes, never on reads', async () => {
    const base = memStore();
    const prune = vi.fn(base.prune);
    const store: BlockStore = { ...base, prune };
    const inner = fakeInner(pattern(96));
    const source = cachedSource(inner, store, { pruneEvery: 2 });

    await source.getBytes(16, 32); // two blocks written
    expect(prune).toHaveBeenCalledTimes(1);

    await source.getBytes(16, 32); // pure cache hit
    expect(prune).toHaveBeenCalledTimes(1);
  });
});

describe('createBlockStore in-memory fallback', () => {
  it('evicts the oldest-touched blocks beyond the byte budget', async () => {
    const store = createBlockStore({ factory: undefined, memoryMaxBytes: 2 * BS });
    await store.putBlocks(URL_A, new Map([[0, block(1)]]), 1);
    await store.putBlocks(URL_A, new Map([[1, block(2)]]), 2);
    await store.putBlocks(URL_A, new Map([[2, block(3)]]), 3);

    const out = await store.getBlocks(URL_A, [0, 1, 2]);
    expect([...out.keys()].sort()).toEqual([1, 2]);
  });

  it('touch protects a block from eviction', async () => {
    const store = createBlockStore({ factory: undefined, memoryMaxBytes: 2 * BS });
    await store.putBlocks(URL_A, new Map([[0, block(1)]]), 1);
    await store.putBlocks(URL_A, new Map([[1, block(2)]]), 2);
    await store.touch(URL_A, [0], 3);
    await store.putBlocks(URL_A, new Map([[2, block(3)]]), 4);

    const out = await store.getBlocks(URL_A, [0, 1, 2]);
    expect([...out.keys()].sort()).toEqual([0, 2]);
  });

  it('prune drops blocks not touched within the TTL', async () => {
    const store = createBlockStore({ factory: undefined, ttlMs: 100 });
    await store.putBlocks(URL_A, new Map([[0, block(1)]]), 0);
    await store.putBlocks(URL_A, new Map([[1, block(2)]]), 50);

    await store.prune(120);

    const out = await store.getBlocks(URL_A, [0, 1]);
    expect([...out.keys()]).toEqual([1]);
  });

  it('purgeArchive removes only that archive blocks and validator', async () => {
    const store = createBlockStore({ factory: undefined });
    await store.putBlocks(URL_A, new Map([[0, block(1)]]), 1);
    await store.putBlocks(URL_B, new Map([[0, block(2)]]), 1);
    await store.setValidator(URL_A, 'a1');
    await store.setValidator(URL_B, 'b1');

    await store.purgeArchive(URL_A);

    expect((await store.getBlocks(URL_A, [0])).size).toBe(0);
    expect((await store.getBlocks(URL_B, [0])).size).toBe(1);
    expect(await store.getValidator(URL_A)).toBeUndefined();
    expect(await store.getValidator(URL_B)).toBe('b1');
  });
});

describe('createBlockStore over IndexedDB', () => {
  it('round-trips blocks and validators', async () => {
    const { factory } = fakeIdbFactory();
    const store = createBlockStore({ factory });
    await store.putBlocks(
      URL_A,
      new Map<number, ArrayBuffer>([
        [0, block(1)],
        [3, block(4, 8)],
      ]),
      1,
    );
    await store.setValidator(URL_A, 'v1');

    const out = await store.getBlocks(URL_A, [0, 1, 3]);
    expect([...out.keys()].sort()).toEqual([0, 3]);
    expect(bytes(out.get(0) as ArrayBuffer)).toEqual([...new Uint8Array(BS).fill(1)]);
    expect((out.get(3) as ArrayBuffer).byteLength).toBe(8);
    expect(await store.getValidator(URL_A)).toBe('v1');
  });

  it('prune enforces the byte budget by oldest access without reading block bytes', async () => {
    const { factory, valueReads } = fakeIdbFactory();
    const store = createBlockStore({ factory, maxBytes: 2 * BS });
    await store.putBlocks(URL_A, new Map([[0, block(1)]]), 1);
    await store.putBlocks(URL_A, new Map([[1, block(2)]]), 2);
    await store.putBlocks(URL_A, new Map([[2, block(3)]]), 3);
    await store.touch(URL_A, [0], 4); // block 0 is now the most recently used
    valueReads.clear();

    await store.prune(5);

    expect(valueReads.get(BLOCKS_STORE)).toBeUndefined();
    const out = await store.getBlocks(URL_A, [0, 1, 2]);
    expect([...out.keys()].sort()).toEqual([0, 2]); // block 1 was the oldest by lastAccess
  });

  it('prune drops blocks past the TTL', async () => {
    const { factory } = fakeIdbFactory();
    const store = createBlockStore({ factory, ttlMs: 100 });
    await store.putBlocks(URL_A, new Map([[0, block(1)]]), 0);
    await store.putBlocks(URL_A, new Map([[1, block(2)]]), 80);

    await store.prune(150);

    const out = await store.getBlocks(URL_A, [0, 1]);
    expect([...out.keys()]).toEqual([1]);
  });

  it('purgeArchive deletes only that archive prefix', async () => {
    const { factory } = fakeIdbFactory();
    const store = createBlockStore({ factory });
    await store.putBlocks(URL_A, new Map([[0, block(1)]]), 1);
    await store.putBlocks(URL_B, new Map([[0, block(2)]]), 1);
    await store.setValidator(URL_A, 'a1');
    await store.setValidator(URL_B, 'b1');

    await store.purgeArchive(URL_A);

    expect((await store.getBlocks(URL_A, [0])).size).toBe(0);
    expect((await store.getBlocks(URL_B, [0])).size).toBe(1);
    expect(await store.getValidator(URL_A)).toBeUndefined();
    expect(await store.getValidator(URL_B)).toBe('b1');
  });

  it('degrades to memory when IndexedDB fails to open, never throwing', async () => {
    const store = createBlockStore({ factory: failingIdbFactory() });
    await store.putBlocks(URL_A, new Map([[0, block(7)]]), 1);

    const out = await store.getBlocks(URL_A, [0]);
    expect(bytes(out.get(0) as ArrayBuffer)).toEqual([...new Uint8Array(BS).fill(7)]);

    await store.setValidator(URL_A, 'v1');
    expect(await store.getValidator(URL_A)).toBe('v1');
  });
});
