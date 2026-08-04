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
  it('docks to the left edge by default', () => {
    const { body } = render(LazyPanelState, { props: { ...base, state: 'loading' } });

    expect(body).toContain('slide-over--dock-left');
    expect(body).not.toContain('slide-over--dock-right');
  });

  it('borders the same edge as the right-docked panel it stands in for', () => {
    const { body } = render(LazyPanelState, {
      props: { ...base, state: 'loading', dock: 'right' },
    });

    expect(body).toContain('slide-over--dock-right');
    expect(body).not.toContain('slide-over--dock-left');
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
