import Crosshair from '@lucide/svelte/icons/crosshair';
import Navigation from '@lucide/svelte/icons/navigation';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import A11Y_CSS from '../../styles/a11y.css?raw';
import BUTTONS_CSS from '../../styles/buttons.css?raw';
import DATA_CELLS_CSS from '../../styles/data-cells.css?raw';
import TOKENS_CSS from '../../styles/tokens.css?raw';
import PinnedActions from './PinnedActions.svelte';

afterEach(() => vi.unstubAllGlobals());

const FOUR_ACTIONS = ['Menu', 'Center', 'Follow', 'AIS'].map((label) => ({
  id: label,
  label,
  onSelect: () => {},
}));

interface CapacityHarness {
  target: HTMLElement;
  // Wait out animation frames, flushing after each, so a resize measurement lands.
  settle: (frames?: number) => Promise<void>;
}

// A stacked-strip toolbar column at large text in a portrait phone viewport: the bar measures the
// column it is given, with just enough tile styling for real control sizes. The viewport, root
// style, and mount are restored afterward.
async function withCapacityHarness(
  columnWidth: number,
  controlSize: string,
  run: (harness: CapacityHarness) => Promise<void>,
): Promise<void> {
  const previousViewport = { width: window.innerWidth, height: window.innerHeight };
  await page.viewport(320, 568);
  const rootStyle = document.documentElement.style;
  const previousRootStyle = rootStyle.cssText;
  rootStyle.fontSize = '24px';
  rootStyle.setProperty('--control-size', '2.75rem');
  const target = document.createElement('div');
  target.dataset.pinnedCapacityTest = '';
  target.style.cssText = `display:grid;grid-template-columns:1fr;justify-items:center;width:${columnWidth}px;--control-size:${controlSize};--space-1:4px;--space-2:4px;`;
  const style = document.createElement('style');
  style.textContent = `
    [data-pinned-capacity-test] .bar-tile { min-block-size:var(--control-size); min-inline-size:var(--control-size); box-sizing:border-box; }
    [data-pinned-capacity-test] .visually-hidden { position:absolute; inline-size:1px; block-size:1px; overflow:hidden; clip-path:inset(50%); }
  `;
  document.head.append(style);
  document.body.append(target);
  const component = mount(PinnedActions, { target, props: { actions: FOUR_ACTIONS } });
  flushSync();
  const settle = async (frames = 4): Promise<void> => {
    for (let frame = 0; frame < frames; frame += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      flushSync();
    }
  };
  try {
    await run({ target, settle });
  } finally {
    await unmount(component);
    target.remove();
    style.remove();
    rootStyle.cssText = previousRootStyle;
    await page.viewport(previousViewport.width, previousViewport.height);
  }
}

describe('pinned action availability and resize lifecycle', () => {
  it.each([
    ['44px', 4],
    ['2.75rem', 3],
  ] as const)(
    'fits inherited %s controls without shrinking the available toolbar column',
    (controlSize, expectedPills) =>
      withCapacityHarness(220, controlSize, async ({ target, settle }) => {
        for (let frame = 0; frame < 4; frame += 1) {
          await settle(1);
          expect(target.querySelector<HTMLElement>('.pinned-actions')?.clientWidth).toBe(220);
          expect(target.querySelectorAll('.bar-tile')).toHaveLength(expectedPills);
          expect(target.querySelector('.pinned-actions > button')?.textContent).toContain('Menu');
        }
      }),
  );

  it('regains its full pill count at large text when a phone turns sideways', () =>
    // A 100px column fits two 44px pills; sideways the bar is sized to its own pills, so a capacity
    // measured from it would hold at two.
    withCapacityHarness(100, '44px', async ({ target, settle }) => {
      await settle();
      expect(target.querySelectorAll('.bar-tile')).toHaveLength(2);
      await page.viewport(568, 320);
      await settle();
      expect(target.querySelectorAll('.bar-tile')).toHaveLength(4);
    }));

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

describe('pinned tile alignment', () => {
  it('centers the icon and label in a stacked tile', async () => {
    const previousViewport = { width: window.innerWidth, height: window.innerHeight };
    await page.viewport(1400, 700);
    const sheet = document.createElement('style');
    sheet.textContent = `${TOKENS_CSS}\n${BUTTONS_CSS}\n${DATA_CELLS_CSS}\n${A11Y_CSS}`;
    document.head.append(sheet);
    const target = document.createElement('div');
    target.style.cssText = 'display:grid;width:600px;';
    document.body.append(target);
    const actions = [
      { id: 'center', label: 'Center', icon: Crosshair, onSelect: () => {} },
      { id: 'follow', label: 'Follow', icon: Navigation, onSelect: () => {} },
    ];
    const component = mount(PinnedActions, { target, props: { actions } });
    flushSync();
    try {
      await document.fonts.ready;
      const tiles = [...target.querySelectorAll<HTMLElement>('.bar-tile')];
      expect(tiles).toHaveLength(2);
      for (const tile of tiles) {
        const box = tile.getBoundingClientRect();
        const icon = tile.querySelector('svg')?.getBoundingClientRect();
        // The text's own box, not the label's line box: the line box is symmetric even while the
        // glyphs ride high on a strut sized for the readout numerals.
        const text = tile.querySelector('.tile-label .truncate')?.firstChild;
        if (!icon || !text) throw new Error('tile is missing its icon or label');
        const range = document.createRange();
        range.selectNodeContents(text);
        const label = range.getBoundingClientRect();
        const gapAbove = icon.top - box.top;
        const gapBelow = box.bottom - label.bottom;
        expect(Math.abs(gapAbove - gapBelow), tile.textContent ?? '').toBeLessThanOrEqual(1);
      }
    } finally {
      await unmount(component);
      target.remove();
      sheet.remove();
      await page.viewport(previousViewport.width, previousViewport.height);
    }
  });
});
