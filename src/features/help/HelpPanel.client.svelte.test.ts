import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import HelpPanel from './HelpPanel.svelte';

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  vi.restoreAllMocks();
});

describe('Help section destinations', () => {
  it.each([
    ['gps', 'GPS readiness'],
    ['privacy', 'Network privacy'],
  ] as const)('focuses and reveals the %s destination', async (targetSection, label) => {
    const scroll = vi.fn();
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scroll,
    });
    cleanups.push(() => {
      if (original) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', original);
      else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
    });
    const trigger = document.createElement('button');
    const target = document.createElement('div');
    document.body.append(trigger, target);
    trigger.focus();
    const component = mount(HelpPanel, {
      target,
      props: {
        firstRun: false,
        onDismissOrientation: vi.fn(),
        writeBlocked: false,
        requestingWrite: false,
        onRequestWrite: vi.fn(),
        audioState: 'ready',
        onEnableSound: vi.fn(),
        onOpenLayers: vi.fn(),
        onOpenProfiles: vi.fn(),
        onOpenAlarms: vi.fn(),
        onResetHints: vi.fn(),
        onClose: vi.fn(),
        target: targetSection,
      },
    });
    cleanups.push(() => {
      void unmount(component);
      target.remove();
      trigger.remove();
    });
    flushSync();
    await tick();
    const heading = target.querySelector(`section[aria-label="${label}"] h3`);
    expect(document.activeElement).toBe(heading);
    expect(scroll).toHaveBeenCalledWith({ block: 'start', behavior: 'instant' });
    expect(heading?.getAttribute('tabindex')).toBe('-1');
  });
});
