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
  const client = {
    connect: vi.fn().mockResolvedValue(undefined),
    reconnect: vi.fn().mockResolvedValue(undefined),
    restart: vi.fn(),
    raw: { subscribe },
  } as unknown as SignalKClient;
  const onToken = vi.fn();
  const onFrame = vi.fn();
  const onInitialSubscription = vi.fn().mockResolvedValue(undefined);
  const onReconnect = vi.fn();
  const onWorkerRestart = vi.fn();
  const controller = createStreamController({
    client,
    store,
    net: net as unknown as OnlineStatus,
    accessResolved: () => access.resolved,
    token: () => access.token,
    onToken,
    onFrame,
    onInitialSubscription,
    onReconnect,
    onWorkerRestart,
  });
  return {
    access,
    client,
    controller,
    net,
    onFrame,
    onInitialSubscription,
    onReconnect,
    onToken,
    onWorkerRestart,
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
    await vi.waitFor(() => expect(test.onInitialSubscription).toHaveBeenCalledOnce());

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
    expect(test.subscribe.mock.invocationCallOrder[0]).toBeLessThan(
      test.onInitialSubscription.mock.invocationCallOrder[0],
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
    expect(test.onInitialSubscription).not.toHaveBeenCalled();

    test.controller.retry();
    await vi.waitFor(() => expect(test.onInitialSubscription).toHaveBeenCalledOnce());
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
    await vi.waitFor(() => expect(test.onInitialSubscription).toHaveBeenCalledOnce());
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

  it('hydrates reconnect-only data with the current token after a reopened stream', () => {
    const test = mount({ token: 'old token' });
    test.store.connection = { phase: 'open', attempt: 0 };
    flushSync();
    expect(test.onReconnect).not.toHaveBeenCalled();

    test.access.token = 'live token';
    test.store.connection = { phase: 'reconnecting', attempt: 1 };
    flushSync();
    test.store.connection = { phase: 'open', attempt: 1 };
    flushSync();

    expect(test.onReconnect).toHaveBeenCalledOnce();
    expect(test.onReconnect).toHaveBeenCalledWith('live token');
  });
});
