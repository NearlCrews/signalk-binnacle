import type { ComponentProps } from 'svelte';
import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import type { AuthController } from '$shared/signalk';
import PersonalNoteDialog from './PersonalNoteDialog.svelte';

function renderDialog(overrides: Partial<ComponentProps<typeof PersonalNoteDialog>> = {}): string {
  return render(PersonalNoteDialog, {
    props: {
      editor: { kind: 'add', position: { latitude: 44, longitude: -86 } },
      auth: { writeBlocked: false, upgrading: false } as AuthController,
      capability: 'read-write',
      probing: false,
      busy: false,
      onSave: vi.fn(),
      onCancel: vi.fn(),
      onProbe: vi.fn(),
      ...overrides,
    },
  }).body.replace(/\s+/g, ' ');
}

const blocked = (upgrading = false): string =>
  renderDialog({ auth: { writeBlocked: true, upgrading } as AuthController });

describe('PersonalNoteDialog write access', () => {
  it('keeps the entered note and offers the request while access is read-only', () => {
    const body = blocked();
    expect(body).toContain('Binnacle has read-only access.');
    expect(body).toContain('Request read and write access');
    expect(body).toMatch(/role="status"/);
  });

  it('reports an outstanding request on the button instead of a second control', () => {
    const body = blocked(true);
    expect(body).toContain('Requesting access…');
    expect(body).not.toContain('Request read and write access');
    expect(body).toMatch(/<button[^>]+disabled/);
  });

  it('says nothing about access when the token can write', () => {
    const body = renderDialog();
    expect(body).not.toContain('Binnacle has read-only access.');
    expect(body).not.toContain('Request read and write access');
  });
});
