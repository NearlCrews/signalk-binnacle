import { flushSync } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LatLon } from '$shared/geo';
import { createFollowController } from './follow-controller.svelte';

const mountedCleanups: Array<() => void> = [];

// A manually driven stand-in for the requestAnimationFrame trio, so the glide tests control both
// the schedule and the clock.
function fakeMotion(reducedMotion = false) {
  let nowMs = 0;
  let nextHandle = 1;
  const pending = new Map<number, (t: number) => void>();
  return {
    motion: {
      schedule: (callback: (t: number) => void) => {
        const handle = nextHandle;
        nextHandle += 1;
        pending.set(handle, callback);
        return handle;
      },
      cancel: (handle: number) => {
        pending.delete(handle);
      },
      now: () => nowMs,
      reducedMotion: () => reducedMotion,
    },
    pendingFrames: () => pending.size,
    step: (toMs: number) => {
      nowMs = toMs;
      const next = pending.entries().next().value;
      if (!next) throw new Error('no pending frame to run');
      pending.delete(next[0]);
      next[1](toMs);
    },
  };
}

function mount(
  options: { commandsReady?: boolean; motion?: ReturnType<typeof fakeMotion>['motion'] } = {},
) {
  const vessel = $state<{ position: LatLon | undefined; positionStale: boolean }>({
    position: undefined,
    positionStale: false,
  });
  const recenterOnVessel = vi.fn();
  const commands = $state<{ current: { recenterOnVessel: typeof recenterOnVessel } | undefined }>({
    current: options.commandsReady === false ? undefined : { recenterOnVessel },
  });
  let controller!: ReturnType<typeof createFollowController>;
  let disposeRoot!: () => void;
  flushSync(() => {
    disposeRoot = $effect.root(() => {
      controller = createFollowController({
        vessel,
        commands: () => commands.current,
        motion: options.motion,
      });
    });
  });
  mountedCleanups.push(disposeRoot);
  return { vessel, recenterOnVessel, commands, controller };
}

afterEach(() => {
  for (const cleanup of mountedCleanups.splice(0).reverse()) cleanup();
  vi.restoreAllMocks();
});

describe('createFollowController', () => {
  it('recenters immediately on enable and again on each new fix', () => {
    const test = mount();
    test.vessel.position = { latitude: 60, longitude: 24 };
    flushSync();
    expect(test.recenterOnVessel).not.toHaveBeenCalled();

    test.controller.toggle();
    flushSync();
    expect(test.recenterOnVessel).toHaveBeenCalledExactlyOnceWith(60, 24, 0);

    test.vessel.position = { latitude: 60.001, longitude: 24.001 };
    flushSync();
    expect(test.recenterOnVessel).toHaveBeenCalledTimes(2);
    expect(test.recenterOnVessel).toHaveBeenLastCalledWith(60.001, 24.001, 0);
  });

  it('stays armed through a stale fix and resumes when the fix recovers', () => {
    const test = mount();
    test.vessel.position = { latitude: 60, longitude: 24 };
    test.controller.toggle();
    flushSync();
    test.recenterOnVessel.mockClear();

    test.vessel.positionStale = true;
    flushSync();
    expect(test.controller.following).toBe(true);

    test.vessel.position = { latitude: 60.01, longitude: 24.01 };
    flushSync();
    expect(test.recenterOnVessel).not.toHaveBeenCalled();

    test.vessel.positionStale = false;
    flushSync();
    expect(test.recenterOnVessel).toHaveBeenCalledExactlyOnceWith(60.01, 24.01, 0);
  });

  it('release disarms follow and stops recentering on later fixes', () => {
    const test = mount();
    test.vessel.position = { latitude: 60, longitude: 24 };
    test.controller.toggle();
    flushSync();
    test.recenterOnVessel.mockClear();

    test.controller.release();
    flushSync();
    expect(test.controller.following).toBe(false);

    test.vessel.position = { latitude: 61, longitude: 25 };
    flushSync();
    expect(test.recenterOnVessel).not.toHaveBeenCalled();
  });

  it('does not recenter while the map commands are not ready, then recenters when they arrive', () => {
    const test = mount({ commandsReady: false });
    test.vessel.position = { latitude: 60, longitude: 24 };
    test.controller.toggle();
    flushSync();
    expect(test.recenterOnVessel).not.toHaveBeenCalled();

    test.commands.current = { recenterOnVessel: test.recenterOnVessel };
    flushSync();
    expect(test.recenterOnVessel).toHaveBeenCalledExactlyOnceWith(60, 24, 0);
  });

  it('glides to a nearby fix over the ease window instead of jumping', () => {
    const fake = fakeMotion();
    const test = mount({ motion: fake.motion });
    test.vessel.position = { latitude: 60, longitude: 24 };
    test.controller.toggle();
    flushSync();
    expect(test.recenterOnVessel).toHaveBeenCalledExactlyOnceWith(60, 24, 0);

    // About 22 m north: inside the plausibility bound, so the camera chases rather than snaps.
    test.vessel.position = { latitude: 60.0002, longitude: 24 };
    flushSync();
    expect(test.recenterOnVessel).toHaveBeenCalledTimes(1);
    expect(fake.pendingFrames()).toBe(1);

    fake.step(500);
    expect(test.recenterOnVessel).toHaveBeenLastCalledWith(expect.closeTo(60.0001, 9), 24, 0);
    fake.step(1_000);
    expect(test.recenterOnVessel).toHaveBeenLastCalledWith(60.0002, 24, 0);
    expect(fake.pendingFrames()).toBe(0);
  });

  it('restarts the chase from the currently commanded center when a fresh fix lands mid-glide', () => {
    const fake = fakeMotion();
    const test = mount({ motion: fake.motion });
    test.vessel.position = { latitude: 60, longitude: 24 };
    test.controller.toggle();
    flushSync();

    test.vessel.position = { latitude: 60.0002, longitude: 24 };
    flushSync();
    fake.step(500);

    test.vessel.position = { latitude: 60.0004, longitude: 24 };
    flushSync();
    expect(fake.pendingFrames()).toBe(1);
    fake.step(1_000);
    expect(test.recenterOnVessel).toHaveBeenLastCalledWith(expect.closeTo(60.00025, 9), 24, 0);
  });

  it('teleports past the plausibility bound instead of gliding', () => {
    const fake = fakeMotion();
    const test = mount({ motion: fake.motion });
    test.vessel.position = { latitude: 60, longitude: 24 };
    test.controller.toggle();
    flushSync();

    test.vessel.position = { latitude: 61, longitude: 24 };
    flushSync();
    expect(test.recenterOnVessel).toHaveBeenLastCalledWith(61, 24, 0);
    expect(fake.pendingFrames()).toBe(0);
  });

  it('falls back to an instant recenter under reduced motion', () => {
    const fake = fakeMotion(true);
    const test = mount({ motion: fake.motion });
    test.vessel.position = { latitude: 60, longitude: 24 };
    test.controller.toggle();
    flushSync();

    test.vessel.position = { latitude: 60.0002, longitude: 24 };
    flushSync();
    expect(test.recenterOnVessel).toHaveBeenLastCalledWith(60.0002, 24, 0);
    expect(fake.pendingFrames()).toBe(0);
  });

  it('release cancels a glide in flight', () => {
    const fake = fakeMotion();
    const test = mount({ motion: fake.motion });
    test.vessel.position = { latitude: 60, longitude: 24 };
    test.controller.toggle();
    flushSync();
    test.vessel.position = { latitude: 60.0002, longitude: 24 };
    flushSync();
    expect(fake.pendingFrames()).toBe(1);
    test.recenterOnVessel.mockClear();

    test.controller.release();
    flushSync();
    expect(fake.pendingFrames()).toBe(0);
    expect(test.recenterOnVessel).not.toHaveBeenCalled();
  });
});
