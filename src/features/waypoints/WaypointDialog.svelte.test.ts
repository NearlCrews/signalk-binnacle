import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import type { Waypoint } from '$entities/waypoint';
import WaypointDialog from './WaypointDialog.svelte';

const waypoint: Waypoint = {
  id: 'w1',
  name: 'Crab pot',
  position: { latitude: 44, longitude: -86 },
};

function renderDialog(overrides: Record<string, unknown> = {}): string {
  return render(WaypointDialog, {
    props: {
      defaultName: 'Waypoint 2026-08-12',
      onSave: vi.fn(),
      onCancel: vi.fn(),
      ...overrides,
    },
  }).body;
}

describe('WaypointDialog', () => {
  it('offers Save and navigate only when adding, and only when the host wires it', () => {
    expect(renderDialog({ onSaveAndNavigate: vi.fn() })).toContain('Save and navigate');
    // Editing an existing mark has no mark-that-spot-and-go moment; its card already navigates.
    expect(renderDialog({ onSaveAndNavigate: vi.fn(), waypoint })).not.toContain(
      'Save and navigate',
    );
    expect(renderDialog()).not.toContain('Save and navigate');
  });

  it('keeps Save primary so the common bookmark case is unchanged', () => {
    const body = renderDialog({ onSaveAndNavigate: vi.fn() });
    const primary = body.indexOf('btn-primary');
    expect(body.slice(primary, body.indexOf('</button>', primary))).toContain('Save');
    expect(body).toContain('Add waypoint');
  });

  it('titles itself by mode and seeds the name from the edited waypoint', () => {
    expect(renderDialog({ waypoint })).toContain('Edit waypoint');
    expect(renderDialog({ waypoint })).toContain('Crab pot');
  });
});
