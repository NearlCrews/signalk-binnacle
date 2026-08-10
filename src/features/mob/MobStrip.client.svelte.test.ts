import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MobStore } from '$entities/mob';
import type { UnitsStore } from '$entities/units';
import MobStrip from './MobStrip.svelte';

// The armed steer confirm needs real DOM interaction (taps, Escape, timers), which is why this
// lives in the browser project.

interface MobShape {
  active: boolean;
  acknowledged: boolean;
  position: { latitude: number; longitude: number } | undefined;
  bearingRad: number | undefined;
  distanceMeters: number | undefined;
  elapsedSeconds: number | undefined;
  markEpochMs: number | undefined;
}

const mounted: Array<() => void> = [];

function mountStrip(activeCourse?: string) {
  const mob = $state<MobShape>({
    active: true,
    acknowledged: false,
    position: { latitude: 27.7, longitude: -82.7 },
    bearingRad: undefined,
    distanceMeters: undefined,
    elapsedSeconds: undefined,
    markEpochMs: undefined,
  });
  const props = $state({
    mob: mob as unknown as MobStore,
    units: { mode: 'metric' } as UnitsStore,
    activeCourse,
    onSteer: vi.fn(),
    onCancel: vi.fn(),
  });
  const target = document.createElement('div');
  document.body.append(target);
  let component!: ReturnType<typeof mount>;
  flushSync(() => {
    component = mount(MobStrip, { target, props });
  });
  mounted.push(() => {
    void unmount(component);
    target.remove();
  });
  const steerButton = (): HTMLButtonElement => {
    const found = [...target.querySelectorAll<HTMLButtonElement>('button')].find((candidate) =>
      /Steer to MOB|Confirm steer\?/.test(candidate.textContent ?? ''),
    );
    if (!found) throw new Error('no steer button');
    return found;
  };
  return { target, mob, props, steerButton };
}

afterEach(() => {
  for (const dispose of mounted.splice(0).reverse()) dispose();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('MobStrip steer arming', () => {
  it('arms on the first tap without calling goTo and explains the consequence', () => {
    const harness = mountStrip();
    harness.steerButton().click();
    flushSync();
    expect(harness.props.onSteer).not.toHaveBeenCalled();
    expect(harness.steerButton().textContent).toContain('Confirm steer?');
    expect(harness.target.textContent).toContain(
      'Sets the course to the MOB mark. A coupled autopilot may turn.',
    );
  });

  it('names the destination an active course would be replaced with', () => {
    const harness = mountStrip('Egmont Key');
    harness.steerButton().click();
    flushSync();
    expect(harness.target.textContent).toContain(
      'Replaces navigation to Egmont Key with the MOB mark.',
    );
  });

  it('calls onSteer exactly once on the confirming second tap', () => {
    const harness = mountStrip();
    harness.steerButton().click();
    flushSync();
    harness.steerButton().click();
    flushSync();
    expect(harness.props.onSteer).toHaveBeenCalledTimes(1);
    expect(harness.steerButton().textContent).toContain('Steer to MOB');
  });

  it('times out back to the plain label without calling onSteer', () => {
    vi.useFakeTimers();
    const harness = mountStrip();
    harness.steerButton().click();
    flushSync();
    vi.advanceTimersByTime(5_100);
    flushSync();
    expect(harness.props.onSteer).not.toHaveBeenCalled();
    expect(harness.steerButton().textContent).toContain('Steer to MOB');
  });

  it('disarms on Escape', () => {
    const harness = mountStrip();
    harness.steerButton().click();
    flushSync();
    harness
      .steerButton()
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    flushSync();
    expect(harness.steerButton().textContent).toContain('Steer to MOB');
    harness.steerButton().click();
    flushSync();
    expect(harness.props.onSteer).not.toHaveBeenCalled();
  });

  it('disarms when the position is lost and disables the action', () => {
    const harness = mountStrip();
    harness.steerButton().click();
    flushSync();
    harness.mob.position = undefined;
    flushSync();
    expect(harness.steerButton().textContent).toContain('Steer to MOB');
    expect(harness.steerButton().disabled).toBe(true);
  });

  it('disarms when the navigation state changes under the arm', () => {
    const harness = mountStrip('Egmont Key');
    harness.steerButton().click();
    flushSync();
    harness.props.activeCourse = 'Anclote Key';
    flushSync();
    expect(harness.steerButton().textContent).toContain('Steer to MOB');
    harness.steerButton().click();
    flushSync();
    expect(harness.props.onSteer).not.toHaveBeenCalled();
  });
});
