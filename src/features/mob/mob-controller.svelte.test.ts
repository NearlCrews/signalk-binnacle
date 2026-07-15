import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MobMark, MobStore } from '$entities/mob';
import type { GatedAlarm } from '$shared/audio';
import * as signalk from '$shared/signalk';
import { createMobController } from './mob-controller.svelte';

vi.mock('$shared/signalk', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$shared/signalk')>()),
  postMobNotification: vi.fn(),
  resolveNotification: vi.fn(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function setup() {
  const mobState = {
    active: false,
    acknowledged: false,
    position: undefined,
    trigger: vi.fn((mark?: MobMark) => {
      mobState.active = true;
      return mark ?? { epochMs: 1 };
    }),
    cancel: vi.fn(() => {
      mobState.active = false;
    }),
  };
  const mob = mobState as unknown as MobStore;
  const publishDelta = vi.fn();
  const controller = createMobController({
    origin: 'http://sk',
    getToken: () => 'token',
    mob,
    mobAlarm: { update: vi.fn() } as unknown as GatedAlarm,
    units: { mode: 'metric' },
    notificationsApi: () => true,
    publishDelta,
    flyTo: vi.fn(),
    goTo: vi.fn(async () => undefined),
  });
  return { controller, mob, publishDelta };
}

describe('createMobController', () => {
  beforeEach(() => vi.clearAllMocks());

  it('resolves its v2 notification even while the stream echo keeps MOB active', async () => {
    const post = deferred<string | undefined>();
    vi.mocked(signalk.postMobNotification).mockReturnValue(post.promise);
    vi.mocked(signalk.resolveNotification).mockResolvedValue(true);
    const { controller, mob } = setup();

    controller.onTrigger({ epochMs: 1 });
    controller.onCancel();
    // Simulate the local v2 notification echoing through the stream after the local mark cleared.
    (mob as unknown as { active: boolean }).active = true;
    post.resolve('mob-id');
    await post.promise;
    await Promise.resolve();

    expect(signalk.resolveNotification).toHaveBeenCalledWith('http://sk', 'token', 'mob-id');
  });

  it('retains and clears every v2 raise after repeated triggers', async () => {
    const first = deferred<string | undefined>();
    const second = deferred<string | undefined>();
    vi.mocked(signalk.postMobNotification)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    vi.mocked(signalk.resolveNotification).mockResolvedValue(true);
    const { controller } = setup();

    controller.onTrigger({ epochMs: 1 });
    controller.onTrigger({ epochMs: 2 });
    controller.onCancel();
    first.resolve('first-id');
    second.resolve('second-id');
    await Promise.all([first.promise, second.promise]);
    await Promise.resolve();

    expect(signalk.resolveNotification).toHaveBeenCalledTimes(2);
    expect(signalk.resolveNotification).toHaveBeenCalledWith('http://sk', 'token', 'first-id');
    expect(signalk.resolveNotification).toHaveBeenCalledWith('http://sk', 'token', 'second-id');
  });
});
