import { createRawSnippet, flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import OVERLAYS_CSS from '../../styles/overlays.css?raw';
import TOKENS_CSS from '../../styles/tokens.css?raw';
import AnchoredMenu from './AnchoredMenu.svelte';

vi.mock('$shared/lib', () => ({ prefersReducedMotion: () => true }));

afterEach(() => vi.unstubAllGlobals());

function setup(onPositioned: () => void) {
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = ++nextFrame;
    frames.set(id, callback);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  const target = document.createElement('div');
  const anchor = document.createElement('button');
  anchor.style.cssText = 'position:fixed;right:0;bottom:0;width:44px;height:44px;';
  document.body.append(anchor, target);
  const component = mount(AnchoredMenu, {
    target,
    props: {
      open: true,
      anchor,
      onClose: () => {},
      onPositioned,
      backdropLabel: 'Close actions',
      surfaceStyle: 'width:160px;height:96px;',
      children: createRawSnippet(() => ({ render: () => '<button>Action</button>' })),
    },
  });
  flushSync();
  const surface = target.querySelector<HTMLElement>('.anchored-menu-surface');
  if (!surface) throw new Error('Missing menu surface');
  return {
    target,
    anchor,
    surface,
    component,
    flushFrame() {
      const pending = [...frames.values()];
      frames.clear();
      for (const callback of pending) callback(0);
    },
    async destroy() {
      await unmount(component);
      anchor.remove();
      target.remove();
    },
  };
}

describe('anchored menu placement callback', () => {
  it('measures the visible viewport-clamped surface before initial focus and calls once', async () => {
    const onPositioned = vi.fn(() => {
      expect(readBounds).toHaveBeenCalledOnce();
      expect(test.surface.style.visibility).toBe('visible');
      const bounds = readBounds.mock.results[0]?.value;
      if (!bounds) throw new Error('Missing placed bounds');
      expect(bounds.left).toBeGreaterThanOrEqual(8);
      expect(bounds.top).toBeGreaterThanOrEqual(8);
      expect(bounds.right).toBeLessThanOrEqual(document.documentElement.clientWidth - 8);
      expect(bounds.bottom).toBeLessThanOrEqual(document.documentElement.clientHeight - 8);
      const action = test.surface.querySelector('button');
      action?.focus({ preventScroll: true });
      expect(document.activeElement).toBe(action);
    });
    const test = setup(onPositioned);
    const readBounds = vi.spyOn(test.surface, 'getBoundingClientRect');
    try {
      expect(onPositioned).not.toHaveBeenCalled();
      test.flushFrame();
      await tick();
      expect(onPositioned).toHaveBeenCalledOnce();
      window.dispatchEvent(new Event('resize'));
      test.flushFrame();
      await tick();
      expect(onPositioned).toHaveBeenCalledOnce();
    } finally {
      readBounds.mockRestore();
      await test.destroy();
    }
  });

  it('waits for a real resize when an ancestor has no layout box', async () => {
    const onPositioned = vi.fn();
    const test = setup(onPositioned);
    try {
      test.target.style.display = 'none';
      test.flushFrame();
      await tick();
      expect(onPositioned).not.toHaveBeenCalled();
      test.target.style.removeProperty('display');
      window.dispatchEvent(new Event('resize'));
      test.flushFrame();
      await tick();
      expect(onPositioned).toHaveBeenCalledOnce();
    } finally {
      await test.destroy();
    }
  });

  it('cancels a pending placement callback when the surface is destroyed', async () => {
    const onPositioned = vi.fn();
    const test = setup(onPositioned);
    test.flushFrame();
    await test.destroy();
    await tick();
    test.flushFrame();
    expect(onPositioned).not.toHaveBeenCalled();
  });

  it('does not measure or focus a surface inside an inert ancestor', async () => {
    const onPositioned = vi.fn();
    const test = setup(onPositioned);
    const readBounds = vi.spyOn(test.surface, 'getBoundingClientRect');
    try {
      test.flushFrame();
      test.target.inert = true;
      await tick();
      expect(readBounds).not.toHaveBeenCalled();
      expect(onPositioned).not.toHaveBeenCalled();
      test.target.inert = false;
      window.dispatchEvent(new Event('resize'));
      test.flushFrame();
      await tick();
      expect(onPositioned).toHaveBeenCalledOnce();
    } finally {
      readBounds.mockRestore();
      await test.destroy();
    }
  });
});

describe('anchored menu over the status bar', () => {
  // A status bar with a control on it, and a menu opened from the bar's opener group.
  function barSetup() {
    const bar = document.createElement('footer');
    bar.dataset.liveChrome = '';
    bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;height:60px;';
    const control = document.createElement('button');
    control.textContent = 'MOB';
    const onControl = vi.fn();
    control.addEventListener('click', onControl);
    const group = document.createElement('div');
    group.dataset.menuOpenerGroup = '';
    const trigger = document.createElement('button');
    trigger.textContent = 'Menu';
    const target = document.createElement('div');
    group.append(trigger, target);
    bar.append(group, control);
    document.body.append(bar);
    const sheet = document.createElement('style');
    sheet.textContent = `${TOKENS_CSS}\n${OVERLAYS_CSS}`;
    document.head.append(sheet);
    document.documentElement.style.setProperty('--bar-block-size', '60px');
    const onClose = vi.fn();
    const component = mount(AnchoredMenu, {
      target,
      props: {
        open: true,
        onClose,
        backdropLabel: 'Close menu',
        children: createRawSnippet(() => ({ render: () => '<button>Action</button>' })),
      },
    });
    flushSync();
    return {
      bar,
      control,
      trigger,
      onClose,
      onControl,
      async destroy() {
        await unmount(component);
        bar.remove();
        sheet.remove();
        document.documentElement.style.removeProperty('--bar-block-size');
      },
    };
  }

  function tap(element: Element): void {
    element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    (element as HTMLElement).click();
  }

  it('closes on a tap on a bar control and lets that control act in the same tap', async () => {
    const test = barSetup();
    try {
      tap(test.control);
      expect(test.onClose).toHaveBeenCalledOnce();
      expect(test.onControl).toHaveBeenCalledOnce();
    } finally {
      await test.destroy();
    }
  });

  it('leaves its own opener to toggle it, so a tap there never closes and reopens', async () => {
    const test = barSetup();
    try {
      tap(test.trigger);
      expect(test.onClose).not.toHaveBeenCalled();
    } finally {
      await test.destroy();
    }
  });

  it('stops its backdrop at the bar, so the bar is never covered', async () => {
    const test = barSetup();
    try {
      const backdrop = document.querySelector('.anchored-menu-backdrop');
      if (!backdrop) throw new Error('no backdrop');
      const box = backdrop.getBoundingClientRect();
      expect(box.top).toBe(0);
      expect(box.bottom).toBeCloseTo(window.innerHeight - 60, 0);
    } finally {
      await test.destroy();
    }
  });

  it('still absorbs a tap away from the bar with its backdrop', async () => {
    const test = barSetup();
    const outside = document.createElement('button');
    document.body.append(outside);
    try {
      outside.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
      expect(test.onClose).not.toHaveBeenCalled();
    } finally {
      outside.remove();
      await test.destroy();
    }
  });
});
