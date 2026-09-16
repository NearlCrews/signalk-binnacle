import * as Comlink from 'comlink';
import type { RadarFrame } from './radar-frame-core';

// The radar stream's connection state, surfaced from the worker so the controller can reflect it in
// the store: 'open' means the socket connected (awaiting the first spoke), 'closed' and 'error' mean
// the stream dropped or failed.
export type RadarStreamStatus = 'open' | 'error' | 'closed';

export interface RadarWorkerApi {
  open(
    url: string,
    spokesPerRev: number,
    maxSpokeLen: number,
    initialRange: number,
    flushHz: number,
    onFrame: (frame: RadarFrame) => void,
    onStatus: (status: RadarStreamStatus) => void,
  ): Promise<void>;
  recycle(buffer: ArrayBuffer): Promise<void>;
  close(): Promise<void>;
}

export interface RadarWorkerClient {
  open(
    url: string,
    spokesPerRev: number,
    maxSpokeLen: number,
    initialRange: number,
    flushHz: number,
    onFrame: (frame: RadarFrame) => void,
    onStatus: (status: RadarStreamStatus) => void,
  ): Promise<void>;
  // Hand a spent frame buffer back to the worker's pool, so flushes stop allocating. Fire and
  // forget: a recycle that races a close is simply dropped.
  recycle(buffer: ArrayBuffer): void;
  close(): Promise<void>;
  dispose(): void;
}

export function wrapRadarWorker(
  api: Comlink.Remote<RadarWorkerApi>,
  release: () => void,
  terminate: () => void,
  options: { failureSignal?: AbortSignal; openTimeoutMs?: number; closeTimeoutMs?: number } = {},
): RadarWorkerClient {
  let disposed = false;
  let onStreamStatus: ((status: RadarStreamStatus) => void) | undefined;
  const pending = new Set<(error: Error) => void>();
  const stop = (error: Error, report: boolean): void => {
    if (disposed) return;
    disposed = true;
    options.failureSignal?.removeEventListener('abort', failed);
    for (const reject of pending) reject(error);
    pending.clear();
    try {
      release();
    } finally {
      terminate();
    }
    if (report) onStreamStatus?.('error');
  };
  const failed = (): void => stop(new Error('Radar worker failed. Reconnecting.'), true);
  options.failureSignal?.addEventListener('abort', failed, { once: true });
  if (options.failureSignal?.aborted) failed();
  const bounded = (operation: () => Promise<void>, timeoutMs: number): Promise<void> => {
    if (disposed) return Promise.reject(new Error('Radar worker is unavailable.'));
    return new Promise<void>((resolve, reject) => {
      const settleError = (error: Error): void => {
        clearTimeout(timer);
        pending.delete(settleError);
        reject(error);
      };
      const timer = setTimeout(
        () => stop(new Error('Radar worker did not respond. Reconnecting.'), true),
        timeoutMs,
      );
      pending.add(settleError);
      try {
        void operation().then(
          () => {
            clearTimeout(timer);
            pending.delete(settleError);
            resolve();
          },
          (error: unknown) => {
            stop(error instanceof Error ? error : new Error('Radar worker failed.'), true);
          },
        );
      } catch (error) {
        stop(error instanceof Error ? error : new Error('Radar worker failed.'), true);
      }
    });
  };
  return {
    async open(url, spokesPerRev, maxSpokeLen, initialRange, flushHz, onFrame, onStatus) {
      onStreamStatus = onStatus;
      await bounded(
        () =>
          api.open(
            url,
            spokesPerRev,
            maxSpokeLen,
            initialRange,
            flushHz,
            Comlink.proxy(onFrame),
            Comlink.proxy(onStatus),
          ),
        options.openTimeoutMs ?? 8000,
      );
    },
    recycle(buffer) {
      if (disposed) return;
      void api.recycle(Comlink.transfer(buffer, [buffer])).catch((e) => {
        // A recycle that lands after the worker closed just forfeits the buffer; warn unconditionally,
        // matching this file's other stream-error logging, so an unexpected failure (not just the
        // race-against-close case) is visible in production too, not only during development.
        console.warn('[marine-radar] recycle failed', e);
      });
    },
    async close() {
      if (!disposed) await bounded(() => api.close(), options.closeTimeoutMs ?? 2000);
    },
    dispose() {
      stop(new Error('Radar worker closed.'), false);
    },
  };
}

export function createRadarWorkerClient(): RadarWorkerClient {
  const worker = new Worker(new URL('./radar-worker.ts', import.meta.url), { type: 'module' });
  const failure = new AbortController();
  worker.onerror = (event) => {
    failure.abort();
    // A worker that fails to load often has an empty message; the filename and line locate it.
    console.error('Radar worker failed to load or threw', {
      message: event.message,
      filename: event.filename,
      lineno: event.lineno,
    });
  };
  worker.onmessageerror = (event) => {
    failure.abort();
    console.error('Radar worker message could not be deserialized', event);
  };
  const api = Comlink.wrap<RadarWorkerApi>(worker);
  return wrapRadarWorker(
    api,
    () => api[Comlink.releaseProxy](),
    () => worker.terminate(),
    { failureSignal: failure.signal },
  );
}
