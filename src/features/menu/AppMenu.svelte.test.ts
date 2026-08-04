import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import AppMenu from './AppMenu.svelte';
import APP_MENU_SOURCE from './AppMenu.svelte?raw';
import type { MenuItem } from './menu-item';

function renderMenu(items: MenuItem[]): string {
  return render(AppMenu, {
    props: { items, open: true, onOpenChange: () => {} },
  }).body;
}

function item(id: string, overrides: Partial<MenuItem> = {}): MenuItem {
  return { id, label: id, onSelect: () => {}, ...overrides };
}

describe('AppMenu count badge', () => {
  it('renders the count chip and its spoken suffix on a tile', () => {
    const body = renderMenu([item('alarms', { label: 'Alarms', count: 2 })]);

    expect(body).toContain('pill-count');
    expect(body).toMatch(/2 active/);
  });

  it('renders no chip for a tile without an active count', () => {
    const body = renderMenu([item('alarms', { label: 'Alarms' })]);

    expect(body).toContain('Alarms');
    expect(body).not.toContain('pill-count');
    expect(body).not.toMatch(/\d+ active/);
  });

  it('caps the tile chip at 99+ while the spoken suffix keeps the real count', () => {
    const body = renderMenu([item('alarms', { label: 'Alarms', count: 240 })]);

    expect(body).toContain('99+');
    expect(body).toMatch(/240 active/);
  });

  it('names the counted thing, singular and plural, when the item carries a noun', () => {
    const one = renderMenu([item('alarms', { label: 'Alarms', count: 1, countNoun: 'alarm' })]);
    const three = renderMenu([item('alarms', { label: 'Alarms', count: 3, countNoun: 'alarm' })]);

    expect(one).toContain('1 active alarm');
    expect(three).toContain('3 active alarms');
  });
});

describe('AppMenu group order', () => {
  it('renders the groups in the order of the items it is given', () => {
    const body = renderMenu([
      item('center', { group: 'Map' }),
      item('routes', { group: 'Navigate' }),
      item('alarms', { group: 'Safety' }),
    ]);

    const rendered = [...body.matchAll(/aria-label="(Map|Navigate|Safety)"/g)].map(
      (match) => match[1],
    );
    expect(rendered).toEqual(['Map', 'Navigate', 'Safety']);
  });

  // One order at every viewport. The phone-width CSS that reordered the groups gave a navigator two
  // mental models of the same chartplotter, and a rendered-DOM assertion cannot see CSS, so the
  // guard is on the source: no per-group hook and no order declaration to hang one on.
  it('carries no viewport-dependent group reorder', () => {
    expect(APP_MENU_SOURCE).not.toContain('data-group');
    expect(APP_MENU_SOURCE).not.toMatch(/\border:\s*\d/);
  });
});
