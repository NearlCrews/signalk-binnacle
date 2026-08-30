import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CourseGuidance } from '$entities/course';
import { OwnVessel } from '$entities/vessel';
import { SignalKStore } from '$shared/signalk';
import { createFrameFactory } from '$shared/testing';
import NavStrip from './NavStrip.svelte';

function activeGuidance(extraSelf: Record<string, unknown> = {}): CourseGuidance {
  const store = new SignalKStore();
  store.applyFrame(
    createFrameFactory()({
      'navigation.position': { latitude: 42, longitude: -83 },
      'navigation.course.nextPoint': {
        position: { latitude: 43, longitude: -82 },
        name: 'Harbor entrance',
      },
      ...extraSelf,
    }),
  );
  return new CourseGuidance(store, new OwnVessel(store));
}

const mounted: Array<() => void> = [];

function mountStrip(extraSelf: Record<string, unknown> = {}, withSettings = false) {
  const onStop = vi.fn();
  const onSetArrivalCircle = vi.fn();
  const onRestartCourse = vi.fn();
  const onSetTargetArrivalTime = vi.fn();
  const target = document.createElement('div');
  document.body.append(target);
  let component!: ReturnType<typeof mount>;
  flushSync(() => {
    component = mount(NavStrip, {
      target,
      props: {
        guidance: activeGuidance(extraSelf),
        units: 'metric',
        onStop,
        ...(withSettings ? { onSetArrivalCircle, onRestartCourse, onSetTargetArrivalTime } : {}),
      },
    });
  });
  let removed = false;
  const remove = (): void => {
    if (removed) return;
    removed = true;
    // Teardown is synchronous without outro transitions; the returned promise only awaits those.
    void unmount(component);
    target.remove();
  };
  mounted.push(remove);
  const stop = (): HTMLButtonElement => {
    const button = target.querySelector<HTMLButtonElement>('button.ack');
    if (!button) throw new Error('the stop control is not rendered');
    return button;
  };
  const query = <T extends Element>(selector: string): T => {
    const found = target.querySelector<T>(selector);
    if (!found) throw new Error(`${selector} is not rendered`);
    return found;
  };
  return {
    target,
    onStop,
    onSetArrivalCircle,
    onRestartCourse,
    onSetTargetArrivalTime,
    remove,
    stop,
    query,
    label: () => stop().textContent?.trim(),
    tapStop: () => {
      stop().click();
      flushSync();
    },
    openSettings: () => {
      query<HTMLButtonElement>('button[aria-label="Course settings"]').click();
      flushSync();
    },
    commitField: (selector: string, value: string) => {
      const input = query<HTMLInputElement>(selector);
      input.value = value;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      flushSync();
    },
  };
}

afterEach(() => {
  for (const remove of mounted.splice(0).reverse()) remove();
  vi.useRealTimers();
});

describe('NavStrip stop', () => {
  it('arms on the first tap without stopping navigation', () => {
    const strip = mountStrip();
    strip.tapStop();
    expect(strip.onStop).not.toHaveBeenCalled();
    expect(strip.label()).toBe('Confirm stop?');
  });

  it('stops navigation once on the confirming second tap', () => {
    const strip = mountStrip();
    strip.tapStop();
    strip.tapStop();
    expect(strip.onStop).toHaveBeenCalledTimes(1);
    expect(strip.label()).toBe('Stop');
  });

  it('disarms itself when the confirm window expires', () => {
    vi.useFakeTimers();
    const strip = mountStrip();
    strip.tapStop();
    expect(strip.label()).toBe('Confirm stop?');
    vi.advanceTimersByTime(5_000);
    flushSync();
    expect(strip.label()).toBe('Stop');
    expect(strip.onStop).not.toHaveBeenCalled();
  });

  it('clears a pending arm timer when the strip is unmounted', () => {
    vi.useFakeTimers();
    const strip = mountStrip();
    strip.tapStop();
    expect(vi.getTimerCount()).toBe(1);
    strip.remove();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('NavStrip course settings', () => {
  it('shows the streamed arrival radius and commits an entered one', () => {
    const strip = mountStrip({ 'navigation.course.arrivalCircle': 250 }, true);
    strip.openSettings();
    expect(strip.query<HTMLInputElement>('input[type="number"]').value).toBe('250');
    strip.commitField('input[type="number"]', '600');
    expect(strip.onSetArrivalCircle).toHaveBeenCalledWith(600);
  });

  it('falls back to the local default radius when the server has none', () => {
    const strip = mountStrip({}, true);
    strip.openSettings();
    expect(strip.query<HTMLInputElement>('input[type="number"]').value).toBe('100');
  });

  it('commits a target arrival as a local-time Date and clears it to undefined', () => {
    const strip = mountStrip(
      { 'navigation.course.targetArrivalTime': '2026-09-01T19:30:00.000Z' },
      true,
    );
    strip.openSettings();
    strip.commitField('input[type="datetime-local"]', '2026-09-02T06:15');
    expect(strip.onSetTargetArrivalTime).toHaveBeenCalledTimes(1);
    const committed = strip.onSetTargetArrivalTime.mock.calls[0][0] as Date;
    // A bare datetime-local string means the display's local zone; the strip passes that instant on.
    expect(committed.getTime()).toBe(new Date('2026-09-02T06:15').getTime());

    strip.query<HTMLButtonElement>('button[aria-label="Clear the target arrival time"]').click();
    flushSync();
    expect(strip.onSetTargetArrivalTime).toHaveBeenLastCalledWith(undefined);
  });

  it('hides the clear control when no target arrival is set, and an emptied field clears', () => {
    const strip = mountStrip({}, true);
    strip.openSettings();
    expect(
      strip.target.querySelector('button[aria-label="Clear the target arrival time"]'),
    ).toBeNull();
    strip.commitField('input[type="datetime-local"]', '');
    expect(strip.onSetTargetArrivalTime).toHaveBeenCalledWith(undefined);
  });

  it('arms restart on the first tap and fires once on the confirming second tap', () => {
    const strip = mountStrip({}, true);
    strip.openSettings();
    const restart = () => {
      const buttons = [...strip.target.querySelectorAll<HTMLButtonElement>('.course-body button')];
      const found = buttons.find((button) => button.textContent?.includes('Restart'));
      if (!found) throw new Error('the restart control is not rendered');
      return found;
    };
    restart().click();
    flushSync();
    expect(strip.onRestartCourse).not.toHaveBeenCalled();
    expect(restart().textContent).toContain('Restart from here?');
    restart().click();
    flushSync();
    expect(strip.onRestartCourse).toHaveBeenCalledTimes(1);
    // The popover closes with the confirmed action, so no stale armed prompt can linger. The
    // surface itself outlives the click by its outro transition, so read the trigger's state.
    expect(strip.query('button[aria-label="Course settings"]').getAttribute('aria-expanded')).toBe(
      'false',
    );
  });

  it('offers no settings trigger when no settings write is wired', () => {
    const strip = mountStrip();
    expect(strip.target.querySelector('button[aria-label="Course settings"]')).toBeNull();
  });
});
