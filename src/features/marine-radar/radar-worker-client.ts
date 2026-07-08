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
): RadarWorkerClient {
  return {
    async open(url, spokesPerRev, maxSpokeLen, initialRange, flushHz, onFrame, onStatus) {
      await api.open(
        url,
        spokesPerRev,
        maxSpokeLen,
        initialRange,
        flushHz,
        Comlink.proxy(onFrame),
        Comlink.proxy(onStatus),
      );
    },
    recycle(buffer) {
      void api.recycle(Comlink.transfer(buffer, [buffer])).catch((e) => {
        // A recycle that lands after the worker closed just forfeits the buffer; warn unconditionally,
        // matching this file's other stream-error logging, so an unexpected failure (not just the
        // race-against-close case) is visible in production too, not only during development.
        console.warn('[marine-radar] recycle failed', e);
      });
    },
    async close() {
      await api.close();
    },
    dispose() {
      release();
      terminate();
    },
  };
}

export function createRadarWorkerClient(): RadarWorkerClient {
  const worker = new Worker(new URL('./radar-worker.ts', import.meta.url), { type: 'module' });
  worker.onerror = (event) => {
    // A worker that fails to load often has an empty message; the filename and line locate it.
    console.error('Radar worker failed to load or threw', {
      message: event.message,
      filename: event.filename,
      lineno: event.lineno,
    });
  };
  worker.onmessageerror = (event) => {
    console.error('Radar worker message could not be deserialized', event);
  };
  const api = Comlink.wrap<RadarWorkerApi>(worker);
  return wrapRadarWorker(
    api,
    () => api[Comlink.releaseProxy](),
    () => worker.terminate(),
  );
}
