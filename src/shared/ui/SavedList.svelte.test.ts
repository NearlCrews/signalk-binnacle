import { createRawSnippet } from 'svelte';
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import type { SavedListEmpty } from './empty-state';
import SavedList from './SavedList.svelte';

interface Item {
  id: string;
}

function renderEmpty(empty: SavedListEmpty): string {
  return render(SavedList<Item>, {
    props: {
      heading: 'Saved routes',
      items: [],
      empty,
      key: (item: Item) => item.id,
      card: createRawSnippet<[Item]>((item) => ({ render: () => `<span>${item().id}</span>` })),
    },
  }).body;
}

describe('SavedList empty states', () => {
  it('announces a load in flight as a status, not as an empty list', () => {
    const body = renderEmpty({ kind: 'loading', message: 'Loading routes…' });
    expect(body).toContain('role="status"');
    expect(body).toContain('Loading routes…');
    expect(body).not.toContain('empty-state');
  });

  it('states an unavailable list plainly, leaving the cause to the panel above it', () => {
    const body = renderEmpty({ kind: 'unavailable', message: 'Routes are unavailable.' });
    expect(body).toContain('Routes are unavailable.');
    expect(body).not.toContain('empty-state');
  });

  it('renders a real empty list as an empty state', () => {
    const body = renderEmpty({
      kind: 'empty',
      title: 'No saved routes',
      message: 'Tap New route.',
    });
    expect(body).toContain('class="empty-state"');
    expect(body).toContain('No saved routes');
  });
});
