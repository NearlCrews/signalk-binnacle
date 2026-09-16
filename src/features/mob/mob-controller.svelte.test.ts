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
  resolveNotification: vi.fn(),
}));

type SetupFlags = Partial<Record<'notificationsApi' | 'writeBlocked' | 'streamOpen', boolean>>;

function setup(overrides: SetupFlags = {}) {
  const flags = { notificationsApi: true, writeBlocked: false, streamOpen: true, ...overrides };
  const store = new SignalKStore();
  const mob = new MobStore(store, new OwnVessel(store), undefined, createFakeStorage());
  const deps = {
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
  return { controller: createMobController(deps), store, flags, ...deps };
}

describe('createMobController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(signalk.resolveNotification).mockResolvedValue(true);
  });

  it.each([true, false])(
    'publishes immutable press-time position and time with v2 available=%s',
    (notificationsApi) => {
      const test = setup({ notificationsApi });
      const mark: MobMark = {
        epochMs: 1_800_000_000_000,
        position: { latitude: 42, longitude: -83 },
      };
      test.store.applyFrame(
        createFrameFactory()({
          'navigation.position': { latitude: 42.01, longitude: -83.01 },
        }),
      );
      test.controller.onTrigger(mark);
      const [path, value] = test.publishDelta.mock.calls[0];
      expect(path).toBe(signalk.SK_PATHS.mobNotification);
      expect(value).toEqual(mobNotification(mark.position, mark.epochMs));
      expect(value.createdAt).toBe(new Date(mark.epochMs).toISOString());
      expect(structuredClone(value)).toEqual(value);
      const otherStore = new SignalKStore();
      const otherMob = new MobStore(
        otherStore,
        new OwnVessel(otherStore),
        undefined,
        createFakeStorage(),
      );
      otherStore.applyFrame(createFrameFactory()({ [path]: value }));
      expect(otherMob.position).toEqual(mark.position);
      expect(otherMob.markEpochMs).toBe(mark.epochMs);
      expect(otherMob.confirmsMark(mark)).toBe(true);
      expect(test.flyTo).toHaveBeenCalledWith(42, -83);
    },
  );

  it('publishes a position-less emergency without substituting later GPS', () => {
    const test = setup();
    test.store.applyFrame(
      createFrameFactory()({ 'navigation.position': { latitude: 42, longitude: -83 } }),
    );
    test.controller.onTrigger({ epochMs: 1 });
    expect(test.publishDelta).toHaveBeenCalledWith(
      signalk.SK_PATHS.mobNotification,
      mobNotification(undefined, 1),
    );
  });

  it('announces quantized bearing and range and stops announcing on acknowledgment', () => {
    const test = setup();
    const frame = createFrameFactory();
    test.store.applyFrame(frame({ 'navigation.position': { latitude: 42, longitude: -83 } }));
    test.controller.onTrigger({ epochMs: 1, position: { latitude: 42.001, longitude: -83 } });
    expect(test.controller.mobAlert).toBe(
      'Man overboard. Mark is 000 degrees, 110 meters. Steer back to the mark.',
    );
    const before = test.controller.mobAlert;
    test.store.applyFrame(frame({ 'navigation.position': { latitude: 42.00002, longitude: -83 } }));
    expect(test.controller.mobAlert).toBe(before);
    test.mob.acknowledge();
    expect(test.controller.mobAlert).toBe('');
  });

  it('resolves streamed MOB ids with at most four concurrent requests', async () => {
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
    const test = setup();
    test.store.applyFrame(
      createFrameFactory()(
        Object.fromEntries(
          Array.from({ length: 10 }, (_, index) => [
            `notifications.mob.mob-${index}`,
            { state: 'emergency', id: `mob-${index}` },
          ]),
        ),
      ),
    );
    test.controller.onCancel();
    expect(signalk.resolveNotification).toHaveBeenCalledTimes(4);
    while (releases.length > 0) {
      for (const release of releases.splice(0)) release();
      await Promise.resolve();
    }
    expect(signalk.resolveNotification).toHaveBeenCalledTimes(10);
    expect(peak).toBe(4);
  });

  it('replays the captured mark until its exact echo arrives, ignoring another station alarm', () => {
    const test = setup({ streamOpen: false });
    const mark = { epochMs: 1, position: { latitude: 1, longitude: 2 } };
    test.controller.onTrigger(mark);
    test.store.applyFrame(
      createFrameFactory()({
        'notifications.mob.other': mobNotification({ latitude: 3, longitude: 4 }, 2),
      }),
    );
    test.flags.streamOpen = true;
    test.controller.onStreamReconnect();
    expect(test.publishDelta).toHaveBeenCalledTimes(2);
    expect(test.publishDelta).toHaveBeenLastCalledWith(
      signalk.SK_PATHS.mobNotification,
      mobNotification(mark.position, 1),
    );
    expect(structuredClone(test.publishDelta.mock.calls[1][1])).toEqual(
      mobNotification(mark.position, 1),
    );
    test.store.applyFrame(
      createFrameFactory()({
        [signalk.SK_PATHS.mobNotification]: mobNotification(mark.position, 1),
      }),
    );
    test.controller.onStreamReconnect();
    expect(test.publishDelta).toHaveBeenCalledTimes(2);
  });

  it('replays an offline clear once without re-raising a canceled mark', () => {
    const test = setup({ streamOpen: false });
    test.controller.onTrigger({ epochMs: 1 });
    test.controller.onCancel();
    test.flags.streamOpen = true;
    test.controller.onStreamReconnect();
    expect(test.publishDelta).toHaveBeenCalledTimes(3);
    expect(test.publishDelta).toHaveBeenLastCalledWith(
      signalk.SK_PATHS.mobNotification,
      mobClearNotification(),
    );
    test.controller.onStreamReconnect();
    expect(test.publishDelta).toHaveBeenCalledTimes(3);
  });

  it('does not clear a newer local mark after a remote resolve fails', async () => {
    let finish!: (resolved: boolean) => void;
    vi.mocked(signalk.resolveNotification).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const test = setup();
    test.store.applyFrame(
      createFrameFactory()({ 'notifications.mob.remote': { state: 'emergency', id: 'remote' } }),
    );
    test.controller.onCancel();
    test.controller.onTrigger({ epochMs: 2 });
    finish(false);
    for (let turn = 0; turn < 6; turn += 1) await Promise.resolve();
    expect(test.publishDelta).toHaveBeenLastCalledWith(
      signalk.SK_PATHS.mobNotification,
      mobNotification(undefined, 2),
    );
  });

  it('warns when writes are blocked and clears the warning on cancel', () => {
    const test = setup({ writeBlocked: true });
    test.controller.onTrigger({ epochMs: 1 });
    expect(test.controller.mobPublishWarning).toContain('Server write access is needed');
    test.controller.onCancel();
    expect(test.controller.mobPublishWarning).toBeUndefined();
  });
});
