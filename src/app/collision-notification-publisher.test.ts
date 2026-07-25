import { describe, expect, it, vi } from 'vitest';
import type { SkNotification } from '$features/lookout';
import {
  type CollisionNotificationPublisherDeps,
  createCollisionNotificationPublisher,
} from './collision-notification-publisher';

const ALARM: SkNotification = { state: 'alarm', method: ['visual'], message: 'Danger' };
const WARNING: SkNotification = { state: 'warn', method: ['visual'], message: 'Warning' };
const CLEAR: SkNotification = { state: 'normal', method: [], message: 'Clear' };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => (resolve = accept));
  return { promise, resolve };
}

function setup(overrides: Partial<CollisionNotificationPublisherDeps> = {}) {
  const publishDelta = vi.fn();
  const post = vi.fn(async () => 'alert-1');
  const resolve = vi.fn(async () => true);
  const update = vi.fn(async () => 'updated' as const);
  const deps: CollisionNotificationPublisherDeps = {
    origin: 'http://sk',
    token: () => 'token',
    apiAvailable: () => true,
    publishDelta,
    post,
    resolve,
    update,
    ...overrides,
  };
  const publisher = createCollisionNotificationPublisher(deps);
  return {
    publisher,
    publishDelta: deps.publishDelta,
    post: deps.post ?? post,
    resolve: deps.resolve ?? resolve,
    update: deps.update ?? update,
  };
}

describe('createCollisionNotificationPublisher', () => {
  it('resolves a raise that finishes after a clear was queued', async () => {
    const held = deferred<string | undefined>();
    const { publisher, post, resolve } = setup({ post: vi.fn(() => held.promise) });
    const raising = publisher.publish('notifications.navigation.collision', ALARM);
    const clearing = publisher.publish('notifications.navigation.collision', CLEAR);
    expect(resolve).not.toHaveBeenCalled();

    held.resolve('alert-1');
    await Promise.all([raising, clearing]);

    expect(post).toHaveBeenCalledOnce();
    expect(resolve).toHaveBeenCalledWith('http://sk', 'token', 'alert-1');
    expect(publisher.alertId).toBeUndefined();
  });

  it('runs a queued clear after an in-flight update', async () => {
    const held = deferred<'updated' | 'missing' | 'failed'>();
    const { publisher, update, resolve } = setup({ update: vi.fn(() => held.promise) });
    await publisher.publish('notifications.navigation.collision', ALARM);
    const updating = publisher.publish('notifications.navigation.collision', WARNING);
    const clearing = publisher.publish('notifications.navigation.collision', CLEAR);

    held.resolve('updated');
    await Promise.all([updating, clearing]);

    expect(update).toHaveBeenCalledOnce();
    expect(resolve).toHaveBeenCalledWith('http://sk', 'token', 'alert-1');
  });

  it('clears a delta fallback when the REST raise failed', async () => {
    const { publisher, publishDelta } = setup({ post: vi.fn(async () => undefined) });
    await publisher.publish('notifications.navigation.collision', ALARM);
    await publisher.publish('notifications.navigation.collision', CLEAR);

    expect(publishDelta).toHaveBeenNthCalledWith(1, 'notifications.navigation.collision', ALARM);
    expect(publishDelta).toHaveBeenNthCalledWith(2, 'notifications.navigation.collision', CLEAR);
  });

  it('coalesces queued updates to the latest assessment', async () => {
    const held = deferred<string | undefined>();
    const { publisher, update } = setup({ post: vi.fn(() => held.promise) });
    const first = publisher.publish('notifications.navigation.collision', ALARM);
    void publisher.publish('notifications.navigation.collision', WARNING);
    void publisher.publish('notifications.navigation.collision', CLEAR);

    held.resolve('alert-1');
    await first;

    expect(update).not.toHaveBeenCalled();
    expect(publisher.alertId).toBeUndefined();
  });

  it('returns the successor drain when a publication lands at the completion boundary', async () => {
    const heldPost = deferred<string | undefined>();
    const heldResolve = deferred<boolean>();
    const { publisher, resolve } = setup({
      post: vi.fn(() => heldPost.promise),
      resolve: vi.fn(() => heldResolve.promise),
    });
    const raising = publisher.publish('notifications.navigation.collision', ALARM);
    heldPost.resolve('alert-1');

    let clearing!: Promise<void>;
    queueMicrotask(() => {
      queueMicrotask(() => {
        clearing = publisher.publish('notifications.navigation.collision', CLEAR);
      });
    });
    await vi.waitFor(() => expect(resolve).toHaveBeenCalledOnce());
    let clearingSettled = false;
    void clearing.then(() => {
      clearingSettled = true;
    });
    await Promise.resolve();
    expect(clearingSettled).toBe(false);

    heldResolve.resolve(true);
    await Promise.all([raising, clearing]);
    expect(clearingSettled).toBe(true);
  });
});
