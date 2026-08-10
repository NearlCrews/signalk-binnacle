import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeIdbFactory } from '$shared/testing';
import { createBlockStore } from './block-store';

// The broader block-store behavior (round-trips, TTL, budget, degrade) is covered beside the
// consumer in pmtiles-block-cache.test.ts; this file pins the prune transaction shape.

const URL_A = 'http://x/a.pmtiles';
const BS = 16;

function block(fill: number): ArrayBuffer {
  return new Uint8Array(BS).fill(fill).buffer;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createBlockStore prune', () => {
  it('prunes through indexedDB in one readwrite transaction without reading block bytes', async () => {
    // A failure inside the transaction would degrade to the memory mirror and quietly satisfy the
    // value assertions below, so hold the store to never having degraded.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { factory, transactions, valueReads } = fakeIdbFactory();
    const store = createBlockStore({ factory, maxBytes: 2 * BS, ttlMs: 100 });
    await store.putBlocks(URL_A, new Map([[0, block(1)]]), 0);
    await store.putBlocks(URL_A, new Map([[1, block(2)]]), 60);
    await store.putBlocks(URL_A, new Map([[2, block(3)]]), 70);
    await store.putBlocks(URL_A, new Map([[3, block(4)]]), 80);
    transactions.length = 0;
    valueReads.clear();

    await store.prune(150);
    const pruned = transactions.splice(0);

    // One readwrite transaction over both stores. Classifying in a readonly transaction and
    // deleting in a second one leaves a window where a concurrent putBlocks or touch that landed
    // in between is the entry evicted, the race expiring-store's prune fixed.
    expect(pruned).toEqual([{ mode: 'readwrite', stores: ['blocks', 'meta'] }]);
    expect(valueReads.get('blocks')).toBeUndefined();
    const out = await store.getBlocks(URL_A, [0, 1, 2, 3]);
    // Block 0 aged past the TTL; block 1 was the oldest-touched live block beyond the budget.
    expect([...out.keys()].sort()).toEqual([2, 3]);
    expect(warn).not.toHaveBeenCalled();
  });
});
