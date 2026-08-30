import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import DimOverlay from './DimOverlay.svelte';

function renderOverlay(dim: number): string {
  return render(DimOverlay, { props: { controller: { dim } } }).body;
}

describe('DimOverlay', () => {
  it('renders nothing at zero dim', () => {
    expect(renderOverlay(0)).not.toContain('dim-overlay');
  });

  it('renders the pointer-transparent layer at the set opacity', () => {
    const body = renderOverlay(0.4);
    expect(body).toContain('dim-overlay');
    expect(body).toContain('opacity: 0.4');
    expect(body).toContain('aria-hidden="true"');
  });
});
