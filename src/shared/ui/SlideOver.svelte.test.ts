import { createRawSnippet } from 'svelte';
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import SlideOver from './SlideOver.svelte';

describe('SlideOver', () => {
  it('keeps a pinned workflow footer rendered while the phone body is collapsed', () => {
    const { body } = render(SlideOver, {
      props: {
        title: 'Radar controls',
        onClose: () => {},
        minimize: { collapsed: true, onToggle: () => {} },
        children: createRawSnippet(() => ({ render: () => '<p>Radar form</p>' })),
        footer: createRawSnippet(() => ({
          render: () => '<span>Tap the inner start corner.</span><button>Stop chart edit</button>',
        })),
      },
    });

    expect(body).toContain('panel-body--collapsed');
    expect(body).toContain('class="panel-footer"');
    expect(body).toContain('Tap the inner start corner.');
    expect(body).toContain('Stop chart edit');
  });
});
