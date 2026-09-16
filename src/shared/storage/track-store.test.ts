import { afterEach, describe, expect, it, vi } from 'vitest';
import { failingIdbFactory } from '$shared/testing';
import { createTrackStore } from './track-store';

interface Point {
  t: number;
}

// A transaction-level fault fixture: request success precedes commit, and an aborted
// transaction must not publish any staged clear/add operations to a reopened store.
function transactionalTrackFactory() {
  let committed: Point[] = [{ t: 1 }];
  let abortNext = false;
  const transactions: string[][] = [];
  const db = {
    close() {},
    transaction() {
      let staged = committed.slice();
      const operations: string[] = [];
      transactions.push(operations);
      const requests: Array<{
        onsuccess: null | (() => void);
        onerror: null | (() => void);
        result: unknown;
      }> = [];
      const request = (operation: string, result?: unknown) => {
        operations.push(operation);
        const req = { onsuccess: null, onerror: null, result };
        requests.push(req);
        return req;
      };
      const tx = {
        oncomplete: null as null | (() => void),
        onerror: null as null | (() => void),
        onabort: null as null | (() => void),
        error: new DOMException('Interrupted commit', 'AbortError'),
        objectStore: () => ({
          clear: () => {
            staged = [];
            return request('clear');
          },
          add: (point: Point) => {
            staged.push(point);
            return request('add', staged.length);
          },
          getAll: () => request('getAll', staged.slice()),
        }),
      };
      queueMicrotask(() => {
        for (const req of requests) req.onsuccess?.();
        if (abortNext) {
          abortNext = false;
          tx.onabort?.();
        } else {
          committed = staged;
          tx.oncomplete?.();
        }
      });
      return tx;
    },
  };
  const factory = {
    open: () => {
      const request = { result: db, onsuccess: null as null | (() => void) };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    },
  } as unknown as IDBFactory;
  return {
    factory,
    transactions,
    interruptNext: () => {
      abortNext = true;
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createTrackStore', () => {
  it('replaces a persisted track using one clear-and-add transaction', async () => {
    const fixture = transactionalTrackFactory();
    const store = createTrackStore<Point>(fixture.factory);
    await store.replaceAll([{ t: 2 }, { t: 3 }]);
    expect(fixture.transactions).toEqual([['clear', 'add', 'add']]);
    expect(await store.all()).toEqual([{ t: 2 }, { t: 3 }]);
    await store.replaceAll([]);
    expect(await store.all()).toEqual([]);
  });

  it('retains the old committed log after interruption while the current session keeps its replacement', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fixture = transactionalTrackFactory();
    const store = createTrackStore<Point>(fixture.factory);
    fixture.interruptNext();
    await store.replaceAll([{ t: 2 }, { t: 3 }]);
    expect(await store.all()).toEqual([{ t: 2 }, { t: 3 }]);
    expect(await createTrackStore<Point>(fixture.factory).all()).toEqual([{ t: 1 }]);
  });

  it('replaces rather than appends when storage is memory-only', async () => {
    const store = createTrackStore<Point>(undefined);
    await store.append({ t: 1 });
    await store.replaceAll([{ t: 2 }, { t: 3 }]);
    expect(await store.all()).toEqual([{ t: 2 }, { t: 3 }]);
  });
  it('appends, reads all, and clears with the in-memory fallback (no indexedDB)', async () => {
    const store = createTrackStore<Point>(undefined);
    await store.append({ t: 1 });
    await store.append({ t: 2 });
    expect((await store.all()).map((x) => x.t)).toEqual([1, 2]);
    await store.clear();
    expect(await store.all()).toEqual([]);
  });

  it('degrades to an in-memory log when indexedDB fails to open, never throwing', async () => {
    const degraded: string[] = [];
    const store = createTrackStore<Point>(failingIdbFactory(), () => degraded.push('degraded'));
    expect(await store.all()).toEqual([]);
    await store.append({ t: 7 });
    expect((await store.all()).map((x) => x.t)).toEqual([7]);
    expect(degraded).toEqual(['degraded']);
  });

  it('logs why persistence degraded, so a quota or corruption failure is diagnosable', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const store = createTrackStore<Point>(failingIdbFactory());

    await store.append({ t: 1 });

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('degraded to memory'),
      expect.objectContaining({ message: 'open failed' }),
    );
  });

  it('reports memory-only storage when indexedDB is unavailable', () => {
    const degraded: string[] = [];
    createTrackStore<Point>(undefined, () => degraded.push('degraded'));
    expect(degraded).toEqual(['degraded']);
  });
});
