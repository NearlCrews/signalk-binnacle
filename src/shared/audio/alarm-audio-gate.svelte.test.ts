import { describe, expect, it } from 'vitest';
import { AlarmAudioGate } from './alarm-audio-gate.svelte';

function setup(primedAtStart = false) {
  const clock = $state({ now: 100_000 });
  const primed = { value: primedAtStart };
  const gate = new AlarmAudioGate(clock, () => primed.value);
  return { clock, primed, gate };
}

describe('AlarmAudioGate', () => {
  it('reports blocked only after the unprimed state outlasts the grace', () => {
    const { clock, gate } = setup();
    expect(gate.blocked).toBe(false);
    clock.now += 1_000;
    expect(gate.blocked).toBe(false);
    clock.now += 1_000;
    expect(gate.blocked).toBe(true);
  });

  it('clears as soon as a gesture primes the context', () => {
    const { clock, primed, gate } = setup();
    clock.now += 5_000;
    expect(gate.blocked).toBe(true);
    primed.value = true;
    clock.now += 1;
    expect(gate.blocked).toBe(false);
  });

  it('never reports a brief unprimed blip that a gesture resolves inside the grace', () => {
    const { clock, primed, gate } = setup(true);
    expect(gate.blocked).toBe(false);
    primed.value = false;
    clock.now += 1_000;
    expect(gate.blocked).toBe(false);
    primed.value = true;
    clock.now += 5_000;
    expect(gate.blocked).toBe(false);
  });

  it('restarts the grace from each fresh unprimed run, not the first one ever', () => {
    const { clock, primed, gate } = setup();
    clock.now += 5_000;
    expect(gate.blocked).toBe(true);
    primed.value = true;
    clock.now += 1;
    expect(gate.blocked).toBe(false);
    // A new unprimed run counts its grace from when the gate observes it, not the original run.
    primed.value = false;
    clock.now += 1;
    expect(gate.blocked).toBe(false);
    clock.now += 1_999;
    expect(gate.blocked).toBe(false);
    clock.now += 1;
    expect(gate.blocked).toBe(true);
  });
});
