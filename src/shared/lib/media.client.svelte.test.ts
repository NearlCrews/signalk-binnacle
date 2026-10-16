import { flushSync, tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { stubMatchMedia } from '$shared/testing';
import { createMediaQuery } from './media.svelte';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createMediaQuery', () => {
  it('seeds from the current match and re-runs an effect on a change', () => {
    const query = stubMatchMedia(() => true);
    const seen: boolean[] = [];

    const stop = $effect.root(() => {
      const phone = createMediaQuery('(max-width: 600px)');
      $effect(() => {
        seen.push(phone.matches);
      });
    });
    flushSync();
    expect(seen).toEqual([true]);

    query.set(() => false);
    flushSync();

    expect(seen).toEqual([true, false]);
    stop();
  });

  it('releases the change listener when the reading effect is destroyed', async () => {
    const query = stubMatchMedia(() => false);

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

  it('shares one list and one change listener between callers asking the same question', () => {
    const query = stubMatchMedia(() => true);
    const stop = $effect.root(() => {
      const first = createMediaQuery('(max-width: 600px)');
      const second = createMediaQuery('(max-width: 600px)');
      expect(second).toBe(first);
      $effect(() => {
        void first.matches;
        void second.matches;
      });
    });
    flushSync();
    expect(query.listeners.size).toBe(1);
    stop();
  });

  it('starts fresh when matchMedia itself is replaced', () => {
    stubMatchMedia(() => true);
    expect(createMediaQuery('(max-width: 600px)').matches).toBe(true);
    stubMatchMedia(() => false);
    expect(createMediaQuery('(max-width: 600px)').matches).toBe(false);
  });

  it('reports no match where matchMedia is unavailable, rather than throwing', () => {
    vi.stubGlobal('matchMedia', undefined);

    expect(createMediaQuery('(max-width: 600px)').matches).toBe(false);
  });
});
