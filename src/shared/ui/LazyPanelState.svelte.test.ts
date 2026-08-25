import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import LazyPanelState from './LazyPanelState.svelte';

const base = {
  title: 'Weather',
  closeLabel: 'Close',
  message: 'Loading weather',
  onClose: () => {},
} as const;

describe('LazyPanelState', () => {
  it('docks to the left edge, matching every lazy-loaded panel', () => {
    const { body } = render(LazyPanelState, { props: { ...base, state: 'loading' } });

    expect(body).toContain('slide-over--dock-left');
    expect(body).not.toContain('slide-over--dock-right');
  });

  it('reports a failed import as an alert with its retry', () => {
    const { body } = render(LazyPanelState, {
      props: { ...base, state: 'error', message: 'Weather could not load', onRetry: () => {} },
    });

    expect(body).toContain('role="alert"');
    expect(body).toContain('Weather could not load');
    expect(body).toContain('Retry');
  });
});
