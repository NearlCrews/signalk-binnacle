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

function fakeGain() {
  return {
    gain: {
      setValueAtTime: () => undefined,
      linearRampToValueAtTime: () => undefined,
    },
    connect: (node: unknown) => node,
  };
}

function fakeOscillator() {
  return {
    type: '',
    frequency: { value: 0 },
    onended: undefined as (() => void) | undefined,
    connect: (node: unknown) => node,
    start: () => undefined,
    stop: () => undefined,
  };
}

function createAudioStub({ resumeRejects = false } = {}) {
  const contexts: FakeAudioContext[] = [];
  class FakeAudioContext {
    state: AudioContextState = 'suspended';
    currentTime = 0;
    destination = {};
    constructor() {
      contexts.push(this);
    }
    resume(): Promise<void> {
      if (resumeRejects) return Promise.reject(new Error('gesture required'));
      this.state = 'running';
      return Promise.resolve();
    }
    createOscillator() {
      return fakeOscillator();
    }
    createGain() {
      return fakeGain();
    }
  }
  return { contexts, AudioContext: FakeAudioContext };
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

  it('stays quiet and unprimed without Web Audio', async () => {
    const { alarmAudioPrimed, primeAlarmAudio } = await loadAudio();
    expect(() => primeAlarmAudio()).not.toThrow();
    expect(alarmAudioPrimed()).toBe(false);
  });
});
