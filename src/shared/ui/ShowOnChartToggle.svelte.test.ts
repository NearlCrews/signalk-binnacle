import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import { attribute, tag } from '$shared/testing';
import ShowOnChartToggle from './ShowOnChartToggle.svelte';

const DESCRIPTION = 'Markers for places in the current chart view';

const toggle = (html: string): string => tag(html, /<input[^>]*role="switch"[^>]*>/, 'toggle');

describe('ShowOnChartToggle', () => {
  it('associates a supplied description with the control, not only its tooltip', () => {
    const { body } = render(ShowOnChartToggle, {
      props: {
        visible: true,
        label: 'Show places on chart',
        onToggle: () => {},
        description: DESCRIPTION,
      },
    });

    const describedBy = attribute(toggle(body), 'aria-describedby');
    expect(describedBy).toBeTruthy();
    const description = body.match(new RegExp(`<span id="${describedBy}"[^>]*>([^<]*)<`));
    expect(description?.[1]).toBe(DESCRIPTION);
    expect(body).toContain('visually-hidden');
  });

  it('keeps its own description out of the label, so the accessible name stays the label', () => {
    const { body } = render(ShowOnChartToggle, {
      props: {
        visible: true,
        label: 'Show places on chart',
        onToggle: () => {},
        description: DESCRIPTION,
      },
    });
    const label = body.slice(body.indexOf('<label'), body.indexOf('</label>'));
    // The name comes from the label's text; a title attribute does not contribute to it.
    const content = label.replace(/<[^>]*>/g, '');

    expect(content).not.toContain(DESCRIPTION);
    expect(content).toContain('Show places on chart');
  });

  it('is one switch that carries its state as checked', () => {
    for (const visible of [true, false]) {
      const { body } = render(ShowOnChartToggle, {
        props: { visible, label: 'Show places on chart', onToggle: () => {} },
      });
      expect(toggle(body).includes('checked')).toBe(visible);
      expect(body).not.toContain('aria-pressed');
    }
  });

  it('defers to a caller-owned description element', () => {
    const { body } = render(ShowOnChartToggle, {
      props: {
        visible: false,
        label: 'Show places on chart',
        onToggle: () => {},
        description: DESCRIPTION,
        describedBy: 'poi-unavailable-hint',
      },
    });

    expect(attribute(toggle(body), 'aria-describedby')).toBe('poi-unavailable-hint');
    expect(body).not.toContain('visually-hidden');
  });

  it('describes nothing when the caller supplies no description', () => {
    const { body } = render(ShowOnChartToggle, {
      props: { visible: false, label: 'Show places on chart', onToggle: () => {} },
    });

    const control = toggle(body);
    expect(control).not.toContain('aria-describedby');
    expect(body).toContain('title="Show places on chart"');
  });
});
