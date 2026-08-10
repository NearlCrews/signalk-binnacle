import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createMenuFocusMachine,
  handleMenuKeydown,
  initializeMenuFocus,
  MENU_ITEM_SELECTOR,
  menuFocusLeft,
  menuTabTarget,
  restoreMenuFocus,
} from './menu-focus';

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

function key(value: string, shiftKey = false): KeyboardEvent {
  return { key: value, preventDefault: vi.fn(), shiftKey } as unknown as KeyboardEvent;
}

describe('menu-focus selector', () => {
  it('excludes disabled and aria-disabled menu items and menu checkboxes', () => {
    // The one selector every anchored menu queries: a grayed, action-blocked row is never in the
    // roving set, resolving the earlier drift where one menu skipped aria-disabled items and the
    // other did not.
    expect(MENU_ITEM_SELECTOR).toBe(
      '[role="menuitem"]:not(:disabled):not([aria-disabled="true"]), [role="menuitemcheckbox"]:not(:disabled):not([aria-disabled="true"])',
    );
  });

  it('queries the surface with the shared selector by default', () => {
    const menu = surface([item()]);

    initializeMenuFocus(menu);

    expect(menu.querySelectorAll).toHaveBeenCalledWith(MENU_ITEM_SELECTOR);
  });
});

describe('initializeMenuFocus', () => {
  it('focuses the first item and removes its peers from the tab order', () => {
    const items = [item(), item(), item()];

    initializeMenuFocus(surface(items));

    expect(items.map(({ tabIndex }) => tabIndex)).toEqual([0, -1, -1]);
    expect(items[0]?.focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it('does nothing when the surface has no enabled items', () => {
    const menu = surface([]);

    expect(() => initializeMenuFocus(menu)).not.toThrow();
  });
});

describe('handleMenuKeydown roving', () => {
  it.each([
    ['ArrowDown', 1],
    ['ArrowUp', 2],
    ['Home', 0],
    ['End', 2],
  ])('moves focus and the tab order with %s', (value, expected) => {
    const items = [item(), item(), item()];
    const event = key(value);

    handleMenuKeydown(event, surface(items), items[0] as unknown as Element);

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(items[expected]?.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(items.map(({ tabIndex }) => tabIndex)).toEqual(
      items.map((_, index) => (index === expected ? 0 : -1)),
    );
  });

  it('wraps ArrowDown past the last item back to the first', () => {
    const items = [item(), item(), item()];
    const event = key('ArrowDown');

    handleMenuKeydown(event, surface(items), items[2] as unknown as Element);

    expect(items[0]?.focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it('lands ArrowDown on the first item and ArrowUp on the last when focus is outside the set', () => {
    const down = [item(), item(), item()];
    const downEvent = key('ArrowDown');
    handleMenuKeydown(downEvent, surface(down), null);
    expect(down[0]?.focus).toHaveBeenCalledWith({ preventScroll: true });

    const up = [item(), item(), item()];
    const upEvent = key('ArrowUp');
    handleMenuKeydown(upEvent, surface(up), null);
    expect(up[2]?.focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it('ignores keys that are not navigation or Tab', () => {
    const event = key('Enter');

    handleMenuKeydown(event, surface([item()]), null);

    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});

describe('handleMenuKeydown Tab', () => {
  it.each([
    [false, false],
    [true, true],
  ])('routes Tab to the onTab handler and reports direction (shift=%s)', (shiftKey, reverse) => {
    const event = key('Tab', shiftKey);
    const onTab = vi.fn(() => true);

    handleMenuKeydown(event, surface([item()]), null, onTab);

    expect(onTab).toHaveBeenCalledWith(reverse);
    expect(event.preventDefault).toHaveBeenCalledOnce();
  });

  it('leaves native Tab behavior when the handler declines to redirect', () => {
    const event = key('Tab');

    handleMenuKeydown(event, surface([item()]), null, () => false);

    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('does not treat Tab as navigation when no onTab handler is given', () => {
    const event = key('Tab');

    handleMenuKeydown(event, surface([item()]), null);

    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});

describe('menuTabTarget', () => {
  it('moves forward past the trigger and returns to it on reverse Tab', () => {
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

    expect(menuTabTarget(trigger, menu, false, candidates)).toBe(next);
    expect(menuTabTarget(trigger, menu, true, candidates)).toBe(trigger);
  });

  it('returns undefined when the trigger is the final focusable control', () => {
    const trigger = { classList: { contains: () => false } } as unknown as HTMLElement;

    expect(menuTabTarget(trigger, undefined, false, [trigger])).toBeUndefined();
  });

  it('returns undefined without a trigger', () => {
    expect(menuTabTarget(undefined, undefined, false, [])).toBeUndefined();
  });
});

describe('menuFocusLeft', () => {
  const inside = {} as Node;
  const outside = {} as Node;
  const menu = {
    contains: (node: Node) => node === inside,
  } as unknown as HTMLElement;

  it('is true when focus moved to a concrete control outside the surface', () => {
    expect(menuFocusLeft(outside, menu)).toBe(true);
  });

  it('is false when focus stayed on a control inside the surface', () => {
    expect(menuFocusLeft(inside, menu)).toBe(false);
  });

  it('is false when focus was lost to the document body (relatedTarget null)', () => {
    expect(menuFocusLeft(null, menu)).toBe(false);
  });

  it('is false before the surface has mounted', () => {
    expect(menuFocusLeft(outside, undefined)).toBe(false);
  });
});

describe('restoreMenuFocus', () => {
  it('focuses the requested redirect target when it is still connected', () => {
    const requested = { focus: vi.fn(), isConnected: true } as unknown as HTMLElement;
    const trigger = { focus: vi.fn(), isConnected: true } as unknown as HTMLElement;

    restoreMenuFocus(requested, trigger, undefined, {} as Element, {} as HTMLElement);

    expect(requested.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(trigger.focus).not.toHaveBeenCalled();
  });

  it('restores the trigger when no target is requested and focus was lost', () => {
    const trigger = { focus: vi.fn(), isConnected: true } as unknown as HTMLElement;
    const body = {} as HTMLElement;

    restoreMenuFocus(undefined, trigger, undefined, body, body);

    expect(trigger.focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it('leaves focus on a live control an action moved it to', () => {
    const trigger = { focus: vi.fn(), isConnected: true } as unknown as HTMLElement;
    const live = { isConnected: true } as unknown as Element;

    restoreMenuFocus(undefined, trigger, undefined, live, {} as HTMLElement);

    expect(trigger.focus).not.toHaveBeenCalled();
  });
});

describe('createMenuFocusMachine syncOpen', () => {
  const frames: FrameRequestCallback[] = [];

  function stubFrames(): void {
    frames.length = 0;
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => frames.push(callback)),
    );
    vi.stubGlobal(
      'cancelAnimationFrame',
      vi.fn((id: number) => {
        frames[id - 1] = () => {};
      }),
    );
  }

  function flushFrames(): void {
    // A frame callback may schedule the next frame, so walk the growing list in place.
    for (let index = 0; index < frames.length; index++) frames[index]?.(0);
  }

  function machineWith(items: FakeItem[], focusFrames?: number) {
    const menu = surface(items);
    return createMenuFocusMachine({
      surface: () => menu,
      trigger: () => undefined,
      requestClose: vi.fn(),
      ...(focusFrames === undefined ? {} : { focusFrames }),
    });
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('schedules the initial roving focus one frame after open', () => {
    stubFrames();
    const items = [item(), item()];
    const machine = machineWith(items);

    machine.syncOpen(true);

    expect(items[0]?.focus).not.toHaveBeenCalled();
    flushFrames();
    expect(items[0]?.focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it('waits the extra positioning frame when focusFrames is 2', () => {
    stubFrames();
    const items = [item()];
    const machine = machineWith(items, 2);

    machine.syncOpen(true);

    frames[0]?.(0);
    expect(items[0]?.focus).not.toHaveBeenCalled();
    flushFrames();
    expect(items[0]?.focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it('cleanup cancels the pending focus frame', () => {
    stubFrames();
    const items = [item()];
    const machine = machineWith(items);

    const cleanup = machine.syncOpen(true);
    cleanup?.();
    flushFrames();

    expect(items[0]?.focus).not.toHaveBeenCalled();
  });

  it('returns no cleanup for a close before any open', () => {
    stubFrames();
    expect(machineWith([]).syncOpen(false)).toBeUndefined();
  });
});
