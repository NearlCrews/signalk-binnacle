import type { ComponentProps } from 'svelte';
import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import NoteDetailPanel from './NoteDetailPanel.svelte';
import type { NoteSelection } from './notes-client';

function selection(ownedByBinnacle = true): NoteSelection {
  return {
    id: 'note-1',
    name: 'Quiet cove',
    category: 'anchorage',
    position: { latitude: 44, longitude: -86 },
    ownedByBinnacle,
  };
}

function renderPanel(overrides: Partial<ComponentProps<typeof NoteDetailPanel>> = {}): string {
  return render(NoteDetailPanel, {
    props: {
      selection: selection(),
      load: vi.fn().mockResolvedValue(undefined),
      onClose: vi.fn(),
      onLocate: vi.fn(),
      onEdit: vi.fn(),
      onDelete: vi.fn(),
      ...overrides,
    },
  }).body;
}

describe('NoteDetailPanel', () => {
  it('shows edit and delete only for an exactly owned personal note', () => {
    const owned = renderPanel();
    expect(owned).toMatch(/Edit<\/button>/);
    expect(owned).toMatch(/Delete<\/button>/);

    const provider = renderPanel({ selection: selection(false) });
    expect(provider).not.toMatch(/Edit<\/button>/);
    expect(provider).not.toMatch(/Delete<\/button>/);
    expect(provider).toContain('Show on chart');
  });

  it('offers the read/write request beside the note that needs it', () => {
    const blocked = renderPanel({ writeBlocked: true, onRequestWriteAccess: vi.fn() });
    expect(blocked).toContain('Request read/write access');

    const requesting = renderPanel({
      writeBlocked: true,
      onRequestWriteAccess: vi.fn(),
      requestingWriteAccess: true,
    });
    expect(requesting).toContain('Requesting access…');

    expect(renderPanel({ writeBlocked: true })).not.toContain('Request read/write access');
  });

  it('offers a dismiss control on a mutation error', () => {
    const dismissible = renderPanel({
      mutationError: 'Could not delete the note.',
      onDismissMutationError: vi.fn(),
    });
    expect(dismissible).toContain('Could not delete the note.');
    expect(dismissible).toContain('aria-label="Dismiss error"');
  });
});
