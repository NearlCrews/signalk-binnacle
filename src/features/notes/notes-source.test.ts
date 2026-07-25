import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NotePoint } from '$entities/poi';
import type { ExpiringStore } from '$shared/storage';
import { createNotesSource } from './notes-source';

describe('createNotesSource', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns one active promise for concurrent loads and clears it after settlement', async () => {
    let resolveFirst!: (value: undefined) => void;
    const firstRead = new Promise<undefined>((resolve) => {
      resolveFirst = resolve;
    });
    const persist: ExpiringStore<NotePoint[]> = {
      get: vi.fn().mockReturnValueOnce(firstRead).mockResolvedValue(undefined),
      put: vi.fn().mockResolvedValue(undefined),
      prune: vi.fn().mockResolvedValue(undefined),
    };
    const source = createNotesSource('http://pi', persist);
    const bbox: [number, number, number, number] = [-84, 42, -83, 43];
    const movedBbox: [number, number, number, number] = [-83, 42, -82, 43];

    const first = source.load(bbox, undefined, false);
    const concurrent = source.load(movedBbox, undefined, false);

    expect(concurrent).toBe(first);
    expect(source.inFlight()).toBe(true);
    expect(persist.get).toHaveBeenCalledTimes(1);

    resolveFirst(undefined);
    await expect(first).resolves.toEqual([]);
    expect(source.inFlight()).toBe(false);

    const next = source.load(bbox, undefined, false);
    expect(next).not.toBe(first);
    await expect(next).resolves.toEqual([]);
    expect(persist.get).toHaveBeenCalledTimes(2);
  });

  it('does not let an invalidated load clear the replacement single flight', async () => {
    const resolvers: Array<(value: undefined) => void> = [];
    const persist: ExpiringStore<NotePoint[]> = {
      get: vi.fn(
        () =>
          new Promise<undefined>((resolve) => {
            resolvers.push(resolve);
          }),
      ),
      put: vi.fn().mockResolvedValue(undefined),
      prune: vi.fn().mockResolvedValue(undefined),
    };
    const source = createNotesSource('http://pi', persist);
    const bbox: [number, number, number, number] = [-84, 42, -83, 43];
    let resolveNetwork!: (response: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveNetwork = resolve;
          }),
      ),
    );

    const stale = source.load(bbox, 'old', false);
    source.invalidate();
    const current = source.load(bbox, 'new', true);
    resolvers[0](undefined);
    await stale;

    expect(source.inFlight()).toBe(true);
    expect(source.load(bbox, 'new', true)).toBe(current);

    resolveNetwork(new Response('{}', { status: 200 }));
    await current;
    expect(source.inFlight()).toBe(false);
  });
});
