import { flushSync } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BATTERY_CRITICAL_FRACTION,
  BATTERY_LOW_FRACTION,
  createBatteryWatch,
} from './battery-watch.svelte';

function fakeBattery(level: number, charging: boolean) {
  const listeners: Array<{ type: string; listener: () => void }> = [];
  const battery = {
    level,
    charging,
    addEventListener: (type: string, listener: () => void): void => {
      listeners.push({ type, listener });
    },
    removeEventListener: (type: string, listener: () => void): void => {
      const index = listeners.findIndex(
        (entry) => entry.type === type && entry.listener === listener,
      );
      if (index >= 0) listeners.splice(index, 1);
    },
  };
  return {
    battery,
    listeners,
    set(next: Partial<{ level: number; charging: boolean }>): void {
      Object.assign(battery, next);
      for (const entry of [...listeners]) entry.listener();
    },
  };
}

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function setup(getBattery: (() => Promise<unknown>) | undefined, activeAtStart = true) {
  const state = $state({ active: activeAtStart });
  let watch!: ReturnType<typeof createBatteryWatch>;
  let disposeRoot!: () => void;
  flushSync(() => {
    disposeRoot = $effect.root(() => {
      watch = createBatteryWatch({ active: () => state.active, getBattery });
    });
  });
  cleanups.push(() => disposeRoot());
  return { state, watch };
}

describe('createBatteryWatch', () => {
  it('is a silent no-op without a Battery Status API or with a refusing one', async () => {
    const absent = setup(undefined);
    expect(absent.watch.warning).toBeUndefined();
    expect(absent.watch.note).toBeUndefined();

    const refusing = setup(() => Promise.reject(new Error('blocked')));
    await Promise.resolve();
    expect(refusing.watch.warning).toBeUndefined();
  });

  it('ignores a battery object without the expected shape', async () => {
    const test = setup(() => Promise.resolve({ level: 'full', charging: 'maybe' }));
    await Promise.resolve();
    expect(test.watch.warning).toBeUndefined();
    expect(test.watch.note).toBeUndefined();
  });

  it('warns at the low threshold, escalates at critical, and clears when charging', async () => {
    const fake = fakeBattery(0.5, false);
    const test = setup(() => Promise.resolve(fake.battery));
    await vi.waitFor(() => expect(fake.listeners.length).toBe(2));
    expect(test.watch.warning).toBeUndefined();

    fake.set({ level: BATTERY_LOW_FRACTION });
    flushSync();
    expect(test.watch.warning).toBe('low');
    expect(test.watch.note).toContain('Battery low (20%)');
    expect(test.watch.note).toContain('Plug it in.');

    fake.set({ level: BATTERY_CRITICAL_FRACTION });
    flushSync();
    expect(test.watch.warning).toBe('critical');
    expect(test.watch.note).toContain('Battery critical (10%)');
    expect(test.watch.note).toContain('Plug it in now.');

    fake.set({ charging: true });
    flushSync();
    expect(test.watch.warning).toBeUndefined();
    expect(test.watch.note).toBeUndefined();
  });

  it('stays quiet above the threshold and while charging at any level', async () => {
    const fake = fakeBattery(0.21, false);
    const test = setup(() => Promise.resolve(fake.battery));
    await vi.waitFor(() => expect(fake.listeners.length).toBe(2));
    expect(test.watch.warning).toBeUndefined();

    fake.set({ level: 0.05, charging: true });
    flushSync();
    expect(test.watch.warning).toBeUndefined();
  });

  it('removes its listeners and clears the warning when the watch disarms', async () => {
    const fake = fakeBattery(0.15, false);
    const test = setup(() => Promise.resolve(fake.battery));
    await vi.waitFor(() => expect(test.watch.warning).toBe('low'));

    test.state.active = false;
    flushSync();
    expect(fake.listeners.length).toBe(0);
    expect(test.watch.warning).toBeUndefined();
    expect(test.watch.note).toBeUndefined();
  });

  it('subscribes only while armed, and never attaches after a disarm mid-probe', async () => {
    const idleProbe = vi.fn(() => Promise.resolve(fakeBattery(0.5, false).battery));
    const idle = setup(idleProbe, false);
    flushSync();
    expect(idleProbe).not.toHaveBeenCalled();

    idle.state.active = true;
    flushSync();
    await vi.waitFor(() => expect(idleProbe).toHaveBeenCalledOnce());

    // A probe that resolves after the watch disarmed must not leave listeners behind.
    const fake = fakeBattery(0.15, false);
    let resolveProbe!: (battery: unknown) => void;
    const late = setup(
      () =>
        new Promise((resolve) => {
          resolveProbe = resolve;
        }),
    );
    late.state.active = false;
    flushSync();
    resolveProbe(fake.battery);
    await Promise.resolve();
    expect(fake.listeners.length).toBe(0);
    expect(late.watch.warning).toBeUndefined();
  });
});
