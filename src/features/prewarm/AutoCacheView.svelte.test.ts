import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import AutoCacheView from './AutoCacheView.svelte';

function body(overrides: Record<string, unknown> = {}): string {
  return render(AutoCacheView, {
    props: {
      enabled: false,
      adminAccess: true,
      loadError: null,
      loading: true,
      settingsReady: false,
      writerState: 'idle',
      sources: [],
      selectedSources: new Set<string>(),
      unit: 'm',
      radius: 3704,
      moveThreshold: 1852,
      intervalSeconds: 60,
      baseZoom: 12,
      sourceDescription: () => undefined,
      onRetryLoad: vi.fn(),
      onRetrySave: vi.fn(),
      onToggleEnabled: vi.fn(),
      onToggleSource: vi.fn(),
      onCommitRadius: vi.fn(),
      onCommitMoveThreshold: vi.fn(),
      onCommitInterval: vi.fn(),
      onCommitBaseZoom: vi.fn(),
      ...overrides,
    },
  }).body;
}

describe('Automatic-cache policy readiness', () => {
  it('does not present default values as an editable policy while loading', () => {
    const html = body();
    expect(html).toContain('Loading automatic-caching settings');
    expect(html).not.toContain('Enable automatic caching');
    expect(html).not.toContain('How far around the boat');
  });

  it('offers a local retry without controls after an initial failure', () => {
    const html = body({ loading: false, loadError: 'Could not load automatic-caching settings.' });
    expect(html).toContain('Retry settings');
    expect(html).toContain('Load the current policy before changing');
    expect(html).not.toContain('Enable automatic caching');
    expect(html).not.toContain('Loading automatic-caching settings');
  });

  it('shows the actual accepted enabled state only when ready', () => {
    const html = body({ loading: false, settingsReady: true, enabled: true });
    expect(html).toContain('Enable automatic caching');
    expect(html).toContain('aria-pressed="true"');
  });
});
