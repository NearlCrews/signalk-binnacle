import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubFetch } from '$shared/testing';
import { createPathMetaCache, RETRY_DELAY_MS } from './path-meta-cache.svelte';

const ORIGIN = 'https://boat.example';
const PATH = 'environment.depth.belowTransducer';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('createPathMetaCache', () => {
  it('caches resolved meta and does not refetch it', async () => {
    const mock = stubFetch({ ok: true, body: { units: 'm', zones: [] } });
    const cache = createPathMetaCache(ORIGIN, () => 'tok');
    cache.load(PATH);
    await vi.runAllTimersAsync();
    expect(cache.get(PATH)).toMatchObject({ units: 'm' });
    cache.load(PATH);
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it('paces retries: a failed settle holds the sentinel until the retry delay passes', async () => {
    const mock = stubFetch({ ok: false, status: 500 });
    const cache = createPathMetaCache(ORIGIN, () => 'tok');
    cache.load(PATH);
    await vi.advanceTimersByTimeAsync(0);
    // The fetch failed, but the sentinel is still in place, so an immediate reactive revisit
    // cannot burn another attempt.
    expect(cache.get(PATH)).toBeNull();
    cache.load(PATH);
    expect(mock).toHaveBeenCalledTimes(1);
    // Once the delay passes the retry window reopens.
    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS);
    expect(cache.get(PATH)).toBeUndefined();
    cache.load(PATH);
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it('restores the attempt budget and give-up sentinels when the token changes', async () => {
    let token: string | undefined;
    const mock = stubFetch({ ok: false, status: 401 });
    const cache = createPathMetaCache(ORIGIN, () => token);
    // Burn the whole budget tokenless (the persisted-open instruments dock does this before
    // auth resolves).
    for (let i = 0; i < 3; i += 1) {
      cache.load(PATH);
      await vi.runAllTimersAsync();
    }
    cache.load(PATH);
    expect(cache.get(PATH)).toBeNull();
    expect(mock).toHaveBeenCalledTimes(3);

    // Credentials arrive: the give-up sentinel reopens and the fetch runs with the new token.
    token = 'tok';
    stubFetch({ ok: true, body: { units: 'm', displayName: 'Depth' } });
    cache.load(PATH);
    await vi.runAllTimersAsync();
    expect(cache.get(PATH)).toMatchObject({ displayName: 'Depth' });
  });

  it('bumps the version when a delayed retry window reopens, so consumers revisit', async () => {
    stubFetch({ ok: false, status: 500 });
    const cache = createPathMetaCache(ORIGIN, () => 'tok');
    const before = cache.version;
    cache.load(PATH);
    await vi.advanceTimersByTimeAsync(0);
    expect(cache.version).toBe(before);
    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS);
    expect(cache.version).toBe(before + 1);
  });
});
