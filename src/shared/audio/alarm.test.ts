import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AlarmTone } from './alarm';

// The node test environment has no window; stub one carrying a counting AudioContext so the
// module-scoped shared context is observable. Each test reloads the module (vi.resetModules) so
// that module state does not leak from one case to the next.

const TONE: AlarmTone = {
  frequency: 700,
  beepMs: 100,
  gapMs: 100,
  beeps: 2,
  periodMs: 1000,
  volume: 0.1,
};

function fakeGain(ramps: number[]) {
  return {
    gain: {
      setValueAtTime: () => undefined,
      linearRampToValueAtTime: (value: number) => {
        ramps.push(value);
      },
    },
    connect: (node: unknown) => node,
  };
}

function fakeOscillator(starts: number[]) {
  return {
    type: '',
    frequency: { value: 0 },
    onended: undefined as (() => void) | undefined,
    connect: (node: unknown) => node,
    start: (when: number) => {
      starts.push(when);
    },
    stop: () => undefined,
  };
}

function createAudioStub({ resumeRejects = false } = {}) {
  const contexts: FakeAudioContext[] = [];
  // Every beep's scheduled start time, so a test can count what a burst actually queued.
  const starts: number[] = [];
  // Every gain ramp target, so a test can read the peak a beep was actually scheduled at.
  const ramps: number[] = [];
  // Mutable so a test can grant the gesture partway through, the way a returning navigator does.
  const gesture = { refused: resumeRejects };
  class FakeAudioContext {
    state: AudioContextState = 'suspended';
    currentTime = 0;
    destination = {};
    constructor() {
      contexts.push(this);
    }
    resume(): Promise<void> {
      if (gesture.refused) return Promise.reject(new Error('gesture required'));
      this.state = 'running';
      return Promise.resolve();
    }
    createOscillator() {
      return fakeOscillator(starts);
    }
    createGain() {
      return fakeGain(ramps);
    }
  }
  return { contexts, starts, ramps, gesture, AudioContext: FakeAudioContext };
}

async function loadAudio(audio?: { AudioContext: unknown }) {
  vi.stubGlobal('window', audio ?? {});
  vi.resetModules();
  return await import('./alarm');
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('shared alarm audio context', () => {
  it('creates one audio context for every Alarm', async () => {
    const stub = createAudioStub();
    const { Alarm } = await loadAudio(stub);
    const first = new Alarm();
    const second = new Alarm();
    first.start(TONE);
    second.start(TONE);
    expect(stub.contexts).toHaveLength(1);
    first.stop();
    second.stop();
  });

  it('shares the primed context with an Alarm constructed later', async () => {
    const stub = createAudioStub();
    const { Alarm, primeAlarmAudio } = await loadAudio(stub);
    primeAlarmAudio();
    const alarm = new Alarm();
    alarm.start(TONE);
    expect(stub.contexts).toHaveLength(1);
    alarm.stop();
  });

  it('reports primed only once the shared context is running', async () => {
    const stub = createAudioStub();
    const { alarmAudioPrimed, primeAlarmAudio } = await loadAudio(stub);
    expect(alarmAudioPrimed()).toBe(false);
    // Asking must never build a context of its own, or the gesture-driven prime would resume one
    // context while the alarms sound through another.
    expect(stub.contexts).toHaveLength(0);
    primeAlarmAudio();
    expect(alarmAudioPrimed()).toBe(true);
  });

  it('stays unprimed when the context refuses to resume', async () => {
    const stub = createAudioStub({ resumeRejects: true });
    const { alarmAudioPrimed, primeAlarmAudio } = await loadAudio(stub);
    primeAlarmAudio();
    expect(stub.contexts).toHaveLength(1);
    expect(alarmAudioPrimed()).toBe(false);
  });

  it('schedules nothing while the context is suspended, so a resume cannot fire a pile-up', async () => {
    vi.useFakeTimers();
    const stub = createAudioStub({ resumeRejects: true });
    const { Alarm } = await loadAudio(stub);
    const alarm = new Alarm();

    alarm.start(TONE);
    vi.advanceTimersByTime(TONE.periodMs * 6);
    // A suspended context freezes currentTime, so every skipped burst would have queued its beeps
    // at the same instant and blasted them together on the next gesture.
    expect(stub.starts).toEqual([]);

    stub.gesture.refused = false;
    vi.advanceTimersByTime(TONE.periodMs);

    // One burst's worth of beeps, at the burst spacing, not seven bursts stacked on one timestamp.
    expect(stub.starts).toEqual([0, (TONE.beepMs + TONE.gapMs) / 1000]);
    alarm.stop();
  });

  it('stays quiet and unprimed without Web Audio', async () => {
    const { alarmAudioPrimed, primeAlarmAudio } = await loadAudio();
    expect(() => primeAlarmAudio()).not.toThrow();
    expect(alarmAudioPrimed()).toBe(false);
  });
});

describe('alarm master volume', () => {
  it('scales every scheduled gain peak by the set volume', async () => {
    const stub = createAudioStub();
    const { Alarm, primeAlarmAudio, setAlarmVolume } = await loadAudio(stub);
    primeAlarmAudio();
    setAlarmVolume(0.5);
    const alarm = new Alarm();
    alarm.start(TONE);
    // Each beep ramps up to the peak and back to zero; the peak carries the multiplier.
    expect(Math.max(...stub.ramps)).toBeCloseTo(TONE.volume * 0.5);
    alarm.stop();
  });

  it('clamps into its bounds and ignores a non-finite fraction', async () => {
    const { alarmVolume, MAX_ALARM_VOLUME, MIN_ALARM_VOLUME, setAlarmVolume } = await loadAudio();
    expect(alarmVolume()).toBe(MAX_ALARM_VOLUME);
    // Zero would be a silent boat-wide mute; the floor keeps a bottomed slider audible.
    setAlarmVolume(0);
    expect(alarmVolume()).toBe(MIN_ALARM_VOLUME);
    setAlarmVolume(2);
    expect(alarmVolume()).toBe(MAX_ALARM_VOLUME);
    setAlarmVolume(0.7);
    setAlarmVolume(Number.NaN);
    expect(alarmVolume()).toBe(0.7);
  });
});

describe('playTestTone', () => {
  it('plays one bounded burst through the shared path at the master volume, then stops', async () => {
    vi.useFakeTimers();
    const stub = createAudioStub();
    const { ALARM_TEST_TONE, playTestTone, setAlarmVolume } = await loadAudio(stub);
    setAlarmVolume(0.5);
    // The tap primes and plays in one call: one shared context, one burst of beeps.
    playTestTone();
    expect(stub.contexts).toHaveLength(1);
    expect(stub.starts).toHaveLength(ALARM_TEST_TONE.beeps);
    expect(Math.max(...stub.ramps)).toBeCloseTo(ALARM_TEST_TONE.volume * 0.5);
    // Bounded: the repeat interval is cut before its second burst, so nothing more queues.
    vi.advanceTimersByTime(ALARM_TEST_TONE.periodMs * 3);
    expect(stub.starts).toHaveLength(ALARM_TEST_TONE.beeps);
  });

  it('is safe to tap repeatedly, re-articulating a fresh burst each time', async () => {
    vi.useFakeTimers();
    const stub = createAudioStub();
    const { ALARM_TEST_TONE, playTestTone } = await loadAudio(stub);
    playTestTone();
    playTestTone();
    expect(stub.starts).toHaveLength(2 * ALARM_TEST_TONE.beeps);
    vi.advanceTimersByTime(ALARM_TEST_TONE.periodMs * 3);
    expect(stub.starts).toHaveLength(2 * ALARM_TEST_TONE.beeps);
  });
});
