import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import ChartContextMenu from './ChartContextMenu.svelte';

describe('ChartContextMenu', () => {
  it('offers the personal-note action when the host wires it', () => {
    const body = render(ChartContextMenu, {
      props: {
        x: 100,
        y: 100,
        width: 400,
        height: 400,
        onGoToHere: vi.fn(),
        onStartRoute: vi.fn(),
        onAddNote: vi.fn(),
        onClose: vi.fn(),
      },
    }).body;
    expect(body).toContain('Add note here');
  });
});
