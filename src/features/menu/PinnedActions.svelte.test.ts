import { describe, expect, it, vi } from 'vitest';
import {
  handlePinnedMenuKeydown,
  initializePinnedMenuFocus,
  restorePinnedMenuFocus,
} from './PinnedActions.svelte';

interface FakeItem {
  tabIndex: number;
  focus: ReturnType<typeof vi.fn>;
}

function item(): FakeItem {
  return { tabIndex: 0, focus: vi.fn() };
}

function surface(items: FakeItem[]): HTMLElement {
  return {
    querySelectorAll: vi.fn(() => items),
  } as unknown as HTMLElement;
}

function key(value: string): KeyboardEvent {
  return { key: value, preventDefault: vi.fn() } as unknown as KeyboardEvent;
}

describe('PinnedActions More menu focus', () => {
  it('focuses one enabled menu item and removes its peers from the tab order', () => {
    const items = [item(), item(), item()];
    const menu = surface(items);

    initializePinnedMenuFocus(menu);

    expect(items.map(({ tabIndex }) => tabIndex)).toEqual([0, -1, -1]);
    expect(items[0]?.focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it.each([
    ['ArrowDown', 1],
    ['ArrowUp', 2],
    ['Home', 0],
    ['End', 2],
  ])('moves menu focus with %s', (value, expected) => {
    const items = [item(), item(), item()];
    const event = key(value);

    handlePinnedMenuKeydown(event, surface(items), items[0] as unknown as Element);

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(items[expected]?.focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it('restores the trigger after popup focus is removed', () => {
    const trigger = { focus: vi.fn(), isConnected: true } as unknown as HTMLElement;
    const body = {} as HTMLElement;
    const removedItem = { isConnected: false } as unknown as Element;

    restorePinnedMenuFocus(trigger, removedItem, body);

    expect(trigger.focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it('preserves focus when an action moved it to another live surface', () => {
    const trigger = { focus: vi.fn(), isConnected: true } as unknown as HTMLElement;
    const body = {} as HTMLElement;
    const nextControl = { isConnected: true } as unknown as Element;

    restorePinnedMenuFocus(trigger, nextControl, body);

    expect(trigger.focus).not.toHaveBeenCalled();
  });
});
