import type { Action } from 'svelte/action';

// A dismissible overlay panel behavior: Escape closes it, and focus returns to whatever was focused
// when it opened (typically the control that opened it) once it closes. Deliberately light, with no
// focus trap, because these panels are non-modal: the chart stays live underneath.
//
// Open dismissables are tracked in one stack so a single Escape closes only the topmost (most
// recently opened) one. The note and weather panels can be open at the same time, and the app menu
// or an active measurement can sit over a slide-over, so without the shared stack one Escape would
// close more than one. One shared window listener serves every open entry, and an Escape that
// closes something is marked consumed via preventDefault so any foreign Escape listener can see it
// was taken.
interface DismissEntry {
  close: () => void;
}
const openDialogs: DismissEntry[] = [];

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || event.defaultPrevented) return;
  const top = openDialogs[openDialogs.length - 1];
  if (!top) return;
  event.preventDefault();
  top.close();
}

// Register a closer in the shared Escape stack; returns the unregister function. The dialog action
// uses this for the slide-over panels; the app menu and the measure strip register here directly
// so Escape over a stacked surface closes only the topmost one.
export function registerDismiss(close: () => void): () => void {
  // Track by a per-registration entry, not the close function itself, so two surfaces that happen to
  // share one close reference still unregister independently rather than splicing the wrong entry.
  const entry: DismissEntry = { close };
  openDialogs.push(entry);
  // Capture phase, so this handler runs before any bubble-phase Escape listener regardless of
  // registration order; foreign listeners then see the preventDefault mark and stand down.
  if (openDialogs.length === 1) window.addEventListener('keydown', onKeydown, true);
  return () => {
    const index = openDialogs.indexOf(entry);
    if (index >= 0) openDialogs.splice(index, 1);
    if (openDialogs.length === 0) window.removeEventListener('keydown', onKeydown, true);
  };
}

export const dialog: Action<HTMLElement, () => void> = (node, onClose) => {
  let close = onClose;
  const restoreTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const unregister = registerDismiss(() => close());

  // Restore only when this surface actually holds focus (or focus already fell to the body):
  // unconditionally restoring would yank focus from an unrelated panel the user moved into.
  const restoreFocus = (): void => {
    const active = document.activeElement;
    if (node.contains(active) || active === document.body || active === null) {
      restoreTo?.focus();
    }
  };
  const update = (next: () => void): void => {
    close = next;
  };

  if (node instanceof HTMLDialogElement) {
    node.showModal();

    // Native cancel (Escape) is suppressed so the shared Escape stack stays the single dismissal
    // order: without this, Escape over a dialog stacked on a panel would close both.
    const handleCancel = (e: Event) => {
      e.preventDefault();
    };
    node.addEventListener('cancel', handleCancel);

    return {
      update,
      destroy(): void {
        unregister();
        node.removeEventListener('cancel', handleCancel);
        try {
          node.close();
        } catch (_) {}
        restoreFocus();
      },
    };
  }

  // Move focus into the panel on open so a keyboard or screen-reader user lands inside it, not back on
  // the trigger that opened it. The panel carries tabindex="-1" to receive focus; this is a no-op if
  // the node is not focusable. restoreTo was captured above, so closing still returns focus correctly.
  node.focus({ preventScroll: true });

  return {
    update,
    destroy(): void {
      unregister();
      restoreFocus();
    },
  };
};
