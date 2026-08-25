import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerDismiss } from './dialog';
import NameEntry from './NameEntry.svelte';

// Regression cover for the Escape double-dismiss: the form registers its own dismiss-stack entry
// above the enclosing panel's, so one Escape cancels the name entry only, and a second closes the
// panel. A raw key handler on the input regressed this: the panel's capture-phase window listener
// fired on the same keystroke.
describe('NameEntry Escape dismissal', () => {
  const pressEscape = () =>
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('cancels only the form first, then the enclosing panel on a second Escape', async () => {
    const panelClose = vi.fn();
    const unregisterPanel = registerDismiss(panelClose);
    const onCancel = vi.fn();
    const component = mount(NameEntry, {
      target: document.body,
      props: { label: 'Name', onConfirm: () => undefined, onCancel },
    });
    // The dismiss-stack registration lives in an effect; flush so it runs before the keystroke.
    flushSync();
    try {
      pressEscape();
      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(panelClose).not.toHaveBeenCalled();

      // The caller closes the form on cancel; unmounting pops its stack entry.
      await unmount(component);
      pressEscape();
      expect(panelClose).toHaveBeenCalledTimes(1);
      expect(onCancel).toHaveBeenCalledTimes(1);
    } finally {
      unregisterPanel();
    }
  });
});
