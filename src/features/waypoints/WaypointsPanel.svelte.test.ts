import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import type { UnitsStore } from '$entities/units';
import type { OwnVessel } from '$entities/vessel';
import type { Waypoint } from '$entities/waypoint';
import type { AuthController } from '$shared/signalk';
import { fakeVesselFix } from '$shared/testing';
import WaypointsPanel from './WaypointsPanel.svelte';
import { MAX_WAYPOINTS } from './waypoints-client';

const waypoint: Waypoint = {
  id: 'a',
  name: 'Harbor',
  position: { latitude: 44, longitude: -86 },
};

const boat = fakeVesselFix({ latitude: 0, longitude: 0 });

function marks(count: number): Waypoint[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `w${index}`,
    name: `Mark ${index}`,
    position: { latitude: 0, longitude: index / 1000 },
  }));
}

function renderPanel(overrides: Record<string, unknown> = {}): string {
  return render(WaypointsPanel, {
    props: {
      auth: { writeBlocked: false } as AuthController,
      waypoints: [],
      vessel: fakeVesselFix(undefined) as unknown as OwnVessel,
      units: { mode: 'metric' } as UnitsStore,
      loadState: 'ready',
      busy: false,
      routeBusy: false,
      onRetry: vi.fn(),
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
  it('pins a chart-selected waypoint hidden beyond the row cap, preserving the list', () => {
    // 260 marks exceed the row cap; the selected one sorts last by name, past the cap.
    const many = marks(260);
    const body = renderPanel({ waypoints: many, vessel: boat, selectedId: 'w259' });
    expect(body).toContain('Mark 259');
    expect(body).toContain('chart-selected waypoint is shown first');
    // Without a selection the same mark stays capped out and no pin note renders.
    const unpinned = renderPanel({ waypoints: many, vessel: boat });
    expect(unpinned).not.toContain('chart-selected waypoint');
  });

  it('names the missing Resources Provider instead of blaming the connection', () => {
    const missing = renderPanel({ provisioning: 'unprovisioned', loadState: 'error' });
    expect(missing).toContain('This Signal K server has no waypoint storage');
    expect(missing).toContain('Resources Provider (built-in)');
    expect(missing).toContain('Check again');
    expect(missing).not.toContain('Check the connection, then retry.');
    const provisioned = renderPanel({ provisioning: 'provisioned', loadState: 'error' });
    expect(provisioned).toContain('Could not load waypoints. Check the connection, then retry.');
    expect(provisioned).not.toContain('no waypoint storage');
  });

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
    expect(body).toContain('This display has read-only access');
  });

  it('marks the mark selected on the chart as the current card', () => {
    const body = renderPanel({ waypoints: [waypoint], selectedId: waypoint.id });
    expect(body).toContain('aria-current="true"');
    expect(renderPanel({ waypoints: [waypoint] })).not.toContain('aria-current="true"');
  });

  it('disables navigation while route work is busy', () => {
    const body = renderPanel({ waypoints: [waypoint], routeBusy: true });
    expect(body).toMatch(/aria-label="Navigate to waypoint"[^>]*disabled/);
  });

  it('offers search and the three sort keys', () => {
    const body = renderPanel({ waypoints: [waypoint] });
    expect(body).toContain('Search waypoints by name or description');
    expect(body).toContain('Sort waypoints by');
    expect(body).toMatch(/aria-pressed="true"[\s\S]{0,80}Name/);
    expect(body).toContain('Distance');
    expect(body).toContain('Bearing');
  });

  it('leaves search and sort out of an empty locker', () => {
    const body = renderPanel();
    expect(body).not.toContain('Search waypoints by name or description');
    expect(body).not.toContain('Sort waypoints by');
  });

  it('explains why distance and bearing are absent without a fresh fix', () => {
    const body = renderPanel({ waypoints: [waypoint] });
    expect(body).toContain('Distance and bearing need a fresh GPS fix.');
    expect(body).not.toContain('°T');
  });

  it('shows distance and true bearing from a fresh fix', () => {
    const body = renderPanel({
      waypoints: [{ id: 'e', name: 'East', position: { latitude: 0, longitude: 1 } }],
      vessel: boat,
    });
    expect(body).toContain('090°T');
    expect(body).toContain('nm');
    expect(body).not.toContain('Distance and bearing need a fresh GPS fix.');
  });

  it('caps the rendered rows and says how many matches were hidden', () => {
    const body = renderPanel({ waypoints: marks(300) });
    expect(body).toContain('Showing the first 250 of 300 matches.');
    expect(body).toContain('Mark 0');
    expect(body).not.toContain('Mark 299');
  });

  it('says the collection may be truncated at the ingestion limit', () => {
    expect(renderPanel({ waypoints: marks(MAX_WAYPOINTS) })).toContain(
      'The panel accepts at most 5,000 waypoints from the server.',
    );
    expect(renderPanel({ waypoints: marks(2) })).not.toContain('The panel accepts at most');
  });
});
