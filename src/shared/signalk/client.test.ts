import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const comlink = vi.hoisted(() => ({
  releaseProxy: Symbol('releaseProxy'),
  proxy: vi.fn(<T>(value: T) => value),
  wrap: vi.fn(),
}));

vi.mock('comlink', () => comlink);

import { createSignalKClient } from './client';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const workers: TestWorker[] = [];

class TestWorker {
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  terminate = vi.fn();
  remote = {
    connect: vi.fn(async () => undefined),
    publish: vi.fn(async () => undefined),
    reconnect: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
    [comlink.releaseProxy]: vi.fn(),
  };

  constructor() {
    workers.push(this);
  }
}

describe('createSignalKClient', () => {
  beforeEach(() => {
    workers.length = 0;
    vi.stubGlobal('Worker', TestWorker);
    comlink.wrap.mockImplementation((worker: TestWorker) => worker.remote);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('keeps worker failure callbacks scoped to the connect that created them', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const client = createSignalKClient();
    const firstPending = deferred<undefined>();
    workers[0].remote.connect.mockImplementation(() => firstPending.promise);
    const firstConnect = client.connect('ws://first', vi.fn());

    client.restart();
    expect(workers).toHaveLength(2);
    const secondPending = deferred<undefined>();
    workers[1].remote.connect.mockImplementation(() => secondPending.promise);
    const secondConnect = client.connect('ws://second', vi.fn());

    await expect(firstConnect).rejects.toThrow('restarted while connecting');
    workers[0].onerror?.({ message: 'stale failure' } as ErrorEvent);
    workers[1].onerror?.({ message: 'current failure' } as ErrorEvent);

    await expect(secondConnect).rejects.toThrow('current failure');
    expect(workers[0].terminate).toHaveBeenCalledOnce();
    client.dispose();
  });

  it('ignores a stale worker error after a restart', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const client = createSignalKClient();
    const firstSink = vi.fn();
    await client.connect('ws://first', firstSink);

    client.restart();
    const currentSink = vi.fn();
    await client.connect('ws://second', currentSink);
    workers[0].onerror?.({ message: 'stale failure' } as ErrorEvent);
    expect(firstSink).not.toHaveBeenCalled();
    expect(currentSink).not.toHaveBeenCalled();

    workers[1].onerror?.({ message: 'current failure' } as ErrorEvent);
    expect(currentSink).toHaveBeenCalledWith(
      expect.objectContaining({ connection: { phase: 'closed', attempt: 0 } }),
    );
    client.dispose();
  });

  it('ignores queued frame callbacks from a replaced worker', async () => {
    const client = createSignalKClient();
    const firstSink = vi.fn();
    await client.connect('ws://first', firstSink);
    const firstCallback = (workers[0].remote.connect.mock.calls as unknown[][])[0]?.[1] as (
      frame: unknown,
    ) => void;

    client.restart();
    const currentSink = vi.fn();
    await client.connect('ws://second', currentSink);
    const currentCallback = (workers[1].remote.connect.mock.calls as unknown[][])[0]?.[1] as (
      frame: unknown,
    ) => void;
    const frame = { connection: { phase: 'open', attempt: 0 } };

    firstCallback(frame);
    currentCallback(frame);

    expect(firstSink).not.toHaveBeenCalled();
    expect(currentSink).toHaveBeenCalledWith(frame);
    client.dispose();
  });
});
