import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CourseGuidance } from '$entities/course';
import { OwnVessel } from '$entities/vessel';
import { SignalKStore } from '$shared/signalk';
import { createFrameFactory } from '$shared/testing';
import NavStrip from './NavStrip.svelte';

function activeGuidance(): CourseGuidance {
  const store = new SignalKStore();
  store.applyFrame(
    createFrameFactory()({
      'navigation.position': { latitude: 42, longitude: -83 },
      'navigation.course.nextPoint': {
        position: { latitude: 43, longitude: -82 },
        name: 'Harbor entrance',
      },
    }),
  );
  return new CourseGuidance(store, new OwnVessel(store));
}

const mounted: Array<() => void> = [];

function mountStrip() {
  const onStop = vi.fn();
  const target = document.createElement('div');
  document.body.append(target);
  let component!: ReturnType<typeof mount>;
  flushSync(() => {
    component = mount(NavStrip, {
      target,
      props: { guidance: activeGuidance(), units: 'metric', onStop },
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
  return {
    onStop,
    remove,
    stop,
    label: () => stop().textContent?.trim(),
    tapStop: () => {
      stop().click();
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
