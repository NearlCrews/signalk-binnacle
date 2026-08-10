import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type MobMark, MobStore } from '$entities/mob';
import { OwnVessel } from '$entities/vessel';
import type { GatedAlarm } from '$shared/audio';
import * as signalk from '$shared/signalk';
import { SignalKStore } from '$shared/signalk';
import { createFakeStorage, createFrameFactory } from '$shared/testing';
import { createMobController } from './mob-controller.svelte';
import { mobClearNotification, mobNotification } from './mob-notification';

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

// Enough turns for the cancel chain (Promise.all, the resolver pool, the async continuation).
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
}

type SetupFlags = Partial<Record<'notificationsApi' | 'writeBlocked' | 'streamOpen', boolean>>;

// The one deps literal for every construction in this file, so a dependency change is one edit.
// The flags object is read through getters, so a test mutating it steers the live controller.
function makeDeps(
  mob: MobStore,
  flags: { notificationsApi: boolean; writeBlocked: boolean; streamOpen: boolean },
) {
  return {
    origin: 'http://sk',
    getToken: () => 'token',
    mob,
    mobAlarm: { update: vi.fn() } as unknown as GatedAlarm,
    units: { mode: 'metric' as const },
    notificationsApi: () => flags.notificationsApi,
    writeBlocked: () => flags.writeBlocked,
    streamOpen: () => flags.streamOpen,
    publishDelta: vi.fn(),
    flyTo: vi.fn(),
    goTo: vi.fn(async () => undefined),
  };
}

function realStoreDeps(mob: MobStore, overrides: SetupFlags = {}) {
  return makeDeps(mob, {
    notificationsApi: true,
    writeBlocked: false,
    streamOpen: true,
    ...overrides,
  });
}

function setup(overrides: SetupFlags = {}) {
  const flags = { notificationsApi: true, writeBlocked: false, streamOpen: true, ...overrides };
  const mobState = {
    active: false,
    acknowledged: false,
    position: undefined,
    remoteActive: false,
    remoteNotificationIds: [] as string[],
    trigger: vi.fn((mark?: MobMark) => {
      mobState.active = true;
      return mark ?? { epochMs: 1 };
    }),
    cancel: vi.fn(() => {
      mobState.active = false;
    }),
  };
  const mob = mobState as unknown as MobStore;
  const deps = makeDeps(mob, flags);
  const controller = createMobController(deps);
  return { controller, mob, mobState, publishDelta: deps.publishDelta, flags };
}

describe('createMobController', () => {
  beforeEach(() => vi.clearAllMocks());

  it('resolves its v2 notification even while the real dynamic stream echo keeps MOB active', async () => {
    const post = deferred<string | undefined>();
    vi.mocked(signalk.postMobNotification).mockReturnValue(post.promise);
    vi.mocked(signalk.resolveNotification).mockResolvedValue(true);
    const store = new SignalKStore();
    const mob = new MobStore(store, new OwnVessel(store), undefined, createFakeStorage());
    const controller = createMobController(realStoreDeps(mob));

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
    const controller = createMobController(realStoreDeps(mob, { notificationsApi: false }));
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

  it('publishes the broad clear on the first cancel after a failed v2 raise', async () => {
    vi.mocked(signalk.postMobNotification).mockResolvedValue(undefined);
    vi.mocked(signalk.resolveNotification).mockResolvedValue(true);
    const { controller, publishDelta } = setup();

    controller.onTrigger({ epochMs: 1 });
    await flushMicrotasks();
    // The failed POST fell back to the broad v1 emergency, so the cancel owes the broad clear
    // even though no notification id ever came back.
    expect(publishDelta).toHaveBeenCalledWith(
      signalk.SK_PATHS.mobNotification,
      mobNotification(undefined),
    );
    controller.onCancel();
    await flushMicrotasks();
    expect(publishDelta).toHaveBeenLastCalledWith(
      signalk.SK_PATHS.mobNotification,
      mobClearNotification(),
    );
  });

  it('re-raises a v1 alarm lost to a dead socket once the stream reconnects', () => {
    const { controller, mobState, publishDelta, flags } = setup({
      notificationsApi: false,
      streamOpen: false,
    });

    controller.onTrigger({ epochMs: 1, position: { latitude: 1, longitude: 2 } });
    expect(publishDelta).toHaveBeenCalledTimes(1);
    flags.streamOpen = true;
    controller.onStreamReconnect();
    expect(publishDelta).toHaveBeenCalledTimes(2);
    expect(publishDelta).toHaveBeenLastCalledWith(
      signalk.SK_PATHS.mobNotification,
      mobNotification({ latitude: 1, longitude: 2 }),
    );
    // The stream echo has confirmed the alarm reached the server: no further re-raise.
    mobState.remoteActive = true;
    controller.onStreamReconnect();
    expect(publishDelta).toHaveBeenCalledTimes(2);
  });

  it('re-raises through the v2 route on reconnect and clears the warning once a raise lands', async () => {
    const first = deferred<string | undefined>();
    const second = deferred<string | undefined>();
    vi.mocked(signalk.postMobNotification)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { controller, publishDelta, flags } = setup({ streamOpen: false });

    controller.onTrigger({ epochMs: 1 });
    first.resolve(undefined);
    await first.promise;
    await Promise.resolve();
    expect(publishDelta).toHaveBeenCalledTimes(1);
    expect(controller.mobPublishWarning).toContain('may not have reached the server');

    flags.streamOpen = true;
    controller.onStreamReconnect();
    expect(signalk.postMobNotification).toHaveBeenCalledTimes(2);
    second.resolve('mob-id');
    await second.promise;
    await Promise.resolve();
    expect(controller.mobPublishWarning).toBeUndefined();
  });

  it('replays a clear published while the socket was down, once', () => {
    const { controller, publishDelta, flags } = setup({
      notificationsApi: false,
      streamOpen: false,
    });

    controller.onTrigger({ epochMs: 1 });
    controller.onCancel();
    expect(publishDelta).toHaveBeenCalledTimes(2);
    flags.streamOpen = true;
    controller.onStreamReconnect();
    // A canceled trigger must not re-raise; only the owed clear goes back out, exactly once.
    expect(publishDelta).toHaveBeenCalledTimes(3);
    expect(publishDelta).toHaveBeenLastCalledWith(
      signalk.SK_PATHS.mobNotification,
      mobClearNotification(),
    );
    controller.onStreamReconnect();
    expect(publishDelta).toHaveBeenCalledTimes(3);
  });

  it('warns when writes are blocked and clears the warning on cancel', () => {
    vi.mocked(signalk.postMobNotification).mockReturnValue(deferred<string | undefined>().promise);
    const { controller } = setup({ writeBlocked: true });

    controller.onTrigger({ epochMs: 1 });
    expect(controller.mobPublishWarning).toBe(
      'The boat-wide alarm may not have reached the server. Server write access is needed.',
    );
    controller.onCancel();
    expect(controller.mobPublishWarning).toBeUndefined();
  });
});
