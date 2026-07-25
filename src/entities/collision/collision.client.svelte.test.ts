import { flushSync } from 'svelte';
import { describe, expect, it } from 'vitest';
import { AisTargets } from '$entities/ais';
import { OwnVessel } from '$entities/vessel';
import { knotsToMetersPerSecond } from '$shared/lib';
import { createThresholds } from '$shared/settings';
import type { SKFrame } from '$shared/signalk';
import { SignalKStore } from '$shared/signalk';
import { type Assessment, CollisionAssessment } from './collision.svelte';

describe('CollisionAssessment client reactivity', () => {
  it('keeps the assessment identity stable across clock ticks when inputs hold still', () => {
    const store = new SignalKStore();
    // Production wires AisTargets with the non-reactive Date.now; only OwnVessel gets the reactive
    // clock. Mirroring that split matters: a reactive now inside AisTargets.list() would make the
    // assessment depend on the tick directly and mask what this test pins down.
    let plainNow = 100_000;
    const clock = $state({ now: plainNow });
    const tick = (ms: number) => {
      plainNow += ms;
      clock.now = plainNow;
    };
    store.applyFrame({
      self: new Map<string, unknown>([
        ['navigation.position', { latitude: 0, longitude: 0 }],
        ['navigation.speedOverGround', knotsToMetersPerSecond(5)],
        ['navigation.courseOverGroundTrue', 0],
      ]),
      ais: new Map([
        [
          'vessels.a',
          new Map<string, unknown>([
            ['navigation.position', { latitude: 0.01, longitude: 0 }],
            ['navigation.closestApproach', { distance: 100, timeTo: 60 }],
          ]),
        ],
      ]),
      connection: { phase: 'open', attempt: 0 },
      epoch: 100_000,
    } satisfies SKFrame);
    const collision = new CollisionAssessment(
      new OwnVessel(store, clock),
      new AisTargets(store, () => plainNow),
      createThresholds(),
    );
    const seen: Assessment[] = [];
    let cleanup!: () => void;
    flushSync(() => {
      cleanup = $effect.root(() => {
        $effect(() => {
          seen.push(collision.assessment);
        });
      });
    });
    expect(seen).toHaveLength(1);
    expect(seen[0].contacts).toHaveLength(1);

    // A 1 Hz clock tick inside every freshness window must not re-run the CPA loop or mint a new
    // assessment identity: the overlays and the lookout dirty-check it by reference every frame.
    tick(1_000);
    flushSync();
    tick(2_000);
    flushSync();
    expect(seen).toHaveLength(1);
    expect(collision.assessment).toBe(seen[0]);

    // A real AIS change still recomputes, so the stability above is memoization, not deadness.
    store.applyFrame({
      self: new Map(),
      ais: new Map([
        [
          'vessels.a',
          new Map<string, unknown>([['navigation.closestApproach', { distance: 120, timeTo: 60 }]]),
        ],
      ]),
      connection: { phase: 'open', attempt: 0 },
      epoch: plainNow,
    } satisfies SKFrame);
    flushSync();
    expect(seen).toHaveLength(2);
    expect(seen[1].contacts[0]?.cpaMeters).toBe(120);
    cleanup();
  });
});
