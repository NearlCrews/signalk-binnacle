import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import EmptyState from './EmptyState.svelte';

describe('EmptyState', () => {
  it('orients, explains, and offers one next step', () => {
    const body = render(EmptyState, {
      props: {
        title: 'No saved routes',
        message: 'Tap New route, then tap the chart to drop points along your path.',
        action: { label: 'New route', run: vi.fn(), primary: true },
      },
    }).body;
    expect(body).toContain('class="empty-state"');
    expect(body).toContain('No saved routes');
    expect(body).toContain('Tap New route, then tap the chart');
    expect(body).toMatch(/<button[^>]*class="btn btn-primary"[^>]*>\s*New route/);
  });

  it('renders no button without an action', () => {
    const body = render(EmptyState, {
      props: { title: 'No saved tracks', message: 'Record a track, then tap Save to keep it.' },
    }).body;
    expect(body).not.toContain('<button');
  });
});
