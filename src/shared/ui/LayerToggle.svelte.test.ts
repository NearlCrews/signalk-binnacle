import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import { attribute, tag } from '$shared/testing';
import LayerToggle from './LayerToggle.svelte';

const DESCRIPTION = 'Depth contours and soundings from the NOAA ENC set';

const checkbox = (html: string): string => tag(html, /<input type="checkbox"[^>]*>/, 'toggle');

function renderToggle(props: Record<string, unknown> = {}): string {
  return render(LayerToggle, {
    props: { label: 'NOAA ENC', visible: true, onToggle: () => {}, ...props },
  }).body;
}

describe('LayerToggle', () => {
  it('associates a supplied description with the control, not only its tooltip', () => {
    const body = renderToggle({ description: DESCRIPTION });

    const describedBy = attribute(checkbox(body), 'aria-describedby');
    expect(describedBy).toBeTruthy();
    const description = body.match(new RegExp(`<span id="${describedBy}"[^>]*>([^<]*)<`));
    expect(description?.[1]).toBe(DESCRIPTION);
    expect(body).toContain('visually-hidden');
  });

  it('keeps its own description out of the label, so the accessible name stays the title', () => {
    const body = renderToggle({ description: DESCRIPTION });
    const label = body.slice(body.indexOf('<label'), body.indexOf('</label>'));

    expect(label).not.toContain('visually-hidden');
    expect(label).toContain('NOAA ENC');
  });

  it('defers to a caller-owned description element', () => {
    const body = renderToggle({
      description: DESCRIPTION,
      describedBy: 'layer-enc-unavailable',
    });

    expect(attribute(checkbox(body), 'aria-describedby')).toBe('layer-enc-unavailable');
    expect(body).not.toContain('visually-hidden');
  });

  it('describes nothing when the caller supplies no description', () => {
    const body = renderToggle();

    expect(checkbox(body)).not.toContain('aria-describedby');
    expect(body).not.toContain('visually-hidden');
  });

  it('renders a switch by default and names it by the visible title', () => {
    const body = renderToggle({ label: 'Seascape contours' });

    expect(attribute(checkbox(body), 'role')).toBe('switch');
    expect(checkbox(body)).toContain('checked');
    expect(body).toContain('>Seascape contours</span>');
  });

  it('renders a plain checkbox for a selection list', () => {
    const body = renderToggle({ visible: false, kind: 'checkbox' });

    expect(checkbox(body)).not.toContain('role=');
  });
});
