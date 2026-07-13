import { describe, expect, it } from 'vitest';
import { createTrackStore } from './track-store';

interface Point {
  t: number;
}

// An IDBFactory whose open() always errors, to exercise the degrade-to-memory path.
function failingFactory(): IDBFactory {
  return {
    open() {
      const req = { onerror: null as null | (() => void), error: new Error('open failed') };
      queueMicrotask(() => req.onerror?.());
      return req as unknown as IDBOpenDBRequest;
    },
  } as unknown as IDBFactory;
}

describe('createTrackStore', () => {
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
    const store = createTrackStore<Point>(failingFactory(), () => degraded.push('degraded'));
    expect(await store.all()).toEqual([]);
    await store.append({ t: 7 });
    expect((await store.all()).map((x) => x.t)).toEqual([7]);
    expect(degraded).toEqual(['degraded']);
  });

  it('reports memory-only storage when indexedDB is unavailable', () => {
    const degraded: string[] = [];
    createTrackStore<Point>(undefined, () => degraded.push('degraded'));
    expect(degraded).toEqual(['degraded']);
  });
});
