import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthController } from '$shared/signalk';
import AutopilotPanel from './AutopilotPanel.svelte';
import type { AutopilotController } from './autopilot-controller.svelte';

// The armed engage confirm needs real DOM interaction (taps and timers), which is why this lives
// in the browser project.

const mounted: Array<() => void> = [];

function mountPanel(overrides: Partial<AutopilotController> = {}) {
  const controller = {
    rehydrate: vi.fn(async () => undefined),
    selectDevice: vi.fn(),
    engage: vi.fn(async () => undefined),
    disengage: vi.fn(async () => undefined),
    setMode: vi.fn(async () => undefined),
    adjustTarget: vi.fn(),
    tack: vi.fn(async () => undefined),
    gybe: vi.fn(async () => undefined),
    clearCommandError: vi.fn(),
    dispose: vi.fn(),
    availability: 'available',
    absentReason: 'no-provider',
    devices: [{ id: 'pypilot', provider: 'p', isDefault: true }],
    selectedId: 'pypilot',
    pilotState: 'standby',
    mode: 'compass',
    target: 1.5,
    engaged: false,
    modes: ['compass', 'gps', 'wind'],
    availableActionIds: new Set(['tack']),
    chip: { kind: 'standby' },
    hydrating: false,
    busy: false,
    adjustBusy: false,
    pendingCommand: undefined,
    commandError: null,
    ...overrides,
  } as AutopilotController;
  const auth = {
    writeBlocked: false,
    upgrading: false,
    upgradeOutcome: undefined,
    requestWriteAccess: vi.fn(async () => undefined),
  } as unknown as AuthController;
  const target = document.createElement('div');
  document.body.append(target);
  let component!: ReturnType<typeof mount>;
  flushSync(() => {
    component = mount(AutopilotPanel, {
      target,
      props: { controller, auth, onClose: vi.fn() },
    });
  });
  mounted.push(() => {
    void unmount(component);
    target.remove();
  });
  const button = (pattern: RegExp): HTMLButtonElement => {
    const found = [...target.querySelectorAll<HTMLButtonElement>('button')].find((candidate) =>
      pattern.test(candidate.textContent ?? ''),
    );
    if (!found) throw new Error(`no button matching ${pattern}`);
    return found;
  };
  return { target, controller, button };
}

afterEach(() => {
  for (const dispose of mounted.splice(0).reverse()) dispose();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('AutopilotPanel armed commands', () => {
  it('arms on the first tap, naming the action and the mode, without engaging', () => {
    const harness = mountPanel();
    harness.button(/Engage autopilot/).click();
    flushSync();
    expect(harness.controller.engage).not.toHaveBeenCalled();
    expect(harness.button(/Tap again/).textContent).toContain(
      'Tap again to engage Compass steering',
    );
  });

  it('engages exactly once on the confirming second tap', () => {
    const harness = mountPanel();
    harness.button(/Engage autopilot/).click();
    flushSync();
    harness.button(/Tap again to engage/).click();
    flushSync();
    expect(harness.controller.engage).toHaveBeenCalledTimes(1);
    expect(harness.button(/Engage autopilot/).textContent).toContain('Engage autopilot');
  });

  it('times the arm out back to safe without engaging', () => {
    vi.useFakeTimers();
    const harness = mountPanel();
    harness.button(/Engage autopilot/).click();
    flushSync();
    vi.advanceTimersByTime(5_100);
    flushSync();
    expect(harness.controller.engage).not.toHaveBeenCalled();
    expect(harness.button(/Engage autopilot/).textContent).toContain('Engage autopilot');
  });

  it('disarms the engage confirm when another steering command arms', () => {
    const harness = mountPanel();
    harness.button(/Engage autopilot/).click();
    flushSync();
    harness.button(/Tack port/).click();
    flushSync();
    // Tack is now the one armed command; the engage confirm dropped back to its plain label.
    expect(harness.button(/Engage autopilot/).textContent).toContain('Engage autopilot');
    expect(harness.button(/Tap again to tack to port/)).toBeTruthy();
    expect(harness.controller.engage).not.toHaveBeenCalled();
    expect(harness.controller.tack).not.toHaveBeenCalled();
  });

  it('confirms a tack toward the tapped side only', () => {
    const harness = mountPanel();
    harness.button(/Tack port/).click();
    flushSync();
    harness.button(/Tap again to tack to port/).click();
    flushSync();
    expect(harness.controller.tack).toHaveBeenCalledTimes(1);
    expect(harness.controller.tack).toHaveBeenCalledWith('port');
  });

  it('sends a direct nudge in radians while engaged, no arm in the way', () => {
    const harness = mountPanel({ engaged: true, pilotState: 'auto' });
    const port10 = harness.target.querySelector<HTMLButtonElement>(
      'button[aria-label="Ten degrees to port"]',
    );
    port10?.click();
    flushSync();
    expect(harness.controller.adjustTarget).toHaveBeenCalledTimes(1);
    const [radians] = (harness.controller.adjustTarget as ReturnType<typeof vi.fn>).mock
      .calls[0] as [number];
    expect(radians).toBeCloseTo(-0.1745, 3);
  });

  it('keeps the nudges inert on standby', () => {
    const harness = mountPanel();
    const port10 = harness.target.querySelector<HTMLButtonElement>(
      'button[aria-label="Ten degrees to port"]',
    );
    expect(port10?.disabled).toBe(true);
  });
});
