import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import type { MenuItem } from './menu-item';
import PinnedActions from './PinnedActions.svelte';

// The keyboard-focus machine is unit-tested in menu-focus.test.ts; this covers the component's own
// wiring: the bar renders its pinned pills and collapses the rest behind a menu trigger.
function renderBar(actions: MenuItem[]): string {
  return render(PinnedActions, { props: { actions } }).body;
}

function action(id: string, overrides: Partial<MenuItem> = {}): MenuItem {
  return { id, label: id, onSelect: () => {}, ...overrides };
}

describe('PinnedActions', () => {
  it('renders a visible pill for a pinned action', () => {
    const body = renderBar([action('center', { label: 'Center', shortLabel: 'Center' })]);

    expect(body).toContain('Center');
  });

  it('collapses actions beyond the bar limit behind a menu trigger', () => {
    const actions = Array.from({ length: 8 }, (_, index) =>
      action(`a${index}`, { label: `A${index}` }),
    );

    const body = renderBar(actions);

    expect(body).toContain('aria-haspopup="menu"');
    expect(body).toContain('aria-label="More actions (3)"');
  });
});
