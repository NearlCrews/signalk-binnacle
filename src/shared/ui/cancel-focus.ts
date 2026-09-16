import { tick } from 'svelte';
import { restoreMenuFocus } from './menu-focus';

// Cancellation can recreate its trigger. Resolve it after the update, and leave focus alone if
// another control acquired it while the closing form or confirmation was being removed.
export async function restoreFocusAfterCancel(
  getTrigger: () => HTMLElement | undefined,
  closingSurface?: HTMLElement,
): Promise<void> {
  if (typeof document === 'undefined') return;
  const closingControl =
    closingSurface ??
    (document.activeElement instanceof HTMLElement && document.activeElement !== document.body
      ? document.activeElement
      : undefined);
  await tick();
  restoreMenuFocus(undefined, getTrigger(), closingControl);
}
