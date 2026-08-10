import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installContextMenu } from './long-press';

// A minimal canvas and map fake: the handler needs listeners, a bounding rect, and unproject.
function setup() {
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  const canvas = {
    clientWidth: 400,
    clientHeight: 300,
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    addEventListener: (type: string, fn: (event: unknown) => void) => {
      let set = listeners.get(type);
      if (!set) {
        set = new Set();
        listeners.set(type, set);
      }
      set.add(fn);
    },
    removeEventListener: (type: string, fn: (event: unknown) => void) => {
      listeners.get(type)?.delete(fn);
    },
  };
  const map = {
    getCanvas: () => canvas,
    on: vi.fn(),
    off: vi.fn(),
    unproject: ([x, y]: [number, number]) => ({ lng: x / 10, lat: y / 10 }),
  };
  const emit = vi.fn();
  const handle = installContextMenu(map as never, emit);
  const fire = (type: string, event: Record<string, unknown>) => {
    for (const fn of listeners.get(type) ?? []) fn(event);
  };
  const touch = (overrides: Record<string, unknown>) => ({
    pointerType: 'touch',
    clientX: 100,
    clientY: 100,
    ...overrides,
  });
  return { handle, emit, fire, touch };
}

beforeEach(() => {
  vi.useFakeTimers();
  // The node suite has no window; the handler only needs its setTimeout, which the fake timers own.
  vi.stubGlobal('window', {
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('installContextMenu long press', () => {
  it('emits after a still hold, tolerating gloved-finger jitter under the slop', () => {
    const { emit, fire, touch } = setup();
    fire('pointerdown', touch({}));
    // A 15-pixel wobble stays under the 18-pixel slop for a hand on a moving boat.
    fire('pointermove', touch({ clientX: 109, clientY: 112 }));
    vi.advanceTimersByTime(600);
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it('cancels on a drag past the slop, so a pan never opens chart actions', () => {
    const { emit, fire, touch } = setup();
    fire('pointerdown', touch({}));
    fire('pointermove', touch({ clientX: 100 + 30, clientY: 100 }));
    vi.advanceTimersByTime(600);
    expect(emit).not.toHaveBeenCalled();
  });

  it('never emits for a second touch: a pinch is not a press', () => {
    const { emit, fire, touch } = setup();
    fire('pointerdown', touch({}));
    fire('pointerdown', touch({ clientX: 200, clientY: 200 }));
    vi.advanceTimersByTime(600);
    expect(emit).not.toHaveBeenCalled();
    // Lifting both fingers re-arms a later single press.
    fire('pointerup', touch({}));
    fire('pointerup', touch({ clientX: 200, clientY: 200 }));
    fire('pointerdown', touch({}));
    vi.advanceTimersByTime(600);
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it('cancels on lift before the hold completes', () => {
    const { emit, fire, touch } = setup();
    fire('pointerdown', touch({}));
    vi.advanceTimersByTime(300);
    fire('pointerup', touch({}));
    vi.advanceTimersByTime(600);
    expect(emit).not.toHaveBeenCalled();
  });
});
