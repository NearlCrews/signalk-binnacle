import { describe, expect, it } from 'vitest';
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

  it('leaves an init that already owns a signal untouched', () => {
    const controller = new AbortController();
    const init: RequestInit = { signal: controller.signal };
    expect(withTimeout(init)).toBe(init);
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
