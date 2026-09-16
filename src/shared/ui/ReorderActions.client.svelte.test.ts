import { flushSync, mount, unmount } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import ReorderActions from './ReorderActions.svelte';

describe('individual reorder actions', () => {
  it('supports a single tap and keeps menu arrow navigation away from an enclosing grid', async () => {
    const target = document.createElement('div');
    document.body.append(target);
    const outerKeys = vi.fn();
    target.addEventListener('keydown', outerKeys);
    const onMove = vi.fn();
    const component = mount(ReorderActions, {
      target,
      props: {
        label: 'Depth',
        canMoveUp: true,
        canMoveDown: true,
        onMove,
      },
    });
    flushSync();
    try {
      const trigger = target.querySelector<HTMLButtonElement>('button[aria-label="Reorder Depth"]');
      if (!trigger) throw new Error('Missing reorder control');
      trigger.click();
      flushSync();
      const items = [...target.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
      await vi.waitFor(() => expect(document.activeElement).toBe(items[0]));
      items[0].focus();
      const key = new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        bubbles: true,
        cancelable: true,
      });
      items[0].dispatchEvent(key);
      expect(key.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(items[1]);
      expect(outerKeys).not.toHaveBeenCalled();
      items[1].click();
      expect(onMove).toHaveBeenCalledExactlyOnceWith(1);
    } finally {
      await unmount(component);
      target.remove();
    }
  });
});
