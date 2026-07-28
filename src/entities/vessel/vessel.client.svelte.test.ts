import { flushSync } from 'svelte';
import { describe, expect, it } from 'vitest';
import type { SKFrame } from '$shared/signalk';
import { SignalKStore } from '$shared/signalk';
import { OwnVessel } from './vessel.svelte';

function frame(self: Record<string, unknown>): SKFrame {
  return {
    self: new Map(Object.entries(self)) as SKFrame['self'],
    connection: { phase: 'open', attempt: 0 },
    epoch: 1000,
  };
}

describe('OwnVessel client reactivity', () => {
  it('memoizes each staleness flag so a clock tick alone does not re-run consumers', () => {
    const store = new SignalKStore();
    const clock = $state({ now: 1000 });
    const vessel = new OwnVessel(store, clock);
    store.applyFrame(
      frame({
        'navigation.position': { latitude: 1, longitude: 2 },
        'navigation.speedOverGround': 3,
        'navigation.courseOverGroundTrue': 1,
        'navigation.headingTrue': 2,
        'environment.depth.belowTransducer': 8,
        'environment.wind.speedApparent': 5,
        'environment.outside.pressure': 101325,
      }),
    );
    let runs = 0;
    const seen: boolean[] = [];
    let cleanup!: () => void;
    flushSync(() => {
      cleanup = $effect.root(() => {
        $effect(() => {
          runs += 1;
          seen.push(
            vessel.positionStale ||
              vessel.sogStale ||
              vessel.cogStale ||
              vessel.headingStale ||
              vessel.safetyDepth.stale ||
              vessel.windStale ||
              vessel.pressureStale,
          );
        });
      });
    });
    expect(runs).toBe(1);

    // In-window ticks recompute only the per-path flag deriveds; no flag flips, so a consumer (the
    // collision assessment reads these on every pass) must not re-run once per second.
    clock.now = 5_000;
    flushSync();
    clock.now = 9_000;
    flushSync();
    expect(runs).toBe(1);

    // Crossing the staleness threshold flips the flags, a real change, so the consumer re-runs.
    clock.now = 20_000;
    flushSync();
    expect(runs).toBe(2);
    expect(seen).toEqual([false, true]);
    cleanup();
  });
});
