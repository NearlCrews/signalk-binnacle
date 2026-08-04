import { afterEach, describe, expect, it, vi } from 'vitest';
import { failingIdbFactory, fakeIdbFactory } from '$shared/testing';
import { createExpiringStore } from './expiring-store';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createExpiringStore', () => {
  it('puts and gets a value with its expiry (in-memory fallback)', async () => {
    const store = createExpiringStore<{ n: number }>('test', { factory: undefined });
    await store.put('a', { n: 1 }, 1000);
    expect(await store.get('a')).toEqual({ value: { n: 1 }, expires: 1000 });
    expect(await store.get('missing')).toBeUndefined();
  });

  it('prunes expired entries and caps the live entries to maxEntries', async () => {
    const store = createExpiringStore<number>('test', { factory: undefined, maxEntries: 2 });
    await store.put('expired', 0, 500);
    await store.put('a', 1, 2000);
    await store.put('b', 2, 3000);
    await store.put('c', 3, 4000);

    await store.prune(1000); // now=1000: 'expired' is gone, and only the 2 newest live entries remain

    expect(await store.get('expired')).toBeUndefined();
    expect(await store.get('a')).toBeUndefined(); // oldest live entry, evicted by the cap
    expect((await store.get('b'))?.value).toBe(2);
    expect((await store.get('c'))?.value).toBe(3);
  });

  it('prunes through indexedDB in a single readwrite transaction', async () => {
    // A failure inside the transaction would degrade to the memory mirror and quietly satisfy the
    // value assertions below, so hold the store to never having degraded.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { factory, transactions } = fakeIdbFactory();
    const store = createExpiringStore<number>('test', { factory, maxEntries: 2 });
    await store.put('expired', 0, 500);
    await store.put('a', 1, 2000);
    await store.put('b', 2, 3000);
    await store.put('c', 3, 4000);
    transactions.length = 0;

    await store.prune(1000);
    const pruned = transactions.splice(0);

    // One readwrite transaction over both stores. Classifying in a readonly transaction and
    // deleting in a second one leaves a window where a put that landed in between is evicted.
    expect(pruned).toEqual([{ mode: 'readwrite', stores: ['values', 'meta'] }]);
    expect(await store.get('expired')).toBeUndefined();
    expect(await store.get('a')).toBeUndefined(); // oldest live entry, evicted by the cap
    expect((await store.get('b'))?.value).toBe(2);
    expect((await store.get('c'))?.value).toBe(3);
    expect(warn).not.toHaveBeenCalled();
  });

  it('degrades to memory when indexedDB fails to open, never throwing', async () => {
    const store = createExpiringStore<number>('test', { factory: failingIdbFactory() });
    await store.put('a', 7, 1000);
    expect((await store.get('a'))?.value).toBe(7);
    await store.prune(2000);
    expect(await store.get('a')).toBeUndefined(); // expired and pruned
  });
});
