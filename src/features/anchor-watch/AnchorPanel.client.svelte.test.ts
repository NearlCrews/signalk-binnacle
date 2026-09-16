import { type ComponentProps, flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnchorWatch } from '$entities/anchor';
import type { UnitsStore } from '$entities/units';
import { OwnVessel } from '$entities/vessel';
import { type AuthController, SignalKStore } from '$shared/signalk';
import { createFakeStorage } from '$shared/testing';
import AnchorPanel from './AnchorPanel.svelte';

const cleanups: Array<() => void> = [];

function mountPanel() {
  const store = new SignalKStore();
  const vessel = new OwnVessel(store);
  const anchor = new AnchorWatch(store, vessel, undefined, createFakeStorage());
  anchor.dropLocal({ latitude: 42, longitude: -83 }, 50);
  const onSetPosition = vi.fn(async () => false);
  const target = document.createElement('div');
  document.body.append(target);
  const props: ComponentProps<typeof AnchorPanel> = {
    auth: { writeBlocked: false } as AuthController,
    anchor,
    vessel,
    units: { mode: 'metric' } as UnitsStore,
    onDrop: vi.fn(),
    onRaise: vi.fn(),
    onSetRadius: vi.fn(),
    onSetPosition,
    onClose: vi.fn(),
  };
  let component!: ReturnType<typeof mount>;
  flushSync(() => {
    component = mount(AnchorPanel, { target, props });
  });
  cleanups.push(() => {
    void unmount(component);
    target.remove();
  });
  const click = (label: string): void => {
    const button = [...target.querySelectorAll<HTMLButtonElement>('button')].find(
      (candidate) => candidate.textContent?.trim() === label,
    );
    if (!button) throw new Error(`Missing button: ${label}`);
    button.click();
    flushSync();
  };
  const latitude = (): HTMLInputElement => {
    const input = target.querySelector<HTMLInputElement>(
      'input[aria-label="Latitude in degrees north, negative for south"]',
    );
    if (!input) throw new Error('Missing latitude field');
    return input;
  };
  return { target, anchor, onSetPosition, click, latitude };
}

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

describe('AnchorPanel position correction', () => {
  it('returns focus to Raise anchor after canceling its confirmation', async () => {
    const panel = mountPanel();
    panel.click('Raise anchor');
    panel.click('Cancel');
    await vi.waitFor(() =>
      expect(document.activeElement?.textContent?.trim()).toBe('Raise anchor'),
    );
  });

  it('returns focus to the position action after canceling without changing its draft', async () => {
    const panel = mountPanel();
    panel.click('Edit anchor position');
    panel.click('Apply anchor position');
    panel.click('Cancel');
    await vi.waitFor(() =>
      expect(document.activeElement?.textContent?.trim()).toBe('Apply anchor position'),
    );
    expect(panel.latitude().valueAsNumber).toBe(42);
    expect(panel.onSetPosition).not.toHaveBeenCalled();
    panel.click('Cancel position edit');
    await vi.waitFor(() =>
      expect(document.activeElement?.textContent?.trim()).toBe('Edit anchor position'),
    );
  });

  it('requires confirmation and retains entered coordinates after failure for retry', async () => {
    const panel = mountPanel();
    panel.click('Edit anchor position');
    panel.latitude().value = '42.01';
    panel.latitude().dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    panel.click('Apply anchor position');
    expect(panel.onSetPosition).not.toHaveBeenCalled();
    panel.click('Move anchor');
    await Promise.resolve();
    flushSync();
    expect(panel.onSetPosition).toHaveBeenCalledWith({ latitude: 42.01, longitude: -83 });
    expect(panel.latitude().valueAsNumber).toBe(42.01);
    expect(panel.target.textContent).toContain('entered position is preserved');
    panel.onSetPosition.mockResolvedValueOnce(true);
    panel.click('Retry position');
    panel.click('Move anchor');
    await Promise.resolve();
    flushSync();
    expect(panel.target.textContent).toContain('Edit anchor position');
    expect(panel.onSetPosition).toHaveBeenCalledTimes(2);
  });

  it('invalidates confirmation if another station changes the anchor position', () => {
    const panel = mountPanel();
    panel.click('Edit anchor position');
    panel.click('Apply anchor position');
    panel.anchor.movePositionLocal({ latitude: 41, longitude: -82 });
    flushSync();
    expect(panel.target.textContent).not.toContain('Move the anchor watch to this position?');
    expect(panel.target.textContent).toContain('The anchor watch changed');
    expect(panel.onSetPosition).not.toHaveBeenCalled();
  });
});
