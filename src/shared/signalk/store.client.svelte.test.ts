import { flushSync } from 'svelte';
import { describe, expect, it } from 'vitest';
import { SignalKStore } from './store.svelte';
import type { SKFrame } from './types';

function frame(self: Record<string, unknown>): SKFrame {
  return {
    self: new Map(Object.entries(self)) as SKFrame['self'],
    connection: { phase: 'open', attempt: 0 },
    epoch: 1000,
  };
}

describe('SignalKStore client reactivity', () => {
  it('reacts only for the changed cell, not unrelated cells', () => {
    const store = new SignalKStore();
    const wind = store.cell('environment.wind.speedApparent');
    let windRuns = 0;
    let cleanup!: () => void;
    flushSync(() => {
      cleanup = $effect.root(() => {
        $effect(() => {
          void wind.value;
          windRuns += 1;
        });
      });
    });
    expect(windRuns).toBe(1);

    store.applyFrame(frame({ 'navigation.speedOverGround': 6 }));
    flushSync();
    expect(windRuns).toBe(1);

    store.applyFrame(frame({ 'environment.wind.speedApparent': 9 }));
    flushSync();
    expect(windRuns).toBe(2);
    cleanup();
  });

  it('does not retrigger connection consumers when phase and attempt are unchanged', () => {
    const store = new SignalKStore();
    let runs = 0;
    let cleanup!: () => void;
    flushSync(() => {
      cleanup = $effect.root(() => {
        $effect(() => {
          void store.connection;
          runs += 1;
        });
      });
    });
    expect(runs).toBe(1);

    // The worker sends a fresh connection object per frame; an unchanged state must not re-run.
    store.applyFrame(frame({ 'navigation.speedOverGround': 1 }));
    store.applyFrame(frame({ 'navigation.speedOverGround': 2 }));
    flushSync();
    expect(runs).toBe(2);

    store.applyFrame(frame({ 'navigation.speedOverGround': 3 }));
    flushSync();
    expect(runs).toBe(2);

    store.applyFrame({
      self: new Map(),
      connection: { phase: 'reconnecting', attempt: 1 },
      epoch: 2000,
    });
    flushSync();
    expect(runs).toBe(3);
    cleanup();
  });
});
