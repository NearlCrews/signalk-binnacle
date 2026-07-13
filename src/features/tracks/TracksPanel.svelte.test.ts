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
