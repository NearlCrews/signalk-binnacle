import { flushSync } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OnlineStatus } from '$shared/pwa';
import { type SignalKClient, SignalKStore, SK_PATHS } from '$shared/signalk';
import { createStreamController } from './stream-controller.svelte';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (cause?: unknown) => void;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function setup(options: { accessResolved?: boolean; token?: string } = {}) {
  const access = $state({
    resolved: options.accessResolved ?? false,
    token: options.token as string | undefined,
  });
  const net = $state({ online: true });
  const store = new SignalKStore();
  const subscribe = vi.fn().mockResolvedValue(undefined);
  const setUrl = vi.fn().mockResolvedValue(undefined);
  const client = {
    connect: vi.fn().mockResolvedValue(undefined),
    reconnect: vi.fn().mockResolvedValue(undefined),
    restart: vi.fn(),
    raw: { subscribe, setUrl },
  } as unknown as SignalKClient;
  const onToken = vi.fn();
  const onFrame = vi.fn();
  const onOpen = vi.fn();
  const onWorkerRestart = vi.fn();
  const controller = createStreamController({
    client,
    store,
    net: net as unknown as OnlineStatus,
    accessResolved: () => access.resolved,
    token: () => access.token,
    onToken,
    onFrame,
    onOpen,
    onWorkerRestart,
  });
  return {
    access,
    client,
    controller,
    net,
    onFrame,
    onOpen,
    onToken,
    onWorkerRestart,
    setUrl,
    store,
    subscribe,
  };
}

const mountedCleanups: Array<() => void> = [];

function mount(options: { accessResolved?: boolean; token?: string } = {}) {
  let test!: ReturnType<typeof setup>;
  let disposeRoot!: () => void;
  flushSync(() => {
    disposeRoot = $effect.root(() => {
      test = setup(options);
    });
  });
  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    test.controller.dispose();
    disposeRoot();
  };
  mountedCleanups.push(cleanup);
  return { ...test, cleanup };
}

afterEach(() => {
  for (const cleanup of mountedCleanups.splice(0).reverse()) cleanup();
  vi.restoreAllMocks();
});

describe('createStreamController', () => {
  it('reacts to access resolution, then connects, subscribes, and hydrates in order', async () => {
    const test = mount({ token: 'old token' });
    expect(test.client.connect).not.toHaveBeenCalled();

    test.access.token = 'read token';
    test.access.resolved = true;
    flushSync();
    await vi.waitFor(() => expect(test.subscribe).toHaveBeenCalledOnce());

    expect(test.client.restart).not.toHaveBeenCalled();
    expect(test.onWorkerRestart).not.toHaveBeenCalled();
    expect(test.onToken).toHaveBeenCalledWith('read token');
    const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
    expect(test.client.connect).toHaveBeenCalledWith(
      `${scheme}//${location.host}/signalk/v1/stream?token=read%20token`,
      test.onFrame,
    );
    expect(test.subscribe).toHaveBeenCalledOnce();
    const subscriptions = test.subscribe.mock.calls[0]?.[0] as Array<{
      path: string;
      context?: string;
      policy: string;
      minPeriod?: number;
      period?: number;
    }>;
    expect(subscriptions).toEqual(
      expect.arrayContaining([
        { path: SK_PATHS.position, policy: 'instant', minPeriod: 1000 },
        { path: SK_PATHS.name, policy: 'instant', minPeriod: 5000 },
        { path: SK_PATHS.mmsi, policy: 'instant', minPeriod: 5000 },
        { path: SK_PATHS.callsignVhf, policy: 'instant', minPeriod: 5000 },
        { path: SK_PATHS.allNotifications, policy: 'instant', minPeriod: 1000 },
        {
          path: SK_PATHS.closestApproach,
          context: 'vessels.*',
          policy: 'fixed',
          period: 5000,
        },
      ]),
    );
    expect(vi.mocked(test.client.connect).mock.invocationCallOrder[0]).toBeLessThan(
      test.subscribe.mock.invocationCallOrder[0],
    );
    expect(test.controller.error).toBe(false);
  });

  it('surfaces an initial failure and retries with a fresh worker', async () => {
    const error = new Error('worker failed');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const test = mount();
    vi.mocked(test.client.connect).mockRejectedValueOnce(error).mockResolvedValueOnce(undefined);

    test.access.resolved = true;
    flushSync();
    await vi.waitFor(() => expect(test.controller.error).toBe(true));
    expect(consoleError).toHaveBeenCalledWith('Signal K stream failed to connect', error);
    expect(test.subscribe).not.toHaveBeenCalled();

    test.controller.retry();
    await vi.waitFor(() => expect(test.subscribe).toHaveBeenCalledOnce());
    expect(test.client.restart).toHaveBeenCalledOnce();
    expect(test.onWorkerRestart).toHaveBeenCalledOnce();
    expect(test.controller.error).toBe(false);
  });

  it('uses the worker reconnect path, then escalates a failure to a full retry', async () => {
    const reconnectError = new Error('socket failed');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const test = mount();
    vi.mocked(test.client.reconnect).mockRejectedValueOnce(reconnectError);

    test.controller.reconnect();
    await vi.waitFor(() => expect(test.controller.error).toBe(true));
    expect(test.client.reconnect).toHaveBeenCalledOnce();
    expect(test.client.restart).not.toHaveBeenCalled();

    test.access.resolved = true;
    test.controller.reconnect();
    await vi.waitFor(() => expect(test.subscribe).toHaveBeenCalledOnce());
    expect(test.client.restart).toHaveBeenCalledOnce();
    expect(test.controller.error).toBe(false);
  });

  it('ignores a pending connection failure after disposal', async () => {
    const pending = deferred<void>();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const test = mount();
    vi.mocked(test.client.connect).mockReturnValueOnce(pending.promise);

    test.access.resolved = true;
    flushSync();
    await vi.waitFor(() => expect(test.client.connect).toHaveBeenCalledOnce());
    test.cleanup();
    pending.reject(new Error('late failure'));
    await expect(pending.promise).rejects.toThrow('late failure');
    await Promise.resolve();

    expect(test.controller.error).toBe(false);
    expect(test.subscribe).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('reconnects when the browser comes back online while the stream is down', async () => {
    const test = mount();
    test.net.online = false;
    test.store.connection = { phase: 'closed', attempt: 1 };
    flushSync();
    expect(test.client.reconnect).not.toHaveBeenCalled();

    test.net.online = true;
    flushSync();
    await vi.waitFor(() => expect(test.client.reconnect).toHaveBeenCalledOnce());
  });

  it('hands every open edge the current token, so reconnect refreshes never use a stale one', () => {
    const test = mount({ token: 'old token' });
    test.store.connection = { phase: 'open', attempt: 0 };
    flushSync();
    expect(test.onOpen).toHaveBeenCalledWith(true, 'old token');

    test.access.token = 'live token';
    test.store.connection = { phase: 'reconnecting', attempt: 1 };
    flushSync();
    test.store.connection = { phase: 'open', attempt: 1 };
    flushSync();

    expect(test.onOpen).toHaveBeenCalledTimes(2);
    expect(test.onOpen).toHaveBeenLastCalledWith(false, 'live token');
  });

  it('invokes onOpen on every open edge, marking only the first as the first', () => {
    const test = mount();
    test.store.connection = { phase: 'open', attempt: 0 };
    flushSync();
    // The first open gets the hook even though it is not a reconnect: a failed pre-open REST
    // hydrate would otherwise never be retried until a later outage. It is marked as the first,
    // so replay logic that must wait for the reconnect reconcile on later opens can still run
    // immediately here.
    expect(test.onOpen).toHaveBeenCalledOnce();
    expect(test.onOpen).toHaveBeenCalledWith(true, undefined);

    test.store.connection = { phase: 'reconnecting', attempt: 1 };
    flushSync();
    test.store.connection = { phase: 'open', attempt: 1 };
    flushSync();
    expect(test.onOpen).toHaveBeenCalledTimes(2);
    expect(test.onOpen).toHaveBeenLastCalledWith(false, undefined);
  });

  it('pushes a changed token into the worker stream URL for the next reconnect', async () => {
    const test = mount({ token: 'read token' });
    test.access.resolved = true;
    flushSync();
    await vi.waitFor(() => expect(test.subscribe).toHaveBeenCalledOnce());
    expect(test.setUrl).not.toHaveBeenCalled();

    test.access.token = 'rw token';
    flushSync();
    const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
    expect(test.setUrl).toHaveBeenCalledWith(
      `${scheme}//${location.host}/signalk/v1/stream?token=rw%20token`,
    );
    expect(test.onToken).toHaveBeenLastCalledWith('rw token');
    // The live socket is healthy, so no forced reconnect.
    expect(test.client.reconnect).not.toHaveBeenCalled();
  });

  it('reconnects immediately on a token change while the stream is down', async () => {
    const test = mount({ token: 'read token' });
    test.access.resolved = true;
    flushSync();
    await vi.waitFor(() => expect(test.subscribe).toHaveBeenCalledOnce());

    test.store.connection = { phase: 'reconnecting', attempt: 3 };
    test.access.token = 'rw token';
    flushSync();
    await vi.waitFor(() => expect(test.client.reconnect).toHaveBeenCalledOnce());
    expect(test.setUrl).toHaveBeenCalledOnce();
  });

  it('turns a reported worker failure into the worker-restarting retry state', async () => {
    const test = mount({ token: 'tok' });
    test.access.resolved = true;
    flushSync();
    await vi.waitFor(() => expect(test.subscribe).toHaveBeenCalledOnce());
    expect(test.controller.error).toBe(false);

    test.controller.onWorkerFailure();
    expect(test.controller.error).toBe(true);

    // The Reconnect action now escalates to a full retry, restarting the dead worker.
    test.controller.reconnect();
    await vi.waitFor(() => expect(test.client.restart).toHaveBeenCalledOnce());
    expect(test.onWorkerRestart).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(test.controller.error).toBe(false));
    expect(test.client.reconnect).not.toHaveBeenCalled();
  });

  it('clears a spurious worker failure once a live open frame proves the stream healthy', async () => {
    const test = mount({ token: 'tok' });
    test.access.resolved = true;
    flushSync();
    await vi.waitFor(() => expect(test.subscribe).toHaveBeenCalledOnce());

    // Worker.onerror also fires for non-fatal uncaught exceptions. The synthesized closed frame
    // is then overwritten by a real flush from the still-healthy socket, and that open edge must
    // release the error latch instead of leaving auto-reconnect disabled for the session.
    test.controller.onWorkerFailure();
    expect(test.controller.error).toBe(true);
    test.store.applyFrame({
      self: new Map(),
      connection: { phase: 'closed', attempt: 0 },
      epoch: 1,
    });
    flushSync();
    test.store.applyFrame({ self: new Map(), connection: { phase: 'open', attempt: 0 }, epoch: 2 });
    flushSync();
    expect(test.controller.error).toBe(false);
    // The healthy socket is left alone: no redial happened on the recovery.
    expect(test.client.connect).toHaveBeenCalledOnce();
  });

  it('reopens the socket when the token changed while the connect was in flight', async () => {
    const test = mount({ token: 'old' });
    const gate = deferred<void>();
    test.subscribe.mockReturnValueOnce(gate.promise);
    test.access.resolved = true;
    flushSync();
    await vi.waitFor(() => expect(test.client.connect).toHaveBeenCalledOnce());
    // The socket comes up mid-connect, so the token effect's down-stream reconnect arm is
    // genuinely not applicable, not just vacuously skipped by a transitional phase.
    test.store.applyFrame({ self: new Map(), connection: { phase: 'open', attempt: 0 }, epoch: 1 });
    flushSync();

    // A write upgrade lands mid-connect: the token effect pushes the new URL but its reconnect
    // arm leaves the live socket alone, so connect itself owes the reopen, or the socket stays
    // on the revocable old grant.
    test.access.token = 'new';
    flushSync();
    await vi.waitFor(() => expect(test.setUrl).toHaveBeenCalled());
    expect(test.client.reconnect).not.toHaveBeenCalled();

    gate.resolve();
    await vi.waitFor(() => expect(test.client.reconnect).toHaveBeenCalledOnce());
  });

  it('releases a hung worker reconnect into the error state instead of latching forever', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.useFakeTimers();
    try {
      const test = mount();
      vi.mocked(test.client.reconnect).mockReturnValueOnce(new Promise<void>(() => {}));
      test.controller.reconnect();
      expect(test.controller.error).toBe(false);

      await vi.advanceTimersByTimeAsync(10_000);
      expect(test.controller.error).toBe(true);

      // The connecting latch is released: retry is reachable and restarts the worker.
      test.access.resolved = true;
      test.controller.reconnect();
      await vi.advanceTimersByTimeAsync(0);
      expect(test.client.restart).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});
