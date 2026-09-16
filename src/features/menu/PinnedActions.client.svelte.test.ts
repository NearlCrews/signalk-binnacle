import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import PinnedActions from './PinnedActions.svelte';

afterEach(() => vi.unstubAllGlobals());

describe('pinned action availability and resize lifecycle', () => {
  it.each([
    ['44px', 4],
    ['2.75rem', 3],
  ] as const)(
    'fits inherited %s controls without shrinking the available toolbar column',
    async (controlSize, expectedPills) => {
      const previousViewport = { width: window.innerWidth, height: window.innerHeight };
      await page.viewport(568, 320);
      const rootStyle = document.documentElement.style;
      const previousRootStyle = rootStyle.cssText;
      rootStyle.fontSize = '24px';
      rootStyle.setProperty('--control-size', '2.75rem');
      const target = document.createElement('div');
      target.dataset.pinnedCapacityTest = '';
      target.style.cssText = `display:grid;grid-template-columns:1fr;justify-items:center;width:220px;--control-size:${controlSize};--space-1:4px;--space-2:4px;`;
      const style = document.createElement('style');
      style.textContent = `
      [data-pinned-capacity-test] .btn-pill { min-block-size:var(--control-size); min-inline-size:var(--control-size); box-sizing:border-box; }
      [data-pinned-capacity-test] .visually-hidden { position:absolute; inline-size:1px; block-size:1px; overflow:hidden; clip-path:inset(50%); }
    `;
      document.head.append(style);
      document.body.append(target);
      const component = mount(PinnedActions, {
        target,
        props: {
          actions: ['Menu', 'Center', 'Follow', 'AIS'].map((label) => ({
            id: label,
            label,
            onSelect: () => {},
          })),
        },
      });
      flushSync();
      try {
        for (let frame = 0; frame < 4; frame += 1) {
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          flushSync();
          expect(target.querySelector<HTMLElement>('.pinned-actions')?.clientWidth).toBe(220);
          expect(target.querySelectorAll('.btn-pill')).toHaveLength(expectedPills);
          expect(target.querySelector('.pinned-actions > button')?.textContent).toContain('Menu');
        }
      } finally {
        await unmount(component);
        target.remove();
        style.remove();
        rootStyle.cssText = previousRootStyle;
        await page.viewport(previousViewport.width, previousViewport.height);
      }
    },
  );

  it('lets a blocked action explain itself without invoking it', async () => {
    const target = document.createElement('div');
    document.body.append(target);
    const onSelect = vi.fn();
    const component = mount(PinnedActions, {
      target,
      props: {
        actions: [
          {
            id: 'radar',
            label: 'Radar',
            available: false,
            unavailableHint: 'No radar detected. Connect a radar provider.',
            onSelect,
          },
        ],
      },
    });
    flushSync();
    try {
      const button = target.querySelector<HTMLButtonElement>('button[aria-disabled="true"]');
      if (!button) throw new Error('Missing unavailable pinned action');
      expect(button.disabled).toBe(false);
      button.focus();
      expect(document.activeElement).toBe(button);
      button.click();
      flushSync();
      expect(onSelect).not.toHaveBeenCalled();
      expect(target.querySelector('[role="status"]')?.textContent).toContain('No radar detected');
    } finally {
      await unmount(component);
      target.remove();
    }
  });

  it('keeps an unavailable overflow action reachable and explains it inside the menu', async () => {
    const target = document.createElement('div');
    document.body.append(target);
    const onSelect = vi.fn();
    const actions = Array.from({ length: 8 }, (_, index) => ({
      id: `action-${index}`,
      label: `Action ${index}`,
      onSelect,
      available: index !== 7,
      unavailableHint: index === 7 ? 'Connect the optional provider.' : undefined,
    }));
    const component = mount(PinnedActions, { target, props: { actions } });
    flushSync();
    try {
      const more = target.querySelector<HTMLButtonElement>('button[aria-label^="More actions"]');
      if (!more) throw new Error('Missing More actions control');
      more.click();
      flushSync();
      const blocked = target.querySelector<HTMLButtonElement>(
        '[role="menuitem"][aria-disabled="true"]',
      );
      if (!blocked) throw new Error('Missing unavailable overflow action');
      expect(blocked.disabled).toBe(false);
      blocked.click();
      flushSync();
      expect(onSelect).not.toHaveBeenCalled();
      expect(target.querySelector('[role="menu"] [role="status"]')?.textContent).toBe(
        'Connect the optional provider.',
      );
      expect(target.querySelector('[role="menu"]')).not.toBeNull();
    } finally {
      await unmount(component);
      target.remove();
    }
  });

  it('coalesces resize deliveries outside the observer callback and cancels pending work on teardown', async () => {
    let delivery: ResizeObserverCallback | undefined;
    const disconnect = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          delivery = callback;
        }
        observe(): void {}
        disconnect = disconnect;
      },
    );
    let nextFrame = 0;
    const frames = new Map<number, FrameRequestCallback>();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      nextFrame += 1;
      frames.set(nextFrame, callback);
      return nextFrame;
    });
    const cancel = vi.fn((id: number) => {
      frames.delete(id);
    });
    vi.stubGlobal('cancelAnimationFrame', cancel);
    const target = document.createElement('div');
    document.body.append(target);
    const component = mount(PinnedActions, {
      target,
      props: { actions: [{ id: 'menu', label: 'Menu', onSelect: () => {} }] },
    });
    flushSync();
    try {
      delivery?.([], {} as ResizeObserver);
      delivery?.([], {} as ResizeObserver);
      expect(frames.size).toBe(1);
      const frame = [...frames.entries()][0];
      frames.delete(frame[0]);
      frame[1](0);
      flushSync();
      expect(frames.size).toBe(0);
      delivery?.([], {} as ResizeObserver);
      expect(frames.size).toBe(1);
    } finally {
      await unmount(component);
      target.remove();
    }
    expect(disconnect).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledOnce();
    expect(frames.size).toBe(0);
  });
});
