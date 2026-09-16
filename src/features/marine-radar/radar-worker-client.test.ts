import { afterEach, describe, expect, it, vi } from 'vitest';
import { wrapRadarWorker } from './radar-worker-client';

describe('wrapRadarWorker', () => {
  afterEach(() => vi.useRealTimers());
  it('forwards open and close to the wrapped api and disposes the proxy and worker', async () => {
    const api = {
      open: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const release = vi.fn();
    const terminate = vi.fn();
    const client = wrapRadarWorker(api as never, release, terminate);
    await client.open(
      'ws://x/spokes',
      2048,
      1024,
      1852,
      15,
      () => {},
      () => {},
    );
    expect(api.open).toHaveBeenCalledOnce();
    client.dispose();
    expect(release).toHaveBeenCalledOnce();
    expect(terminate).toHaveBeenCalledOnce();
  });

  it.each(['open', 'close'])(
    'bounds a hung %s call and terminates only once',
    async (operation) => {
      vi.useFakeTimers();
      const api = {
        open: vi.fn(() => new Promise<void>(() => {})),
        close: vi.fn(() => new Promise<void>(() => {})),
      };
      const release = vi.fn();
      const terminate = vi.fn();
      const status = vi.fn();
      const client = wrapRadarWorker(api as never, release, terminate, {
        openTimeoutMs: 20,
        closeTimeoutMs: 20,
      });
      const pending =
        operation === 'open' ? client.open('ws://x', 1, 1, 1, 1, () => {}, status) : client.close();
      const rejected = expect(pending).rejects.toThrow('did not respond');
      await vi.advanceTimersByTimeAsync(20);
      await rejected;
      client.dispose();
      await client.close();
      expect(terminate).toHaveBeenCalledOnce();
      expect(release).toHaveBeenCalledOnce();
      if (operation === 'open') expect(status).toHaveBeenCalledWith('error');
    },
  );

  it('rejects a pending open immediately on worker failure', async () => {
    const failure = new AbortController();
    const api = { open: vi.fn(() => new Promise<void>(() => {})) };
    const terminate = vi.fn();
    const status = vi.fn();
    const client = wrapRadarWorker(api as never, vi.fn(), terminate, {
      failureSignal: failure.signal,
    });
    const rejected = expect(client.open('ws://x', 1, 1, 1, 1, () => {}, status)).rejects.toThrow(
      'worker failed',
    );
    failure.abort();
    await rejected;
    expect(status).toHaveBeenCalledWith('error');
    expect(terminate).toHaveBeenCalledOnce();
  });
});
