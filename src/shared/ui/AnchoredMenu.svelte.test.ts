import { createRawSnippet } from 'svelte';
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import AnchoredMenu from './AnchoredMenu.svelte';

describe('AnchoredMenu', () => {
  it('keeps the pointer-only dismiss backdrop out of the keyboard tab order', () => {
    const { body } = render(AnchoredMenu, {
      props: {
        open: true,
        onClose: () => {},
        backdropLabel: 'Close actions',
        children: createRawSnippet(() => ({ render: () => '<button>Action</button>' })),
      },
    });

    expect(body).toMatch(
      /class="overlay-backdrop anchored-menu-backdrop[^"]*"[^>]*aria-label="Close actions"[^>]*tabindex="-1"/,
    );
  });
});
