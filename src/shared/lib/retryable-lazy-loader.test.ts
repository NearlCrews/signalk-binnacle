import { describe, expect, it, vi } from 'vitest';
import { createRetryableLazyLoader, createRetryableLazyUiLoader } from './retryable-lazy-loader';

describe('createRetryableLazyLoader', () => {
  it('memoizes the first successful load', async () => {
    const module = { value: 'loaded' };
    const load = vi.fn(async () => module);
    const lazyLoad = createRetryableLazyLoader(load);

    const first = lazyLoad();
    const second = lazyLoad();

    expect(first).toBe(second);
    await expect(first).resolves.toBe(module);
    await expect(lazyLoad()).resolves.toBe(module);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('clears a rejected load and allows a retry', async () => {
    const failure = new Error('chunk unavailable');
    const module = { value: 'loaded' };
    const load = vi
      .fn<() => Promise<typeof module>>()
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(module);
    const lazyLoad = createRetryableLazyLoader(load);

    const failed = lazyLoad();
    expect(lazyLoad()).toBe(failed);
    await expect(failed).rejects.toBe(failure);

    const retried = lazyLoad();
    expect(retried).not.toBe(failed);
    await expect(retried).resolves.toBe(module);
    expect(load).toHaveBeenCalledTimes(2);
    expect(lazyLoad()).toBe(retried);
  });

  it('keeps a one-shot load pending without an explicit timeout', async () => {
    vi.useFakeTimers();
    try {
      const module = { value: 'loaded' };
      let resolveSource: (value: typeof module) => void = () => undefined;
      const source = new Promise<typeof module>((resolve) => {
        resolveSource = resolve;
      });
      const load = vi.fn(() => source);
      const lazyLoad = createRetryableLazyLoader(load);

      const pending = lazyLoad();
      await vi.advanceTimersByTimeAsync(15_000);
      expect(lazyLoad()).toBe(pending);
      expect(load).toHaveBeenCalledOnce();

      resolveSource(module);
      await expect(pending).resolves.toBe(module);
    } finally {
      vi.useRealTimers();
    }
  });

  it('times out a stalled user interface load and allows a retry', async () => {
    vi.useFakeTimers();
    try {
      const module = { value: 'loaded' };
      const stalled = new Promise<typeof module>(() => {});
      const load = vi
        .fn<() => Promise<typeof module>>()
        .mockReturnValueOnce(stalled)
        .mockResolvedValueOnce(module);
      const lazyLoad = createRetryableLazyUiLoader(load);

      const failed = lazyLoad();
      const rejection = expect(failed).rejects.toThrow('Lazy module load timed out.');
      await vi.advanceTimersByTimeAsync(15_000);
      await rejection;

      const retried = lazyLoad();
      expect(retried).not.toBe(failed);
      await expect(retried).resolves.toBe(module);
      expect(load).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
