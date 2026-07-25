import { createRawSnippet } from 'svelte';
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import OverflowActions from './OverflowActions.svelte';

// The keyboard-focus machine is unit-tested in menu-focus.test.ts; this covers the component's own
// menu wiring: the trigger and surface expose the menu semantics assistive technology reads.
describe('OverflowActions', () => {
  it('exposes the trigger and open surface as a menu', () => {
    const { body } = render(OverflowActions, {
      props: {
        open: true,
        label: 'More actions',
        onToggle: () => {},
        onClose: () => {},
        children: createRawSnippet(() => ({
          render: () => '<button type="button" role="menuitem">Rename</button>',
        })),
      },
    });

    expect(body).toContain('aria-haspopup="menu"');
    expect(body).toContain('aria-label="More actions"');
    expect(body).toContain('role="menu"');
    expect(body).toContain('role="menuitem"');
  });
});
