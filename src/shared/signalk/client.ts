import * as Comlink from 'comlink';
import type { Delta, SignalKClientApi, SKFrame } from './types';

export interface SignalKClient {
  connect(url: string, onFrame: (frame: SKFrame) => void): Promise<void>;
  publish(delta: Delta): Promise<void>;
  reconnect(): Promise<void>;
  disconnect(): Promise<void>;
  // Recreate the worker after an initial script or Comlink failure. The caller reconnects and
  // resubscribes afterward, so a transient chunk-load fault does not require a full page reload.
  restart(): void;
  // Release the Comlink proxy and terminate the worker. The worker is page-lifetime in production,
  // so this is teardown hygiene: without it an HMR reload or a test remount leaks the worker and the
  // MessagePort the wrapped proxy holds.
  dispose(): void;
  raw: Comlink.Remote<SignalKClientApi>;
}

export function createSignalKClient(): SignalKClient {
  let worker: Worker;
  let raw: Comlink.Remote<SignalKClientApi>;
  // A worker that fails to load (the "Class extends value undefined" trap, a chunk miss) otherwise
  // dies silently: the Comlink call to connect() never resolves or rejects, so the UI looks
  // identical to "still connecting". Capture the first load error and reject any in-flight connect()
  // with it, so the caller (App.svelte) surfaces the failure instead of latching on forever.
  let rejectPendingConnect: ((error: Error) => void) | undefined;
  // The most recent frame sink, captured at connect. A worker crash AFTER the initial connect would
  // otherwise only log to console: the socket dies with the worker but no frame is ever emitted, so
  // the connection badge keeps reading its last live phase while data silently stops. Emitting a
  // closed-connection frame here flips the badge to disconnected so the failure is visible.
  let onFrameRef: ((frame: SKFrame) => void) | undefined;
  const spawn = (): void => {
    const nextWorker = new Worker(new URL('./sk.worker.ts', import.meta.url), { type: 'module' });
    worker = nextWorker;
    nextWorker.onerror = (event) => {
      if (worker !== nextWorker) return;
      const error = new Error(
        `Signal K worker failed to load or threw: ${event.message ?? 'unknown'}`,
      );
      console.error(error.message, event);
      if (rejectPendingConnect) {
        rejectPendingConnect(error);
        return;
      }
      onFrameRef?.({
        self: new Map(),
        connection: { phase: 'closed', attempt: 0 },
        epoch: Date.now(),
      });
    };
    nextWorker.onmessageerror = (event) => {
      if (worker === nextWorker) {
        console.error('Signal K worker message could not be deserialized', event);
      }
    };
    raw = Comlink.wrap<SignalKClientApi>(nextWorker);
  };

  const releaseWorker = (): void => {
    raw[Comlink.releaseProxy]();
    worker.terminate();
  };

  spawn();
  return {
    get raw() {
      return raw;
    },
    async connect(url, onFrame) {
      onFrameRef = onFrame;
      // The worker side releases the previous call's callback proxy before replacing it (see
      // WorkerCore.connect), so a reconnect does not leak a MessagePort. Comlink.proxy() only marks
      // this same function object; it carries no releaseProxy of its own to release here.
      const workerFailed = new Promise<never>((_, reject) => {
        rejectPendingConnect = reject;
      });
      try {
        await Promise.race([raw.connect(url, Comlink.proxy(onFrame)), workerFailed]);
      } finally {
        rejectPendingConnect = undefined;
      }
    },
    async publish(delta) {
      await raw.publish(delta);
    },
    async reconnect() {
      await raw.reconnect();
    },
    async disconnect() {
      await raw.disconnect();
    },
    restart() {
      rejectPendingConnect = undefined;
      releaseWorker();
      spawn();
    },
    dispose() {
      releaseWorker();
    },
  };
}
