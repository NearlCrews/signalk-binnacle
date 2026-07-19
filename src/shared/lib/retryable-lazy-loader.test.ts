import { describe, expect, it, vi } from 'vitest';
import { createRetryableLazyLoader } from './retryable-lazy-loader';

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
});
