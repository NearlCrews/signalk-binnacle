import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_FETCH_TIMEOUT_MS, withTimeout } from './fetch-timeout';

describe('withTimeout', () => {
  it('adds a timeout signal when the init carries none', () => {
    const out = withTimeout();
    expect(out.signal).toBeInstanceOf(AbortSignal);
  });

  it('preserves the existing init fields and adds a signal', () => {
    const out = withTimeout({ method: 'PUT', headers: { 'Content-Type': 'application/json' } });
    expect(out.method).toBe('PUT');
    expect(out.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(out.signal).toBeInstanceOf(AbortSignal);
  });

  it('composes caller cancellation with the timeout', () => {
    const controller = new AbortController();
    const init: RequestInit = { signal: controller.signal };
    const out = withTimeout(init);
    const { signal } = out;
    if (!signal) throw new Error('missing composed signal');
    expect(out).not.toBe(init);
    expect(signal.aborted).toBe(false);
    controller.abort(new Error('superseded'));
    expect(signal.aborted).toBe(true);
    expect((signal.reason as Error).message).toBe('superseded');
  });

  it('cleans up fallback listeners after either signal aborts', async () => {
    const anyDescriptor = Object.getOwnPropertyDescriptor(AbortSignal, 'any');
    if (!anyDescriptor) throw new Error('AbortSignal.any descriptor is unavailable');
    Object.defineProperty(AbortSignal, 'any', { configurable: true, value: undefined });
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener');

    try {
      const { signal } = withTimeout({ signal: controller.signal }, 1);
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(signal?.aborted).toBe(true);
      expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
    } finally {
      Object.defineProperty(AbortSignal, 'any', anyDescriptor);
    }
  });

  it('defaults to an eight second timeout', () => {
    expect(DEFAULT_FETCH_TIMEOUT_MS).toBe(8000);
  });

  it('the added signal aborts with a TimeoutError when the timeout fires', async () => {
    const { signal } = withTimeout({}, 1);
    expect(signal?.aborted).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(signal?.aborted).toBe(true);
    const reason = signal?.reason as Error | undefined;
    expect(reason?.name).toBe('TimeoutError');
  });
});
