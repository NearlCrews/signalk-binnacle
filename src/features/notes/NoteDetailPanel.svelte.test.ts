import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import NoteDetailPanel from './NoteDetailPanel.svelte';

function body(ownedByBinnacle: boolean): string {
  return render(NoteDetailPanel, {
    props: {
      selection: {
        id: 'note-1',
        name: 'Quiet cove',
        category: 'anchorage',
        position: { latitude: 44, longitude: -86 },
        ownedByBinnacle,
      },
      load: vi.fn().mockResolvedValue(undefined),
      onClose: vi.fn(),
      onLocate: vi.fn(),
      onEdit: vi.fn(),
      onDelete: vi.fn(),
    },
  }).body;
}

describe('NoteDetailPanel', () => {
  it('shows edit and delete only for an exactly owned personal note', () => {
    const owned = body(true);
    expect(owned).toMatch(/Edit<\/button>/);
    expect(owned).toMatch(/Delete<\/button>/);

    const provider = body(false);
    expect(provider).not.toMatch(/Edit<\/button>/);
    expect(provider).not.toMatch(/Delete<\/button>/);
    expect(provider).toContain('Show on chart');
  });
});
