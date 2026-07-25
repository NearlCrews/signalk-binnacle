import { describe, expect, it, vi } from 'vitest';
import type { SkNotification } from '$features/lookout';
import {
  type CollisionNotificationPublisherDeps,
  createCollisionNotificationPublisher,
} from './collision-notification-publisher';

const ALARM: SkNotification = { state: 'alarm', method: ['visual', 'sound'], message: 'Danger' };
const ALARM_CLOSER: SkNotification = {
  state: 'alarm',
  method: ['visual', 'sound'],
  message: 'Danger closer',
};
const WARNING: SkNotification = { state: 'warn', method: ['visual'], message: 'Warning' };
const CLEAR: SkNotification = { state: 'normal', method: [], message: 'Clear' };
const PATH = 'notifications.navigation.collision';

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
    const raising = publisher.publish(PATH, ALARM);
    const clearing = publisher.publish(PATH, CLEAR);
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
    await publisher.publish(PATH, ALARM);
    const updating = publisher.publish(PATH, ALARM_CLOSER);
    const clearing = publisher.publish(PATH, CLEAR);

    held.resolve('updated');
    await Promise.all([updating, clearing]);

    expect(update).toHaveBeenCalledOnce();
    expect(resolve).toHaveBeenCalledWith('http://sk', 'token', 'alert-1');
  });

  it('publishes a warn through the delta even when the API is available', async () => {
    const { publisher, post, update, publishDelta } = setup();
    await publisher.publish(PATH, WARNING);

    expect(post).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(publishDelta).toHaveBeenCalledWith(PATH, WARNING);
  });

  it('resolves the REST alarm and publishes a delta when the state drops to warn', async () => {
    const { publisher, update, resolve, publishDelta } = setup();
    await publisher.publish(PATH, ALARM);
    await publisher.publish(PATH, WARNING);

    expect(update).not.toHaveBeenCalled();
    expect(resolve).toHaveBeenCalledWith('http://sk', 'token', 'alert-1');
    expect(publishDelta).toHaveBeenCalledWith(PATH, WARNING);
    expect(publisher.alertId).toBeUndefined();
  });

  it('retracts the warn delta when the state escalates to a REST alarm', async () => {
    const publishDelta = vi.fn();
    const { publisher, post } = setup({ publishDelta });
    await publisher.publish(PATH, WARNING);
    await publisher.publish(PATH, ALARM);

    expect(post).toHaveBeenCalledOnce();
    // Without the retraction, the ws-source value stays pinned at warn forever: the later clear
    // resolves the REST alarm and, seeing no active delta, never publishes a normal delta.
    expect(publishDelta).toHaveBeenLastCalledWith(
      PATH,
      expect.objectContaining({ state: 'normal' }),
    );

    publishDelta.mockClear();
    await publisher.publish(PATH, CLEAR);
    expect(publishDelta).not.toHaveBeenCalled();
    expect(publisher.alertId).toBeUndefined();
  });

  it('retracts the outage delta once a returned API accepts a fresh alarm', async () => {
    let available = false;
    const { publisher, post, publishDelta } = setup({ apiAvailable: () => available });
    await publisher.publish(PATH, ALARM);
    expect(publishDelta).toHaveBeenCalledWith(PATH, ALARM);

    available = true;
    await publisher.publish(PATH, ALARM_CLOSER);
    expect(post).toHaveBeenCalledOnce();
    expect(publishDelta).toHaveBeenLastCalledWith(
      PATH,
      expect.objectContaining({ state: 'normal' }),
    );
  });

  it('posts through REST for an alarm with the canonical notification path', async () => {
    const { publisher, post } = setup();
    await publisher.publish(PATH, ALARM);

    // postNotification itself strips the 'notifications.' prefix the wire format re-adds, so the
    // publisher hands over the one canonical path.
    expect(post).toHaveBeenCalledWith(
      'http://sk',
      'token',
      expect.objectContaining({ state: 'alarm', path: PATH }),
    );
  });

  it('resolves an orphaned REST alarm once the API is reachable again', async () => {
    let available = true;
    const { publisher, resolve } = setup({ apiAvailable: () => available });
    await publisher.publish(PATH, ALARM);

    available = false;
    await publisher.publish(PATH, CLEAR);
    expect(resolve).not.toHaveBeenCalled();

    available = true;
    await publisher.publish(PATH, ALARM);
    expect(resolve).toHaveBeenCalledWith('http://sk', 'token', 'alert-1');
  });

  it('clears a delta fallback when the REST raise failed', async () => {
    const { publisher, publishDelta } = setup({ post: vi.fn(async () => undefined) });
    await publisher.publish(PATH, ALARM);
    await publisher.publish(PATH, CLEAR);

    expect(publishDelta).toHaveBeenNthCalledWith(1, PATH, ALARM);
    expect(publishDelta).toHaveBeenNthCalledWith(2, PATH, CLEAR);
  });

  it('coalesces queued updates to the latest assessment', async () => {
    const held = deferred<string | undefined>();
    const { publisher, update } = setup({ post: vi.fn(() => held.promise) });
    const first = publisher.publish(PATH, ALARM);
    void publisher.publish(PATH, WARNING);
    void publisher.publish(PATH, CLEAR);

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
    const raising = publisher.publish(PATH, ALARM);
    heldPost.resolve('alert-1');

    let clearing!: Promise<void>;
    queueMicrotask(() => {
      queueMicrotask(() => {
        clearing = publisher.publish(PATH, CLEAR);
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
