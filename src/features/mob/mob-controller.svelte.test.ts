import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type MobMark, MobStore } from '$entities/mob';
import { OwnVessel } from '$entities/vessel';
import type { GatedAlarm } from '$shared/audio';
import * as signalk from '$shared/signalk';
import { SignalKStore } from '$shared/signalk';
import { createFakeStorage, createFrameFactory } from '$shared/testing';
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

  it('resolves its v2 notification even while the real dynamic stream echo keeps MOB active', async () => {
    const post = deferred<string | undefined>();
    vi.mocked(signalk.postMobNotification).mockReturnValue(post.promise);
    vi.mocked(signalk.resolveNotification).mockResolvedValue(true);
    const store = new SignalKStore();
    const mob = new MobStore(store, new OwnVessel(store), undefined, createFakeStorage());
    const controller = createMobController({
      origin: 'http://sk',
      getToken: () => 'token',
      mob,
      mobAlarm: { update: vi.fn() } as unknown as GatedAlarm,
      units: { mode: 'metric' },
      notificationsApi: () => true,
      publishDelta: vi.fn(),
      flyTo: vi.fn(),
      goTo: vi.fn(async () => undefined),
    });

    controller.onTrigger({ epochMs: 1 });
    store.applyFrame(
      createFrameFactory()({
        'notifications.mob.mob-id': {
          id: 'mob-id',
          state: 'emergency',
          message: 'Man overboard',
        },
      }),
    );
    controller.onCancel();
    post.resolve('mob-id');
    await post.promise;
    await Promise.resolve();

    expect(signalk.resolveNotification).toHaveBeenCalledOnce();
    expect(signalk.resolveNotification).toHaveBeenCalledWith('http://sk', 'token', 'mob-id');
  });

  it('announces the bearing and range back to the mark while one is active', () => {
    vi.mocked(signalk.postMobNotification).mockResolvedValue('mob-id');
    const store = new SignalKStore();
    const vessel = new OwnVessel(store);
    const mob = new MobStore(store, vessel, undefined, createFakeStorage());
    const controller = createMobController({
      origin: 'http://sk',
      getToken: () => 'token',
      mob,
      mobAlarm: { update: vi.fn() } as unknown as GatedAlarm,
      units: { mode: 'metric' },
      notificationsApi: () => false,
      publishDelta: vi.fn(),
      flyTo: vi.fn(),
      goTo: vi.fn(async () => undefined),
    });
    store.applyFrame(
      createFrameFactory()({ 'navigation.position': { latitude: 42, longitude: -83 } }),
    );

    controller.onTrigger({ epochMs: 1, position: { latitude: 42.001, longitude: -83 } });
    // 111 m rounds to the 10 m announcement step: quantized so the assertive region settles
    // between meaningful changes instead of restarting the screen reader on every fix.
    expect(controller.mobAlert).toBe(
      'Man overboard. Mark is 000 degrees, 110 meters. Steer back to the mark.',
    );

    // A sub-step drift leaves the announcement string identical, so the region does not re-fire.
    const before = controller.mobAlert;
    store.applyFrame(
      createFrameFactory()({ 'navigation.position': { latitude: 42.00002, longitude: -83 } }),
    );
    expect(controller.mobAlert).toBe(before);

    mob.acknowledge();
    expect(controller.mobAlert).toBe('');
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

  it('resolves streamed MOB notification ids with at most four concurrent requests', async () => {
    let active = 0;
    let peak = 0;
    const releases: Array<() => void> = [];
    vi.mocked(signalk.resolveNotification).mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          active += 1;
          peak = Math.max(peak, active);
          releases.push(() => {
            active -= 1;
            resolve(true);
          });
        }),
    );
    const { controller, mob } = setup();
    Object.defineProperty(mob, 'remoteNotificationIds', {
      configurable: true,
      get: () => Array.from({ length: 10 }, (_, index) => `mob-${index}`),
    });

    controller.onCancel();
    await Promise.resolve();
    expect(signalk.resolveNotification).toHaveBeenCalledTimes(4);
    expect(peak).toBe(4);
    while (releases.length > 0) {
      const batch = releases.splice(0);
      for (const release of batch) release();
      await Promise.resolve();
    }
    await Promise.resolve();
    expect(signalk.resolveNotification).toHaveBeenCalledTimes(10);
    expect(peak).toBe(4);
  });
});
