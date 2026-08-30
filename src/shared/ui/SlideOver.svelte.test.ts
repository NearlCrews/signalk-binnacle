import { createRawSnippet } from 'svelte';
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import SlideOver from './SlideOver.svelte';

describe('SlideOver', () => {
  it('uses valid complementary and modal dialog semantics without changing its element type', () => {
    const children = createRawSnippet(() => ({ render: () => '<p>Panel body</p>' }));
    const complementary = render(SlideOver, {
      props: { title: 'Layers', onClose: () => {}, children },
    }).body;
    const modal = render(SlideOver, {
      props: { title: 'Layers', onClose: () => {}, focusTrap: true, children },
    }).body;

    expect(complementary).toContain('role="complementary"');
    expect(complementary).not.toContain('<aside');
    expect(modal).toContain('role="dialog"');
    expect(modal).toContain('aria-modal="true"');
    expect(modal).not.toContain('<aside');
  });

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
