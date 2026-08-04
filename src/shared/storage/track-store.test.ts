import { afterEach, describe, expect, it, vi } from 'vitest';
import { failingIdbFactory } from '$shared/testing';
import { createTrackStore } from './track-store';

interface Point {
  t: number;
}

afterEach(() => {
  vi.restoreAllMocks();
});

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
