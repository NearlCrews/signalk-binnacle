import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import type { MenuItem } from './menu-item';
import PinnedActions from './PinnedActions.svelte';
import PINNED_ACTIONS from './PinnedActions.svelte?raw';

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

describe('PinnedActions count badge', () => {
  it('renders the count chip and its spoken suffix on a visible pill', () => {
    const body = renderBar([action('alarms', { label: 'Alarms', count: 3 })]);

    expect(body).toContain('class="pill-count"');
    expect(body).toContain('>3<');
    expect(body).toContain('3 active');
  });

  it('renders no chip for an item without an active count', () => {
    const body = renderBar([action('alarms', { label: 'Alarms' }), action('center', { count: 0 })]);

    expect(body).not.toContain('pill-count');
    expect(body).not.toMatch(/\d+ active/);
  });

  it('caps the chip at 99+ while the spoken suffix keeps the real count', () => {
    const body = renderBar([action('alarms', { label: 'Alarms', count: 128 })]);

    expect(body).toContain('>99+<');
    expect(body).toContain('128 active');
  });

  // The overflow rows only exist while the More menu is open, which server rendering never is, so
  // the second surface is asserted on the source: both bar surfaces render the same count component.
  it('renders the chip on the overflow rows too', () => {
    expect(PINNED_ACTIONS.match(/<MenuItemCount item=\{action\} \/>/g)).toHaveLength(2);
  });

  // The chip rule moved to the shared button vocabulary when the menu items became its second
  // consumer. Svelte only stamps its scoping class on an element a scoped selector matches, so a
  // hash-free class here is the proof that the scoped copy is gone and the global rule is in play.
  it('styles the More overflow count from the shared buttons vocabulary', () => {
    const actions = Array.from({ length: 8 }, (_, index) =>
      action(`a${index}`, { label: `A${index}` }),
    );

    expect(renderBar(actions)).toContain('class="pill-count"');
    expect(PINNED_ACTIONS).not.toContain('.pill-count {');
  });
});
