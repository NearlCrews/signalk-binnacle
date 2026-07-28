import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import type { TrackRecorder } from '$entities/track';
import { PersistedValue } from '$shared/settings';
import type { AuthController } from '$shared/signalk';
import TracksPanel from './TracksPanel.svelte';

const connectedPoints = [
  { lat: 1, lon: 1, t: 0, sog: 1 },
  { lat: 1.001, lon: 1, t: 10_000, sog: 1 },
];

function renderPanel(overrides: Record<string, unknown> = {}): string {
  const recorder = {
    points: [],
    paused: false,
    stats: { distanceMeters: 0, durationSeconds: 0, avgSog: 0, maxSog: 0 },
    pause: vi.fn(),
    resume: vi.fn(),
    clear: vi.fn(),
  } as unknown as TrackRecorder;
  return render(TracksPanel, {
    props: {
      auth: { writeBlocked: false } as AuthController,
      recorder,
      settings: new PersistedValue('tracks-panel-test', {
        intervalSeconds: 10,
        minMeters: 10,
        colorMode: 'speed' as const,
      }),
      saved: [],
      shown: new Set<string>(),
      loadState: 'ready',
      provisioning: 'unknown',
      busy: false,
      routeBusy: false,
      persistenceDegraded: false,
      onRetry: vi.fn(),
      onSave: vi.fn(),
      onSaveAsRoute: vi.fn(),
      onTrackHome: vi.fn(),
      onDelete: vi.fn(),
      onToggleSaved: vi.fn(),
      onExport: vi.fn(),
      onClose: vi.fn(),
      ...overrides,
    },
  }).body;
}

describe('TracksPanel', () => {
  it('distinguishes loading, failure, and genuinely empty saved lists', () => {
    expect(renderPanel({ loadState: 'loading' })).toContain('Loading saved tracks…');
    expect(renderPanel({ loadState: 'error' })).toContain('Could not load saved tracks.');
    expect(renderPanel()).toContain('No saved tracks yet.');
  });

  it('disables server writes without write access', () => {
    const recorder = {
      points: connectedPoints,
      paused: false,
      stats: { distanceMeters: 10, durationSeconds: 10, avgSog: 1, maxSog: 1 },
      pause: vi.fn(),
      resume: vi.fn(),
      clear: vi.fn(),
    } as unknown as TrackRecorder;
    const body = renderPanel({ auth: { writeBlocked: true }, recorder });
    expect(body).toMatch(/disabled[^>]*>[^<]*<svg[^>]*>[\s\S]*?Save/);
    expect(body).toMatch(/disabled[^>]*>[^<]*<svg[^>]*>[\s\S]*?Save as route/);
    expect(body).toMatch(/disabled[^>]*>[^<]*<svg[^>]*>[\s\S]*?Retrace track/);
  });

  it('names the admin step and offers a re-check when the server has no track storage', () => {
    const body = renderPanel({ provisioning: 'unprovisioned' });
    expect(body).toContain('This Signal K server has no track storage');
    expect(body).toContain('add a custom resource type named tracks');
    expect(body).toContain('Check again');
  });

  it('disables Save when the server has no track storage', () => {
    const recorder = {
      points: connectedPoints,
      paused: false,
      stats: { distanceMeters: 10, durationSeconds: 10, avgSog: 1, maxSog: 1 },
      pause: vi.fn(),
      resume: vi.fn(),
      clear: vi.fn(),
    } as unknown as TrackRecorder;
    // With a drawable track, write access, and a provisioned server, no control is disabled, so a
    // disabled Save in the unprovisioned render can only come from the missing track storage.
    expect(renderPanel({ recorder })).not.toContain('disabled');
    expect(renderPanel({ recorder, provisioning: 'unprovisioned' })).toMatch(
      /disabled[^>]*>[^<]*<svg[^>]*>[\s\S]*?Save/,
    );
  });

  it('drops the save-to-server urging from the memory-only alert without track storage', () => {
    const body = renderPanel({ persistenceDegraded: true, provisioning: 'unprovisioned' });
    expect(body).toContain('Track storage is memory-only.');
    expect(body).toContain('Saving to the server is unavailable until track storage is enabled');
    expect(body).not.toContain('Save it to the server before leaving.');
  });

  it('says why the saved list is empty when the server has no track storage', () => {
    expect(renderPanel({ provisioning: 'unprovisioned' })).toContain(
      'Saved tracks are unavailable until this server has track storage.',
    );
  });

  it('explains memory-only persistence and gap-safe route conversion', () => {
    const recorder = {
      points: [...connectedPoints, { lat: 2, lon: 2, t: 20_000, sog: 1, gap: true }],
      paused: false,
      stats: { distanceMeters: 10, durationSeconds: 20, avgSog: 0.5, maxSog: 1 },
      pause: vi.fn(),
      resume: vi.fn(),
      clear: vi.fn(),
    } as unknown as TrackRecorder;
    const body = renderPanel({ recorder, persistenceDegraded: true });
    expect(body).toContain('Track storage is memory-only.');
    expect(body).toContain('Route actions use only the latest continuous segment.');
  });
});
