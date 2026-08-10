import { describe, expect, it } from 'vitest';
import { AlarmAudioGate } from './alarm-audio-gate.svelte';

function setup(primedAtStart = false) {
  const clock = $state({ now: 100_000 });
  const primed = { value: primedAtStart };
  const supported = { value: true };
  const failed = { value: false };
  const gate = new AlarmAudioGate(
    clock,
    () => primed.value,
    () => supported.value,
    () => failed.value,
  );
  return { clock, primed, supported, failed, gate };
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

  it('grades a missing Web Audio API as unsupported, never as tap-to-enable blocked', () => {
    const { clock, supported, gate } = setup();
    supported.value = false;
    clock.now += 5_000;
    expect(gate.state).toBe('unsupported');
    expect(gate.blocked).toBe(false);
  });

  it('grades a failed context construction as failed, and recovers when it clears', () => {
    const { clock, primed, failed, gate } = setup();
    failed.value = true;
    clock.now += 5_000;
    expect(gate.state).toBe('failed');
    expect(gate.blocked).toBe(false);
    // A Retry that succeeds clears the failure and primes the context.
    failed.value = false;
    primed.value = true;
    clock.now += 1;
    expect(gate.state).toBe('ready');
  });

  it('reports ready while primed and blocked past the grace otherwise', () => {
    const { clock, primed, gate } = setup(true);
    expect(gate.state).toBe('ready');
    // The grace counts from the first observation of the unprimed run, matching HeldFlag.
    primed.value = false;
    clock.now += 1;
    expect(gate.state).toBe('ready');
    clock.now += 2_100;
    expect(gate.state).toBe('blocked');
  });
});
