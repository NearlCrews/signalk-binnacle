import { createRawSnippet } from 'svelte';
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import { attribute } from '$shared/testing';
import PanelHeader from './PanelHeader.svelte';
import SlideOver from './SlideOver.svelte';

function minimizeControl(html: string): string {
  const match = html.match(/<button[^>]*panel-minimize[^>]*>/);
  if (!match) throw new Error('no minimize control rendered');
  return match[0];
}

describe('PanelHeader', () => {
  it('points the minimize control at the panel body it collapses', () => {
    const { body } = render(PanelHeader, {
      props: {
        title: 'Layers and charts',
        onClose: () => {},
        minimize: { collapsed: false, onToggle: () => {} },
        bodyId: 'panel-body-layers',
      },
    });

    const control = minimizeControl(body);
    expect(attribute(control, 'aria-controls')).toBe('panel-body-layers');
    expect(attribute(control, 'aria-expanded')).toBe('true');
  });

  it('reports the collapsed panel as not expanded', () => {
    const { body } = render(PanelHeader, {
      props: {
        title: 'Layers and charts',
        onClose: () => {},
        minimize: { collapsed: true, onToggle: () => {} },
        bodyId: 'panel-body-layers',
      },
    });

    expect(attribute(minimizeControl(body), 'aria-expanded')).toBe('false');
  });

  it('omits aria-controls when no body id is supplied', () => {
    const { body } = render(PanelHeader, {
      props: {
        title: 'Layers and charts',
        onClose: () => {},
        minimize: { collapsed: false, onToggle: () => {} },
      },
    });

    expect(minimizeControl(body)).not.toContain('aria-controls');
  });

  it('renders no minimize control for a panel that cannot collapse', () => {
    const { body } = render(PanelHeader, {
      props: { title: 'Layers and charts', onClose: () => {} },
    });

    expect(body).not.toContain('panel-minimize');
  });
});

describe('SlideOver minimize wiring', () => {
  it('gives the body an id the minimize control references', () => {
    const { body } = render(SlideOver, {
      props: {
        title: 'Route',
        onClose: () => {},
        minimize: { collapsed: false, onToggle: () => {} },
        children: createRawSnippet(() => ({ render: () => '<p>Route form</p>' })),
      },
    });

    const panelBody = body.match(/<div[^>]*panel-body[^>]*>/)?.[0];
    if (!panelBody) throw new Error('no panel body rendered');
    const bodyId = attribute(panelBody, 'id');

    expect(bodyId).toBeTruthy();
    expect(attribute(minimizeControl(body), 'aria-controls')).toBe(bodyId);
  });
});
