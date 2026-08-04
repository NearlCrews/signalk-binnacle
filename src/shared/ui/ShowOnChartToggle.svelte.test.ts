import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import { attribute } from '$shared/testing';
import ShowOnChartToggle from './ShowOnChartToggle.svelte';

const DESCRIPTION = 'Markers for places in the current chart view';

function toggle(html: string): string {
  const match = html.match(/<button[^>]*show-on-chart[^>]*>/);
  if (!match) throw new Error('no toggle rendered');
  return match[0];
}

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

  it('keeps its own description out of the button, so the accessible name stays the label', () => {
    const { body } = render(ShowOnChartToggle, {
      props: {
        visible: true,
        label: 'Show places on chart',
        onToggle: () => {},
        description: DESCRIPTION,
      },
    });
    const start = body.indexOf('>', body.indexOf('<button')) + 1;
    const content = body.slice(start, body.indexOf('</button>'));

    expect(content).not.toContain(DESCRIPTION);
    expect(content).toContain('Show places on chart');
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
    expect(attribute(control, 'title')).toBe('Show places on chart');
  });
});
