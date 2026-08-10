// The keyboard-focus machine for a toolbar AnchoredMenu with role="menu" and a trigger button:
// the overflow menu (OverflowActions) and the pinned-actions More menu (PinnedActions). It keeps
// arrow-key roving, the initial focus on open, focus restore on close, and the Tab redirect
// identical across both, so neither drifts from its sibling. The map menus (weather layers, chart
// context) rove with the rovingFocus action instead and share only the close-on-focus-out
// contract, which AnchoredMenu itself applies through menuFocusLeft. Disabled and aria-disabled
// items are excluded from the roving set in every menu, so a grayed item is never arrow-reachable.

import { FOCUSABLE_SELECTOR, isRovingKey, nextRovingIndex } from './focus';

// menuitemcheckbox covers the toolbar More menu's toggle rows; menuitem covers the rest. Both
// exclude the disabled and aria-disabled states so the roving set matches what a pointer can
// activate: a grayed, action-blocked row is skipped, not silently focused.
export const MENU_ITEM_SELECTOR =
  '[role="menuitem"]:not(:disabled):not([aria-disabled="true"]), [role="menuitemcheckbox"]:not(:disabled):not([aria-disabled="true"])';

function menuItems(surface: HTMLElement | undefined): HTMLElement[] {
  return surface ? [...surface.querySelectorAll<HTMLElement>(MENU_ITEM_SELECTOR)] : [];
}

function focusMenuItem(items: HTMLElement[], index: number): void {
  for (const [itemIndex, item] of items.entries()) item.tabIndex = itemIndex === index ? 0 : -1;
  items[index]?.focus({ preventScroll: true });
}

export function initializeMenuFocus(surface: HTMLElement | undefined): void {
  const items = menuItems(surface);
  if (items.length > 0) focusMenuItem(items, 0);
}

export function handleMenuKeydown(
  event: KeyboardEvent,
  surface: HTMLElement | undefined,
  activeElement: Element | null = document.activeElement,
  onTab?: (reverse: boolean) => boolean,
): void {
  if (event.key === 'Tab' && onTab) {
    if (onTab(event.shiftKey)) event.preventDefault();
    return;
  }
  if (!isRovingKey(event.key)) return;

  const items = menuItems(surface);
  if (items.length === 0) return;
  event.preventDefault();

  const current = items.indexOf(activeElement as HTMLElement);
  focusMenuItem(items, nextRovingIndex(event.key, current, items.length));
}

// The page's focusable controls in document order, handed to menuTabTarget by the machine.
function documentFocusables(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)];
}

// The control a forward Tab should land on (the one after the trigger, so Tab continues from the
// trigger's place in the page rather than the surface's DOM position), or the trigger itself for a
// reverse Tab. undefined when there is no trigger or the trigger is the last focusable control, so
// the caller can fall back to native Tab.
export function menuTabTarget(
  trigger: HTMLElement | undefined,
  surface: HTMLElement | undefined,
  reverse: boolean,
  candidates: readonly HTMLElement[],
): HTMLElement | undefined {
  if (!trigger) return undefined;
  if (reverse) return trigger;
  const outsideMenu = candidates.filter(
    (candidate) =>
      !surface?.contains(candidate) && !candidate.classList.contains('anchored-menu-backdrop'),
  );
  const triggerIndex = outsideMenu.indexOf(trigger);
  return triggerIndex < 0 ? trigger : outsideMenu[triggerIndex + 1];
}

// True only when focus moved to a concrete control outside the menu surface, so a caller can close
// the menu on focus-out. A move between two items inside the surface, or a transient loss to the
// document body (relatedTarget null) during an in-place content swap, returns false, so an internal
// step change (the chart menu's confirm prompt) never self-closes the menu. A focus event's
// relatedTarget is always an element or null, so the cast to Node is safe.
export function menuFocusLeft(next: EventTarget | null, surface: HTMLElement | undefined): boolean {
  if (next === null || surface === undefined) return false;
  return !surface.contains(next as Node);
}

export function restoreMenuFocus(
  requested: HTMLElement | undefined,
  trigger: HTMLElement | undefined,
  surface: HTMLElement | undefined,
  activeElement: Element | null = document.activeElement,
  body: HTMLElement = document.body,
): void {
  if (requested?.isConnected) {
    requested.focus({ preventScroll: true });
    return;
  }
  const focusWasLost =
    activeElement === null ||
    activeElement === body ||
    !activeElement.isConnected ||
    surface?.contains(activeElement) === true;
  if (focusWasLost && trigger?.isConnected) trigger.focus({ preventScroll: true });
}

export interface MenuFocusMachine {
  // Close the menu, recording where focus should land: an element to redirect to (Tab), null to
  // leave focus where native Tab is putting it, or undefined to restore the trigger only if focus
  // was actually lost.
  close(focusTarget?: HTMLElement | null): void;
  // The role="menu" keydown contract: arrow and Home/End roving plus the Tab redirect to the
  // control after the trigger (forward) or back to the trigger (reverse).
  handleKeydown(event: KeyboardEvent): void;
  // Drive from the consumer's single open-state effect (`$effect(() => machine.syncOpen(open))`):
  // the open branch records the open and schedules the initial roving focus, the close branch runs
  // the close-focus restore, and the return value is the effect cleanup either way.
  syncOpen(open: boolean): (() => void) | undefined;
}

// The stateful half of the machine, shared by the toolbar menus (the overflow menu, the bottom-bar
// More menu, and the profile switcher) so the open-focus and close-focus protocol and the Tab
// redirect cannot drift between them. Surface and trigger are getters because the refs bind after
// mount and change on open.
export function createMenuFocusMachine(deps: {
  surface: () => HTMLElement | undefined;
  trigger: () => HTMLElement | undefined;
  requestClose: () => void;
  // Frames to wait before the initial roving focus: 2 for a menu that positions itself on its
  // first frame (the bottom-bar More menu), otherwise 1.
  focusFrames?: number;
}): MenuFocusMachine {
  let wasOpen = false;
  let requestedCloseFocus: HTMLElement | null | undefined;

  const close = (focusTarget?: HTMLElement | null): void => {
    requestedCloseFocus = focusTarget;
    deps.requestClose();
  };

  const opened = (): (() => void) => {
    wasOpen = true;
    let frame = 0;
    const schedule = (remaining: number): void => {
      frame = requestAnimationFrame(() => {
        if (remaining > 1) schedule(remaining - 1);
        else initializeMenuFocus(deps.surface());
      });
    };
    schedule(deps.focusFrames ?? 1);
    // Only one frame is pending at a time, so canceling the latest cancels the chain.
    return () => cancelAnimationFrame(frame);
  };

  const closed = (): (() => void) | undefined => {
    if (!wasOpen) return undefined;
    wasOpen = false;
    const target = requestedCloseFocus;
    requestedCloseFocus = undefined;
    if (target === null) return undefined;
    const closingSurface = deps.surface();
    const trigger = deps.trigger();
    const frame = requestAnimationFrame(() => restoreMenuFocus(target, trigger, closingSurface));
    return () => cancelAnimationFrame(frame);
  };

  return {
    close,
    handleKeydown(event: KeyboardEvent): void {
      handleMenuKeydown(event, deps.surface(), document.activeElement, (reverse) => {
        if (reverse) {
          close(deps.trigger());
          return true;
        }
        const target = menuTabTarget(deps.trigger(), deps.surface(), false, documentFocusables());
        close(target ?? null);
        return target !== undefined;
      });
    },
    syncOpen(open: boolean): (() => void) | undefined {
      return open ? opened() : closed();
    },
  };
}
