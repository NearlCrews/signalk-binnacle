import type { Action } from 'svelte/action';

// Move focus to this element when it mounts, so a step revealed in place (a confirm prompt, a review
// form) lands the keyboard on the new control instead of leaving it on the now-removed trigger.
// preventScroll keeps the panel from jumping as focus lands.
export const focusOnMount: Action<HTMLElement> = (node) => {
  node.focus({ preventScroll: true });
};

// Shift+Tab shares the same key value ('Tab') as Tab, so no shiftKey check is needed to detect
// either direction.
export function isTabKey(event: KeyboardEvent): boolean {
  return event.key === 'Tab';
}

// Attach a keydown handler to an element via a Svelte action, so non-interactive host elements
// (role=group, role=toolbar, display:contents wrappers) avoid the noStaticElementInteractions lint.
// No-ops when handler is undefined.
export const onKeydownAction: Action<HTMLElement, ((event: KeyboardEvent) => void) | undefined> = (
  node,
  handler,
) => {
  function listener(event: KeyboardEvent): void {
    handler?.(event);
  }
  node.addEventListener('keydown', listener);
  return {
    update(newHandler): void {
      handler = newHandler;
    },
    destroy(): void {
      node.removeEventListener('keydown', listener);
    },
  };
};

/**
 * Vertical arrow-key roving over the items matching `selector` inside this element, with initial
 * focus on the first match when it mounts. Re-queries the DOM on each arrow keypress; intended
 * only for small, static item lists where the query is cheap. Shared by the anchored map menus
 * (the chart context menu and the weather layer menu); AppMenu's 2D tile grid keeps its own
 * Left/Right/Home/End handler. The listener lives in the action, not a template onkeydown, so the
 * host element can carry a non-interactive role without tripping the a11y interaction lint.
 */
export const rovingFocus: Action<HTMLElement, string> = (node, selector) => {
  // The selector is captured once: both consumers pass a literal, so the action needs no update.
  const items = (): HTMLElement[] => [...node.querySelectorAll<HTMLElement>(selector)];
  items()[0]?.focus({ preventScroll: true });
  function onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const list = items();
    if (list.length === 0) return;
    event.preventDefault();
    const down = event.key === 'ArrowDown';
    const current = list.indexOf(document.activeElement as HTMLElement);
    // When focus is outside the set (indexOf -1), ArrowDown lands on the first item and ArrowUp on
    // the last, rather than skipping the first.
    let next: number;
    if (current < 0) next = down ? 0 : list.length - 1;
    else next = down ? current + 1 : current - 1 + list.length;
    list[next % list.length]?.focus();
  }
  node.addEventListener('keydown', onKeydown);
  return {
    destroy(): void {
      node.removeEventListener('keydown', onKeydown);
    },
  };
};
