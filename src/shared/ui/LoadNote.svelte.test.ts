import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import LoadNote from './LoadNote.svelte';

describe('LoadNote', () => {
  it('announces loading and refreshing politely', () => {
    for (const state of ['loading', 'refreshing'] as const) {
      const body = render(LoadNote, { props: { state, message: 'Loading routes…' } }).body;
      expect(body).toContain('role="status"');
      expect(body).not.toContain('<button');
    }
  });

  it('raises an error as an alert with one Retry named by its object', () => {
    const body = render(LoadNote, {
      props: {
        state: 'error',
        message: 'Could not load routes.',
        onRetry: vi.fn(),
        retryName: 'routes',
      },
    }).body;
    expect(body).toContain('role="alert"');
    expect(body).toMatch(/aria-label="Retry loading routes"[^>]*>\s*Retry\s*</);
  });

  it('says Check again for a capability probe', () => {
    const body = render(LoadNote, {
      props: {
        state: 'error',
        message: 'No route storage.',
        onRetry: vi.fn(),
        retryKind: 'probe',
      },
    }).body;
    expect(body).toMatch(/>\s*Check again\s*</);
  });
});
