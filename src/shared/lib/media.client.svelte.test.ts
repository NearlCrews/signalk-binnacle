import { flushSync, tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMediaQuery } from './media.svelte';

interface FakeQuery {
  matches: boolean;
  listeners: Set<() => void>;
}

// A scripted MediaQueryList: the real one cannot be driven from a test, and the point here is the
// subscription lifecycle rather than the browser's query evaluation.
function stubMatchMedia(initial: boolean): FakeQuery {
  const query: FakeQuery = { matches: initial, listeners: new Set() };
  vi.stubGlobal('matchMedia', () => ({
    get matches() {
      return query.matches;
    },
    addEventListener: (_type: string, listener: () => void) => query.listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => query.listeners.delete(listener),
  }));
  return query;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createMediaQuery', () => {
  it('seeds from the current match and re-runs an effect on a change', () => {
    const query = stubMatchMedia(true);
    const seen: boolean[] = [];

    const stop = $effect.root(() => {
      const phone = createMediaQuery('(max-width: 600px)');
      $effect(() => {
        seen.push(phone.matches);
      });
    });
    flushSync();
    expect(seen).toEqual([true]);

    query.matches = false;
    for (const listener of query.listeners) listener();
    flushSync();

    expect(seen).toEqual([true, false]);
    stop();
  });

  it('releases the change listener when the reading effect is destroyed', async () => {
    const query = stubMatchMedia(false);

    const stop = $effect.root(() => {
      const phone = createMediaQuery('(max-width: 600px)');
      $effect(() => {
        void phone.matches;
      });
    });
    flushSync();
    expect(query.listeners.size).toBe(1);

    stop();
    await tick();

    expect(query.listeners.size).toBe(0);
  });

  it('reports no match where matchMedia is unavailable, rather than throwing', () => {
    vi.stubGlobal('matchMedia', undefined);

    expect(createMediaQuery('(max-width: 600px)').matches).toBe(false);
  });
});
