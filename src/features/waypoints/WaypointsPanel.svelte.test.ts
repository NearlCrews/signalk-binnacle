import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import type { Waypoint } from '$entities/waypoint';
import type { AuthController } from '$shared/signalk';
import WaypointsPanel from './WaypointsPanel.svelte';

const waypoint: Waypoint = {
  id: 'a',
  name: 'Harbor',
  position: { latitude: 44, longitude: -86 },
};

function renderPanel(overrides: Record<string, unknown> = {}): string {
  return render(WaypointsPanel, {
    props: {
      auth: { writeBlocked: false } as AuthController,
      waypoints: [],
      loadState: 'ready',
      busy: false,
      routeBusy: false,
      onLocate: vi.fn(),
      onGoTo: vi.fn(),
      onEdit: vi.fn(),
      onDelete: vi.fn(),
      onClose: vi.fn(),
      ...overrides,
    },
  }).body;
}

describe('WaypointsPanel', () => {
  it('distinguishes loading, failure, refresh, and genuinely empty lists', () => {
    expect(renderPanel({ loadState: 'loading' })).toContain('Loading waypoints…');
    expect(renderPanel({ loadState: 'error' })).toContain('Could not load waypoints.');
    expect(renderPanel({ loadState: 'loading', waypoints: [waypoint] })).toContain(
      'Refreshing waypoints…',
    );
    expect(renderPanel()).toContain('No waypoints yet.');
  });

  it('disables server writes and navigation without write access', () => {
    const body = renderPanel({
      auth: { writeBlocked: true },
      waypoints: [waypoint],
    });
    expect(body.match(/disabled/g)).toHaveLength(3);
    expect(body).toContain('A write token is needed');
  });

  it('disables navigation while route work is busy', () => {
    const body = renderPanel({ waypoints: [waypoint], routeBusy: true });
    expect(body).toMatch(/aria-label="Navigate to waypoint"[^>]*disabled/);
  });
});
