import { type ComponentProps, flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NotificationsStore } from '$entities/notifications';
import type { UnitsStore } from '$entities/units';
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
  it('discards tuned thresholds only after the confirm step', () => {
    const panel = mountPanel();

    panel.click('Reset to defaults');
    expect(panel.target.textContent).toContain('Reset all thresholds?');
    expect(panel.set).not.toHaveBeenCalled();

    panel.click('Cancel');
    expect(panel.target.textContent).not.toContain('Reset all thresholds?');
    expect(panel.set).not.toHaveBeenCalled();

    panel.click('Reset to defaults');
    panel.click('Reset');
    expect(panel.set).toHaveBeenCalledWith(DEFAULT_THRESHOLDS);
    expect(panel.target.textContent).not.toContain('Reset all thresholds?');
  });
});
