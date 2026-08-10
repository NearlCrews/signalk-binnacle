import { flushSync } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MobStore } from '$entities/mob';
import { OwnVessel } from '$entities/vessel';
import type { GatedAlarm } from '$shared/audio';
import * as signalk from '$shared/signalk';
import { SignalKStore, SK_PATHS } from '$shared/signalk';
import { createFakeStorage } from '$shared/testing';
import { createMobController } from './mob-controller.svelte';

vi.mock('$shared/signalk', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$shared/signalk')>()),
  postMobNotification: vi.fn(),
}));

const mountedCleanups: Array<() => void> = [];

// The echo-clearing effect only runs under client-side rune lifecycle, which is why this test
// lives in the browser project rather than beside the node suite.
function mount() {
  const store = new SignalKStore();
  let mob!: MobStore;
  let controller!: ReturnType<typeof createMobController>;
  let disposeRoot!: () => void;
  flushSync(() => {
    disposeRoot = $effect.root(() => {
      mob = new MobStore(store, new OwnVessel(store), undefined, createFakeStorage());
      controller = createMobController({
        origin: 'http://sk',
        getToken: () => 'token',
        mob,
        mobAlarm: { update: vi.fn() } as unknown as GatedAlarm,
        units: { mode: 'metric' as const },
        notificationsApi: () => true,
        writeBlocked: () => false,
        streamOpen: () => true,
        publishDelta: vi.fn(),
        flyTo: vi.fn(),
        goTo: vi.fn(async () => undefined),
      });
    });
  });
  mountedCleanups.push(disposeRoot);
  return { store, mob, controller };
}

afterEach(() => {
  for (const cleanup of mountedCleanups.splice(0).reverse()) cleanup();
  vi.restoreAllMocks();
});

describe('createMobController warning honesty', () => {
  it('holds the fallback warning until the server echoes the raise back', async () => {
    // The POST fails without a transport error (a grant that cannot write notifications), so
    // nothing at publish time looks wrong; the warning must still stand until proven delivered.
    vi.mocked(signalk.postMobNotification).mockResolvedValue(undefined);
    const test = mount();
    test.controller.onTrigger({ epochMs: 1 });
    await vi.waitFor(() => {
      flushSync();
      expect(test.controller.mobPublishWarning).toBe(
        'The boat-wide alarm has not been confirmed by the server yet.',
      );
    });

    // The stream echoes a sounding notifications.mob: the one proof the boat was told.
    test.store.applyFrame({
      self: new Map([
        [SK_PATHS.mobNotification, { state: 'emergency', message: 'MOB', method: ['sound'] }],
      ]) as never,
      connection: { phase: 'open', attempt: 0 },
      epoch: 1000,
    });
    flushSync();
    expect(test.controller.mobPublishWarning).toBeUndefined();
  });
});
