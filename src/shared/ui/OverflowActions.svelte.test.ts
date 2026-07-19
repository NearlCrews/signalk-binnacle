import { describe, expect, it, vi } from 'vitest';
import {
  handleOverflowMenuKeydown,
  initializeOverflowMenuFocus,
  overflowTabTarget,
  restoreOverflowMenuFocus,
} from './OverflowActions.svelte';

interface FakeItem {
  tabIndex: number;
  focus: ReturnType<typeof vi.fn>;
}

function item(): FakeItem {
  return { tabIndex: 0, focus: vi.fn() };
}

function surface(items: FakeItem[]) {
  return {
    querySelectorAll: vi.fn(() => items),
  } as unknown as HTMLElement;
}

function key(keyValue: string, shiftKey = false): KeyboardEvent {
  return { key: keyValue, preventDefault: vi.fn(), shiftKey } as unknown as KeyboardEvent;
}

describe('OverflowActions menu focus', () => {
  it('initializes one enabled menu item in the tab sequence', () => {
    const items = [item(), item(), item()];
    const menu = surface(items);

    initializeOverflowMenuFocus(menu);

    expect(menu.querySelectorAll).toHaveBeenCalledWith(
      '[role="menuitem"]:not(:disabled):not([aria-disabled="true"])',
    );
    expect(items.map(({ tabIndex }) => tabIndex)).toEqual([0, -1, -1]);
    expect(items[0]?.focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it.each([
    ['ArrowDown', 1],
    ['ArrowUp', 2],
    ['Home', 0],
    ['End', 2],
  ])(
    'moves focus for %s and skips items excluded by the enabled selector',
    (keyValue, expected) => {
      const items = [item(), item(), item()];
      const menu = surface(items);
      const event = key(keyValue);

      handleOverflowMenuKeydown(event, menu, items[0] as unknown as Element);

      expect(event.preventDefault).toHaveBeenCalledOnce();
      expect(items[expected]?.focus).toHaveBeenCalledWith({ preventScroll: true });
      expect(items.map(({ tabIndex }) => tabIndex)).toEqual(
        items.map((_, index) => (index === expected ? 0 : -1)),
      );
    },
  );

  it.each([
    [false, false],
    [true, true],
  ])('closes on Tab and reports the direction (shift=%s)', (shiftKey, expectedReverse) => {
    const event = key('Tab', shiftKey);
    const onTab = vi.fn(() => true);

    handleOverflowMenuKeydown(event, surface([item()]), null, onTab);

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(onTab).toHaveBeenCalledWith(expectedReverse);
  });

  it('allows native forward Tab behavior when there is no explicit focus target', () => {
    const event = key('Tab');

    handleOverflowMenuKeydown(event, surface([item()]), null, () => false);

    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('moves forward past the trigger while Shift+Tab returns to it', () => {
    const trigger = { classList: { contains: () => false } } as unknown as HTMLElement;
    const backdrop = {
      classList: { contains: (name: string) => name === 'anchored-menu-backdrop' },
    } as unknown as HTMLElement;
    const menuItem = { classList: { contains: () => false } } as unknown as HTMLElement;
    const next = { classList: { contains: () => false } } as unknown as HTMLElement;
    const menu = {
      contains: (candidate: HTMLElement) => candidate === menuItem,
    } as unknown as HTMLElement;
    const candidates = [trigger, backdrop, menuItem, next];

    expect(overflowTabTarget(trigger, menu, false, candidates)).toBe(next);
    expect(overflowTabTarget(trigger, menu, true, candidates)).toBe(trigger);
  });

  it('does not loop forward to the trigger when it is the final focusable control', () => {
    const trigger = { classList: { contains: () => false } } as unknown as HTMLElement;

    expect(overflowTabTarget(trigger, undefined, false, [trigger])).toBeUndefined();
  });

  it('restores the trigger when a prop-driven close removes the focused menu', () => {
    const trigger = {
      focus: vi.fn(),
      isConnected: true,
    } as unknown as HTMLElement;
    const body = {} as HTMLElement;

    restoreOverflowMenuFocus(undefined, trigger, undefined, body, body);

    expect(trigger.focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it('keeps focus on a newly mounted action control after close', () => {
    const trigger = {
      focus: vi.fn(),
      isConnected: true,
    } as unknown as HTMLElement;
    const activeControl = { isConnected: true } as unknown as Element;
    const body = {} as HTMLElement;

    restoreOverflowMenuFocus(undefined, trigger, undefined, activeControl, body);

    expect(trigger.focus).not.toHaveBeenCalled();
  });
});
