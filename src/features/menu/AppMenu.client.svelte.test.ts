import { type ComponentProps, flushSync, mount, tick, unmount } from 'svelte';
import { describe, expect, it } from 'vitest';
import AppMenu from './AppMenu.svelte';

describe('launcher opener focus', () => {
  it.each([false, true])(
    'restores the external opener or its surviving More control (removed=%s)',
    async (removeOpener) => {
      const target = document.createElement('div');
      const group = document.createElement('div');
      group.setAttribute('data-menu-opener-group', '');
      const fallback = document.createElement('button');
      fallback.setAttribute('data-menu-opener', '');
      fallback.textContent = 'More';
      const opener = document.createElement('button');
      opener.textContent = 'Pinned Menu';
      group.append(fallback, opener);
      document.body.append(group, target);
      const props = $state<ComponentProps<typeof AppMenu>>({
        items: [{ id: 'help', label: 'Help', onSelect: () => {} }],
        showTrigger: false,
        open: false,
        onOpenChange: (open) => {
          props.open = open;
        },
      });
      const component = mount(AppMenu, { target, props });
      flushSync();
      try {
        opener.focus();
        props.open = true;
        flushSync();
        expect(document.activeElement?.textContent).toContain('Help');
        if (removeOpener) opener.remove();
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
        flushSync();
        await tick();
        expect(props.open).toBe(false);
        expect(document.activeElement).toBe(removeOpener ? fallback : opener);
      } finally {
        await unmount(component);
        group.remove();
        target.remove();
      }
    },
  );
});
