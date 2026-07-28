import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import { PersistedValue } from '$shared/settings';
import type { AuthController } from '$shared/signalk';
import RoutesPanel from './RoutesPanel.svelte';

const route = {
  id: 'r1',
  name: 'Passage',
  waypoints: [
    { position: { latitude: 42, longitude: -83 } },
    { position: { latitude: 43, longitude: -82 } },
  ],
};

function renderPanel(overrides: Record<string, unknown> = {}): string {
  return render(RoutesPanel, {
    props: {
      auth: { writeBlocked: false } as AuthController,
      routes: [],
      shownIds: new Set<string>(),
      working: undefined,
      activeId: undefined,
      refreshing: false,
      loadState: 'ready',
      busy: false,
      highlight: undefined,
      onHighlightLeg: vi.fn(),
      error: undefined,
      editorLoadFailed: false,
      onRetryEditor: vi.fn(),
      onRetry: vi.fn(),
      onNew: vi.fn(),
      onEditRoute: vi.fn(),
      onSave: vi.fn(),
      onCancelEdit: vi.fn(),
      onToggleShown: vi.fn(),
      onLocate: vi.fn(),
      onActivate: vi.fn(),
      onStop: vi.fn(),
      onReverse: vi.fn(),
      onExportGpx: vi.fn(),
      onImportGpx: vi.fn(),
      planningSpeed: new PersistedValue('route-test-speed', 5, {
        getItem: () => null,
        setItem: () => {},
      }),
      onDelete: vi.fn(),
      onClose: vi.fn(),
      ...overrides,
    },
  }).body;
}

describe('RoutesPanel', () => {
  it('distinguishes the loading state from a genuinely empty route list', () => {
    expect(renderPanel({ refreshing: true, loadState: 'loading' })).toContain('Loading routes…');
    expect(renderPanel()).toContain('No routes yet.');
  });

  it('disables conflicting route mutations while an operation is in flight', () => {
    const body = renderPanel({ routes: [route], busy: true });
    expect(body).toMatch(/<button[^>]*disabled[^>]*>[^<]*<svg[^>]*>[\s\S]*?New route/);
    expect(body).toMatch(/aria-label="Start navigation on route"[^>]*disabled/);
    expect(body).toContain('aria-label="More actions for Passage"');
  });

  it('labels the route-name action and activation by their actual behavior', () => {
    const body = renderPanel({ routes: [route] });
    expect(body).toContain('title="Show the entire route on the chart"');
    expect(body).toContain('aria-label="Start navigation on route"');
  });

  it('offers the active route a stop control that opens a confirmation rather than stopping', () => {
    const body = renderPanel({ routes: [route], activeId: route.id });
    expect(body).toContain('aria-label="Stop navigation"');
    expect(body).not.toContain('Stop navigating Passage?');
  });

  it('disables route writes without write access while keeping read actions available', () => {
    const body = renderPanel({ auth: { writeBlocked: true }, routes: [route] });
    expect(body).toMatch(/aria-label="Start navigation on route"[^>]*disabled/);
    expect(body).toContain('A write token is needed');
    expect(body).toContain('aria-label="More actions for Passage"');
  });
});
