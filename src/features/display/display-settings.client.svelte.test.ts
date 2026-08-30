import { flushSync } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LatLon } from '$shared/geo';
import { binnacleStorageKey } from '$shared/persistence';
import type { Theme } from '$shared/ui';
import {
  createDisplaySettingsController,
  type DisplaySettingsController,
  MAX_DISPLAY_DIM,
} from './display-settings.svelte';

// Fixed instants at the equator and prime meridian, where the sun rises near 06:00 UTC and sets
// near 18:00 UTC year round, far outside the controller's half-hour twilight margin.
const EQUATOR: LatLon = { latitude: 0, longitude: 0 };
const NOON_UTC = Date.UTC(2026, 2, 1, 12);
const MIDNIGHT_UTC = Date.UTC(2026, 2, 1, 0);

function memoryStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
  };
}

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

interface SetupOptions {
  storage?: ReturnType<typeof memoryStorage>;
  mode?: unknown;
  position?: LatLon;
  now?: number;
  theme?: Theme;
}

function setup(options: SetupOptions = {}) {
  const state = $state({
    mode: options.mode as unknown,
    position: options.position,
    now: options.now ?? NOON_UTC,
    theme: options.theme ?? ('day' as Theme),
  });
  const setTheme = vi.fn((theme: Theme) => {
    state.theme = theme;
  });
  const root = { style: { fontSize: '' } };
  const storage = options.storage ?? memoryStorage();
  let controller!: DisplaySettingsController;
  let dispose!: () => void;
  flushSync(() => {
    dispose = $effect.root(() => {
      controller = createDisplaySettingsController({
        getEnvironmentMode: () => state.mode,
        getPosition: () => state.position,
        clock: {
          get now() {
            return state.now;
          },
        },
        getTheme: () => state.theme,
        setTheme,
        storage,
        textScaleRoot: root,
      });
    });
  });
  cleanups.push(dispose);
  return { state, setTheme, root, storage, controller };
}

describe('createDisplaySettingsController: dim', () => {
  it('defaults to zero and clamps writes into the alarm-floor range', () => {
    const { controller, storage } = setup();
    expect(controller.dim).toBe(0);

    controller.setDim(0.5);
    expect(controller.dim).toBe(0.5);
    controller.setDim(2);
    expect(controller.dim).toBe(MAX_DISPLAY_DIM);
    controller.setDim(-1);
    expect(controller.dim).toBe(0);
    controller.setDim(Number.NaN);
    expect(controller.dim).toBe(0);

    controller.setDim(0.85);
    expect(storage.map.get(binnacleStorageKey('displayDim'))).toBe(String(MAX_DISPLAY_DIM));
  });

  it('keeps the ceiling below full black so alarms stay distinguishable', () => {
    expect(MAX_DISPLAY_DIM).toBeLessThan(1);
  });

  it('repairs an out-of-range stored value to the default', () => {
    const storage = memoryStorage({ [binnacleStorageKey('displayDim')]: '5' });
    const { controller } = setup({ storage });
    expect(controller.dim).toBe(0);
  });
});

describe('createDisplaySettingsController: text scale', () => {
  it('applies the stored scale to the root at construction', () => {
    const storage = memoryStorage({ [binnacleStorageKey('displayTextScale')]: '120' });
    const { controller, root } = setup({ storage });
    expect(controller.textScale).toBe(120);
    expect(root.style.fontSize).toBe('120%');
  });

  it('writes the root font size on change and restores the default at 100', () => {
    const { controller, root } = setup();
    expect(root.style.fontSize).toBe('');

    controller.setTextScale(130);
    flushSync();
    expect(root.style.fontSize).toBe('130%');

    controller.setTextScale(100);
    flushSync();
    expect(root.style.fontSize).toBe('');
  });

  it('ignores a value off the allowed steps', () => {
    const { controller, root } = setup();
    controller.setTextScale(115);
    controller.setTextScale(90);
    controller.setTextScale(140);
    flushSync();
    expect(controller.textScale).toBe(100);
    expect(root.style.fontSize).toBe('');
  });
});

describe('createDisplaySettingsController: automatic theme', () => {
  it('does nothing while auto is off, even with a night signal', () => {
    const { controller, setTheme, state } = setup({ mode: 'night' });
    expect(controller.recommendedTheme).toBeUndefined();
    expect(setTheme).not.toHaveBeenCalled();
    expect(state.theme).toBe('day');
  });

  it('follows environment.mode when a provider publishes one', () => {
    const { controller, setTheme, state } = setup({ mode: 'night' });
    controller.setAutoTheme(true);
    flushSync();
    expect(setTheme).toHaveBeenLastCalledWith('night-red');

    state.mode = 'day';
    flushSync();
    expect(setTheme).toHaveBeenLastCalledWith('day');
    expect(setTheme).toHaveBeenCalledTimes(2);
  });

  it('falls back to the sun at the vessel fix without a mode value', () => {
    const { controller, setTheme, state } = setup({ position: EQUATOR, now: MIDNIGHT_UTC });
    controller.setAutoTheme(true);
    flushSync();
    expect(setTheme).toHaveBeenLastCalledWith('night-red');

    state.now = NOON_UTC;
    flushSync();
    expect(setTheme).toHaveBeenLastCalledWith('day');
  });

  it('ignores an unrecognized mode value and stays silent with no fix either', () => {
    const { controller, setTheme } = setup({ mode: 'restricted visibility' });
    controller.setAutoTheme(true);
    flushSync();
    expect(controller.recommendedTheme).toBeUndefined();
    expect(setTheme).not.toHaveBeenCalled();
  });

  it('suspends after a manual theme choice and resumes at the next day-night change', () => {
    const { controller, setTheme, state } = setup({ mode: 'day', theme: 'dusk' });
    controller.setAutoTheme(true);
    flushSync();
    expect(setTheme).toHaveBeenLastCalledWith('day');
    expect(controller.autoThemeSuspended).toBe(false);

    state.theme = 'dusk';
    flushSync();
    expect(controller.autoThemeSuspended).toBe(true);
    expect(setTheme).toHaveBeenCalledTimes(1);
    expect(state.theme).toBe('dusk');

    state.mode = 'night';
    flushSync();
    expect(controller.autoThemeSuspended).toBe(false);
    expect(setTheme).toHaveBeenLastCalledWith('night-red');
  });

  it('clears a suspension when auto is toggled off and reapplies when it returns', () => {
    const { controller, setTheme, state } = setup({ mode: 'day', theme: 'dusk' });
    controller.setAutoTheme(true);
    flushSync();
    state.theme = 'dusk';
    flushSync();
    expect(controller.autoThemeSuspended).toBe(true);

    controller.setAutoTheme(false);
    flushSync();
    expect(controller.autoThemeSuspended).toBe(false);
    expect(controller.recommendedTheme).toBeUndefined();

    controller.setAutoTheme(true);
    flushSync();
    expect(setTheme).toHaveBeenLastCalledWith('day');
    expect(state.theme).toBe('day');
  });
});
