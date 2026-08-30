import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { idlePrefetch } from './idle-prefetch';

beforeEach(() => {
  vi.useFakeTimers();
  // Force the setTimeout fallback path unless a test installs its own idle callback.
  vi.stubGlobal('requestIdleCallback', undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('idlePrefetch', () => {
  it('waits out the settle delay, then runs the loaders sequentially', async () => {
    const order: string[] = [];
    let releaseFirst = () => {};
    const first = vi.fn(() => {
      order.push('first');
      return new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
    });
    const second = vi.fn(async () => {
      order.push('second');
    });

    idlePrefetch([first, second]);
    await vi.advanceTimersByTimeAsync(2_999);
    expect(first).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(first).toHaveBeenCalledOnce();
    expect(second).not.toHaveBeenCalled();

    releaseFirst();
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual(['first', 'second']);
  });

  it('a rejected loader does not stop the rest', async () => {
    const failing = vi.fn(() => Promise.reject(new Error('chunk fetch failed')));
    const next = vi.fn(async () => {});

    idlePrefetch([failing, next], { delayMs: 100 });
    await vi.advanceTimersByTimeAsync(100);

    expect(failing).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledOnce();
  });

  it('cancel before the delay prevents any load from starting', async () => {
    const loader = vi.fn(async () => {});

    const cancel = idlePrefetch([loader]);
    cancel();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(loader).not.toHaveBeenCalled();
  });

  it('cancel mid-sequence stops loads that have not started', async () => {
    let releaseFirst = () => {};
    const first = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseFirst = resolve;
        }),
    );
    const second = vi.fn(async () => {});

    const cancel = idlePrefetch([first, second], { delayMs: 100 });
    await vi.advanceTimersByTimeAsync(100);
    expect(first).toHaveBeenCalledOnce();

    cancel();
    releaseFirst();
    await vi.advanceTimersByTimeAsync(0);

    expect(second).not.toHaveBeenCalled();
  });

  it('prefers requestIdleCallback with the delay as its deadline', async () => {
    let idleCallback: (() => void) | undefined;
    const requestIdle = vi.fn((callback: () => void) => {
      idleCallback = callback;
      return 7;
    });
    vi.stubGlobal('requestIdleCallback', requestIdle);
    vi.stubGlobal('cancelIdleCallback', vi.fn());
    const loader = vi.fn(async () => {});

    idlePrefetch([loader], { delayMs: 250 });
    expect(requestIdle).toHaveBeenCalledWith(expect.any(Function), { timeout: 250 });
    expect(loader).not.toHaveBeenCalled();

    idleCallback?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(loader).toHaveBeenCalledOnce();
  });

  it('cancel releases the idle callback and blocks a late fire', async () => {
    let idleCallback: (() => void) | undefined;
    const requestIdle = vi.fn((callback: () => void) => {
      idleCallback = callback;
      return 7;
    });
    const cancelIdle = vi.fn();
    vi.stubGlobal('requestIdleCallback', requestIdle);
    vi.stubGlobal('cancelIdleCallback', cancelIdle);
    const loader = vi.fn(async () => {});

    const cancel = idlePrefetch([loader]);
    cancel();
    expect(cancelIdle).toHaveBeenCalledWith(7);

    // A callback already dispatched when cancel lands must still start nothing.
    idleCallback?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(loader).not.toHaveBeenCalled();
  });
});
