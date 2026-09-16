import { type ComponentProps, flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NotificationsStore } from '$entities/notifications';
import type { UnitsStore } from '$entities/units';
import { IMPERIAL_UNITS } from '$shared/lib';
import { DEFAULT_THRESHOLDS, type PersistedValue, type Thresholds } from '$shared/settings';
import type { AuthController } from '$shared/signalk';
import AlarmsPanel from './AlarmsPanel.svelte';

const mounted: Array<() => void> = [];

function mountPanel(overrides: Partial<ComponentProps<typeof AlarmsPanel>> = {}) {
  const set = vi.fn();
  const target = document.createElement('div');
  document.body.append(target);
  let component!: ReturnType<typeof mount>;
  flushSync(() => {
    component = mount(AlarmsPanel, {
      target,
      props: {
        auth: { writeBlocked: false } as AuthController,
        connectionPhase: 'open',
        notifications: { list: () => [] } as unknown as NotificationsStore,
        thresholds: {
          value: { ...DEFAULT_THRESHOLDS, dangerCpaMeters: 1000 },
          set,
        } as unknown as PersistedValue<Thresholds>,
        units: { mode: 'metric' } as UnitsStore,
        collisionMuted: false,
        collisionMuteRemainingMin: undefined,
        onToggleCollisionMute: () => {},
        arrivalMuted: false,
        onToggleArrivalMute: () => {},
        onClose: () => {},
        ...overrides,
      },
    });
  });
  mounted.push(() => {
    void unmount(component);
    target.remove();
  });
  const button = (text: string): HTMLButtonElement => {
    const found = [...target.querySelectorAll<HTMLButtonElement>('button')].find(
      (candidate) => candidate.textContent?.replaceAll(/\s+/g, ' ').trim() === text,
    );
    if (!found) throw new Error(`no button labeled ${text}`);
    return found;
  };
  const click = (text: string): void => {
    button(text).click();
    flushSync();
  };
  // The thresholds live inside a Disclosure that ships collapsed.
  click('Adjust collision alarm sensitivity');
  return { set, target, button, click };
}

afterEach(() => {
  for (const dispose of mounted.splice(0).reverse()) dispose();
});

describe('AlarmsPanel bulk actions', () => {
  it('keeps another alarm actionable and releases a completed unconfirmed request for retry', async () => {
    let finish!: () => void;
    const onSilence = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const onAcknowledge = vi.fn(async () => {});
    const alerts = [0, 1].map((index) => ({
      path: `notifications.test.${index}`,
      activation: 1,
      state: 'alarm' as const,
      message: `Alert ${index}`,
      id: `id-${index}`,
      canSilence: true,
      canAcknowledge: true,
    }));
    const panel = mountPanel({
      notifications: { list: () => alerts } as unknown as NotificationsStore,
      onSilence,
      onAcknowledge,
    });
    const rows = panel.target.querySelectorAll('.alert-row');
    const first = rows[0].querySelectorAll<HTMLButtonElement>('button');
    const second = rows[1].querySelectorAll<HTMLButtonElement>('button');
    first[0].click();
    flushSync();
    expect(first[0].disabled).toBe(true);
    expect(first[1].disabled).toBe(true);
    expect(second[0].disabled).toBe(false);
    second[1].click();
    expect(onAcknowledge).toHaveBeenCalledWith(alerts[1]);
    finish();
    await Promise.resolve();
    flushSync();
    expect(first[0].disabled).toBe(false);
    expect(first[1].disabled).toBe(false);
    expect(panel.target.textContent).not.toContain('Updating alarm status…');
  });
  it('fires a wired bulk action once and holds both buttons while it lands', () => {
    const onSilenceAll = vi.fn();
    const onAcknowledgeAll = vi.fn();
    const alerts = [0, 1].map((index) => ({
      path: `notifications.test.${index}`,
      state: 'alarm' as const,
      message: `Alert ${index}`,
      method: ['visual' as const, 'sound' as const],
      id: `id-${index}`,
      canSilence: true,
      canAcknowledge: true,
    }));
    const panel = mountPanel({
      notifications: { list: () => alerts } as unknown as NotificationsStore,
      onSilenceAll,
      onAcknowledgeAll,
    });

    panel.click('Silence all');
    expect(onSilenceAll).toHaveBeenCalledOnce();
    expect(panel.target.textContent).toContain('Updating alarm status…');
    expect(panel.button('Silence all').disabled).toBe(true);
    expect(panel.button('Acknowledge all').disabled).toBe(true);

    panel.click('Acknowledge all');
    expect(onAcknowledgeAll).not.toHaveBeenCalled();
  });
});

describe('AlarmsPanel threshold reset', () => {
  it('returns focus to the recreated reset button after cancellation without changing limits', async () => {
    const panel = mountPanel();
    panel.click('Reset to defaults');
    panel.click('Cancel');
    await vi.waitFor(() => expect(document.activeElement).toBe(panel.button('Reset to defaults')));
    expect(panel.set).not.toHaveBeenCalled();
  });

  it('preserves a separately tuned shallow-water limit when resetting collision thresholds', () => {
    const set = vi.fn();
    const panel = mountPanel({
      thresholds: {
        value: { ...DEFAULT_THRESHOLDS, dangerCpaMeters: 1000, shallowDepthMeters: 7 },
        set,
      } as unknown as PersistedValue<Thresholds>,
    });
    panel.click('Reset to defaults');
    expect(panel.target.textContent).toContain('Reset collision thresholds?');
    panel.click('Reset');
    expect(set).toHaveBeenCalledWith({ ...DEFAULT_THRESHOLDS, shallowDepthMeters: 7 });
  });
  it('never commits a blank collision or shallow threshold as zero', () => {
    const panel = mountPanel();
    for (const input of panel.target.querySelectorAll<HTMLInputElement>('input[type="number"]')) {
      input.value = '';
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    flushSync();
    expect(panel.set).not.toHaveBeenCalled();
  });

  it('edits the off-course limit in feet while persisting SI', () => {
    const setLimitMeters = vi.fn();
    const panel = mountPanel({
      units: { mode: 'imperial', profile: IMPERIAL_UNITS } as UnitsStore,
      xte: {
        muted: false,
        setMuted: vi.fn(),
        limitMeters: 100,
        setLimitMeters,
        standing: 'client',
        alarming: false,
      },
    });
    const input = panel.target.querySelector<HTMLInputElement>(
      'input[aria-label="Local fallback off-course alarm limit"]',
    );
    if (!input) throw new Error('Missing off-course field');
    expect(input.valueAsNumber).toBeCloseTo(100 / 0.3048);
    input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(setLimitMeters).toHaveBeenCalledWith(100);
    input.value = '100';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(setLimitMeters).toHaveBeenLastCalledWith(30.48);
  });
  it('discards tuned thresholds only after the confirm step', () => {
    const panel = mountPanel();

    panel.click('Reset to defaults');
    expect(panel.target.textContent).toContain('Reset collision thresholds?');
    expect(panel.set).not.toHaveBeenCalled();

    panel.click('Cancel');
    expect(panel.target.textContent).not.toContain('Reset collision thresholds?');
    expect(panel.set).not.toHaveBeenCalled();

    panel.click('Reset to defaults');
    panel.click('Reset');
    expect(panel.set).toHaveBeenCalledWith(DEFAULT_THRESHOLDS);
    expect(panel.target.textContent).not.toContain('Reset collision thresholds?');
  });
});

describe('AlarmsPanel zone publish', () => {
  it('arms on the first tap, names the boat-wide effect, and publishes on the second', () => {
    const publish = vi.fn(async () => {});
    const panel = mountPanel({
      shallow: {
        monitorState: 'monitoring',
        serverLimitMeters: undefined,
        serverZonesActive: false,
        publish: {
          winningPath: 'environment.depth.belowKeel',
          effectiveLimitMeters: 3,
          busy: false,
          outcome: 'idle',
          publish,
        },
      },
    });

    panel.click('Publish to the boat');
    expect(publish).not.toHaveBeenCalled();

    // The armed label names what the second tap commits the whole boat to.
    panel.click('Alarm every station under 3.0 m?');
    expect(publish).toHaveBeenCalledOnce();
  });
});
