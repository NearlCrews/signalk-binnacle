import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AlarmTone } from './alarm';
import { AlarmCoordinator } from './alarm-coordinator';

const MOB: AlarmTone = {
  frequency: 700,
  beepMs: 100,
  gapMs: 50,
  beeps: 3,
  periodMs: 1_000,
  volume: 0.2,
};
const DANGER: AlarmTone = {
  frequency: 880,
  beepMs: 140,
  gapMs: 90,
  beeps: 2,
  periodMs: 1_200,
  volume: 0.18,
};
const SHALLOW: AlarmTone = {
  frequency: 520,
  beepMs: 200,
  gapMs: 100,
  beeps: 2,
  periodMs: 1_500,
  volume: 0.2,
};
const ARRIVAL: AlarmTone = {
  frequency: 600,
  beepMs: 90,
  gapMs: 60,
  beeps: 1,
  periodMs: 2_000,
  volume: 0.15,
};

function makeOutput() {
  return { start: vi.fn(), stop: vi.fn() };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('AlarmCoordinator', () => {
  it('plays only the most urgent active channel', () => {
    const output = makeOutput();
    const coordinator = new AlarmCoordinator(output);
    const mob = coordinator.channel({ id: 'mob', rank: () => 0 });
    const shallow = coordinator.channel({ id: 'shallow', rank: () => 2 });
    shallow.start(SHALLOW);
    expect(output.start).toHaveBeenLastCalledWith(SHALLOW);
    mob.start(MOB);
    expect(output.start).toHaveBeenLastCalledWith(MOB);
    // The lower channel does not reach the output while the urgent one holds the top slot and its
    // reminder interval has not elapsed.
    vi.advanceTimersByTime(MOB.periodMs + 1);
    expect(output.start).toHaveBeenLastCalledWith(MOB);
    coordinator.dispose();
  });

  it('resumes the next active condition when the urgent one resolves', () => {
    const output = makeOutput();
    const coordinator = new AlarmCoordinator(output);
    const mob = coordinator.channel({ id: 'mob', rank: () => 0 });
    const shallow = coordinator.channel({ id: 'shallow', rank: () => 2 });
    shallow.start(SHALLOW);
    mob.start(MOB);
    mob.stop();
    expect(output.start).toHaveBeenLastCalledWith(SHALLOW);
    shallow.stop();
    expect(output.stop).toHaveBeenCalled();
    coordinator.dispose();
  });

  it('interleaves co-equal top channels burst by burst', () => {
    const output = makeOutput();
    const coordinator = new AlarmCoordinator(output);
    let escalating = true;
    const mob = coordinator.channel({ id: 'mob', rank: () => 0 });
    const collision = coordinator.channel({ id: 'collision', rank: () => (escalating ? 0 : 1) });
    mob.start(MOB);
    collision.start(DANGER);
    const playedTones = () => output.start.mock.calls.map(([tone]) => tone);
    vi.advanceTimersByTime(6_000);
    expect(playedTones()).toContain(MOB);
    expect(playedTones()).toContain(DANGER);
    // De-escalation drops the collision channel out of the rotation.
    escalating = false;
    output.start.mockClear();
    vi.advanceTimersByTime(6_000);
    expect(playedTones().every((tone) => tone === MOB)).toBe(true);
    coordinator.dispose();
  });

  it('re-articulates a newly raised higher-priority event within one burst period', () => {
    const output = makeOutput();
    const coordinator = new AlarmCoordinator(output);
    const mob = coordinator.channel({ id: 'mob', rank: () => 0 });
    const shallow = coordinator.channel({ id: 'shallow', rank: () => 2 });
    shallow.start(SHALLOW);
    output.stop.mockClear();
    mob.start(MOB);
    // The pattern restarts (stop then start) rather than being absorbed by the running loop.
    expect(output.stop).toHaveBeenCalled();
    expect(output.start).toHaveBeenLastCalledWith(MOB);
    coordinator.dispose();
  });

  it('reminds a lower-priority active channel on a bounded interval', () => {
    const output = makeOutput();
    const now = { value: 0 };
    vi.setSystemTime(0);
    const coordinator = new AlarmCoordinator(output, () => now.value);
    const mob = coordinator.channel({ id: 'mob', rank: () => 0 });
    const shallow = coordinator.channel({ id: 'shallow', rank: () => 2 });
    mob.start(MOB);
    now.value = 5_000;
    shallow.start(SHALLOW);
    // The lower channel is played once as a reminder after its interval, then the urgent pattern
    // returns.
    now.value = 16_000;
    vi.advanceTimersByTime(MOB.periodMs);
    expect(output.start).toHaveBeenLastCalledWith(SHALLOW);
    now.value = 17_500;
    vi.advanceTimersByTime(SHALLOW.periodMs);
    expect(output.start).toHaveBeenLastCalledWith(MOB);
    coordinator.dispose();
  });

  it('never lets a courtesy channel preempt or join a safety condition', () => {
    const output = makeOutput();
    const coordinator = new AlarmCoordinator(output);
    const shallow = coordinator.channel({ id: 'shallow', rank: () => 2 });
    const arrival = coordinator.channel({ id: 'arrival', rank: () => 5, courtesy: true });
    shallow.start(SHALLOW);
    arrival.start(ARRIVAL);
    expect(output.start).toHaveBeenLastCalledWith(SHALLOW);
    vi.advanceTimersByTime(30_000);
    expect(output.start.mock.calls.every(([tone]) => tone === SHALLOW)).toBe(true);
    // Alone, the courtesy tone plays.
    shallow.stop();
    expect(output.start).toHaveBeenLastCalledWith(ARRIVAL);
    coordinator.dispose();
  });

  it('muting one channel does not silence the others', () => {
    const output = makeOutput();
    const coordinator = new AlarmCoordinator(output);
    const collision = coordinator.channel({ id: 'collision', rank: () => 1 });
    const shallow = coordinator.channel({ id: 'shallow', rank: () => 2 });
    collision.start(DANGER);
    shallow.start(SHALLOW);
    // The call site's mute stops only its own channel.
    collision.stop();
    expect(output.start).toHaveBeenLastCalledWith(SHALLOW);
    coordinator.dispose();
  });
});
