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
    expect(blocked).toContain('Request read and write access');

    const requesting = renderPanel({
      writeBlocked: true,
      onRequestWriteAccess: vi.fn(),
      requestingWriteAccess: true,
    });
    expect(requesting).toContain('Requesting access…');

    expect(renderPanel({ writeBlocked: true })).not.toContain('Request read and write access');
  });

  it('offers Navigate here and Save as waypoint only when wired', () => {
    const bare = renderPanel();
    expect(bare).not.toContain('Navigate here');
    expect(bare).not.toContain('Save as waypoint');

    const wired = renderPanel({ onNavigateHere: vi.fn(), onSaveWaypoint: vi.fn() });
    expect(wired).toMatch(/Navigate here\s*<\/button>/);
    expect(wired).toMatch(/Save as waypoint\s*<\/button>/);
  });

  it('disables the navigation actions without write access', () => {
    const blocked = renderPanel({
      onNavigateHere: vi.fn(),
      onSaveWaypoint: vi.fn(),
      writeBlocked: true,
    });
    expect(blocked).toMatch(/title="Start navigating to this place"[^>]*disabled/);
    expect(blocked).toMatch(/title="Save this place as a waypoint"[^>]*disabled/);
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
