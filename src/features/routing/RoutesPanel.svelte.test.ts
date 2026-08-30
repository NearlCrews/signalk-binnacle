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
  it('names the missing Resources Provider instead of blaming the connection', () => {
    const missing = renderPanel({ provisioning: 'unprovisioned', loadState: 'error' });
    expect(missing).toContain('This Signal K server has no route storage');
    expect(missing).toContain('Resources Provider (built-in)');
    expect(missing).toContain('Check again');
    expect(missing).not.toContain('Check the connection, then retry.');
    // A provider that exists keeps the honest connection copy for a genuine fetch failure.
    const provisioned = renderPanel({ provisioning: 'provisioned', loadState: 'error' });
    expect(provisioned).toContain('Could not load routes. Check the connection, then retry.');
    expect(provisioned).not.toContain('no route storage');
  });

  it('distinguishes the loading state from a genuinely empty route list', () => {
    expect(renderPanel({ refreshing: true, loadState: 'loading' })).toContain('Loading routes…');
    expect(renderPanel()).toContain('No routes yet.');
  });

  it('threads the weather grid through to the plan wind lines', () => {
    // An obviously synthetic grid pinned around now, since the plan seeds its departure to now.
    const HOUR = 3_600_000;
    const times = Array.from({ length: 49 }, (_, i) => Date.now() - HOUR + i * HOUR);
    const fill = (value: number) => times.map(() => new Array(4).fill(value));
    const weatherGrid = {
      lats: [41, 44],
      lons: [-84, -81],
      times,
      windU: fill(0),
      windV: fill(-5),
    };
    expect(renderPanel({ working: route, weatherGrid })).toContain('Wind 9.7 kn from 000');
    expect(renderPanel({ working: route })).not.toContain('Wind 9.7');
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
    expect(body).toContain('This display has read-only access');
    expect(body).toContain('aria-label="More actions for Passage"');
  });
});
