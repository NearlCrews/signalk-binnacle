import { flushSync } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWakeLockHolder } from './wake-lock.svelte';

function fakeSentinel() {
  const listeners: Array<() => void> = [];
  return {
    released: false,
    release: vi.fn(function (this: { released: boolean }) {
      this.released = true;
      for (const listener of listeners.splice(0)) listener();
      return Promise.resolve();
    }),
    addEventListener: vi.fn((_type: string, listener: () => void) => {
      listeners.push(listener);
    }),
  };
}

function setup(options: { supported?: boolean; reject?: boolean } = {}) {
  const state = $state({ wanted: false });
  const sentinels: Array<ReturnType<typeof fakeSentinel>> = [];
  const request = vi.fn(() => {
    if (options.reject) return Promise.reject(new Error('denied'));
    const sentinel = fakeSentinel();
    sentinels.push(sentinel);
    return Promise.resolve(sentinel as unknown as WakeLockSentinel);
  });
  let holder!: ReturnType<typeof createWakeLockHolder>;
  let disposeRoot!: () => void;
  flushSync(() => {
    disposeRoot = $effect.root(() => {
      holder = createWakeLockHolder({
        wanted: () => state.wanted,
        request,
        supported: options.supported ?? true,
      });
    });
  });
  const cleanup = () => {
    holder.dispose();
    disposeRoot();
  };
  cleanups.push(cleanup);
  return { state, request, sentinels, holder };
}

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  vi.restoreAllMocks();
});

describe('createWakeLockHolder', () => {
  it('acquires while wanted and releases when the want clears', async () => {
    const test = setup();
    expect(test.holder.state).toBe('idle');

    test.state.wanted = true;
    flushSync();
    await vi.waitFor(() => expect(test.holder.state).toBe('held'));
    expect(test.request).toHaveBeenCalledOnce();

    test.state.wanted = false;
    flushSync();
    expect(test.holder.state).toBe('idle');
    expect(test.sentinels[0].release).toHaveBeenCalled();
  });

  it('returns to idle when the browser releases the lock itself', async () => {
    const test = setup();
    test.state.wanted = true;
    flushSync();
    await vi.waitFor(() => expect(test.holder.state).toBe('held'));

    // A hidden page or battery saver releases without the holder asking.
    await test.sentinels[0].release();
    expect(test.holder.state).toBe('idle');
  });

  it('reports a refused request as failed instead of retrying in a loop', async () => {
    const test = setup({ reject: true });
    test.state.wanted = true;
    flushSync();
    await vi.waitFor(() => expect(test.holder.state).toBe('failed'));
    expect(test.request).toHaveBeenCalledOnce();
  });

  it('reports unsupported without the API and never requests', () => {
    const test = setup({ supported: false });
    expect(test.holder.state).toBe('unsupported');
    test.state.wanted = true;
    flushSync();
    expect(test.request).not.toHaveBeenCalled();
  });
});
