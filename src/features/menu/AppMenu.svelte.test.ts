import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import AppMenu from './AppMenu.svelte';
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
});
