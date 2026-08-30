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
      units: 'metric',
      positionStale: false,
      hasPosition: true,
      clock: { now: 1_000_000 },
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

  it('says Recording only while fresh GPS is feeding the armed recorder', () => {
    const healthy = renderPanel();
    expect(healthy).toContain('status--on');
    expect(healthy).not.toContain('Waiting for fresh GPS');
    const stale = renderPanel({ positionStale: true });
    expect(stale).not.toContain('status--on');
    expect(stale).toContain('Waiting for fresh GPS');
    const neverFixed = renderPanel({ hasPosition: false });
    expect(neverFixed).toContain('Waiting for fresh GPS');
    expect(neverFixed).toContain('starts automatically');
  });

  it('names the last accepted fix age while waiting', () => {
    const recorder = {
      points: [{ lat: 1, lon: 1, t: 1_000_000 - 120_000, sog: 1 }],
      paused: false,
      stats: { distanceMeters: 10, durationSeconds: 10, avgSog: 1, maxSog: 1 },
      pause: vi.fn(),
      resume: vi.fn(),
      clear: vi.fn(),
    } as unknown as TrackRecorder;
    const body = renderPanel({ positionStale: true, recorder });
    expect(body).toContain('Last accepted fix 2 min ago');
    expect(body).toContain('resumes automatically');
  });

  it('keeps manual pause distinct from waiting for GPS', () => {
    const recorder = {
      points: [],
      paused: true,
      stats: { distanceMeters: 0, durationSeconds: 0, avgSog: 0, maxSog: 0 },
      pause: vi.fn(),
      resume: vi.fn(),
      clear: vi.fn(),
    } as unknown as TrackRecorder;
    const body = renderPanel({ positionStale: true, recorder });
    expect(body).toContain('Paused');
    expect(body).not.toContain('Waiting for fresh GPS');
  });

  it('names a fresh segment after a recovery gap, and stays quiet after an old one', () => {
    const gapPoints = [
      { lat: 1, lon: 1, t: 1_000_000 - 400_000, sog: 1 },
      { lat: 1.001, lon: 1, t: 1_000_000 - 60_000, sog: 1, gap: true },
      { lat: 1.002, lon: 1, t: 1_000_000 - 30_000, sog: 1 },
    ];
    const recorder = {
      points: gapPoints,
      paused: false,
      stats: { distanceMeters: 10, durationSeconds: 10, avgSog: 1, maxSog: 1 },
      pause: vi.fn(),
      resume: vi.fn(),
      clear: vi.fn(),
    } as unknown as TrackRecorder;
    expect(renderPanel({ recorder })).toContain('new segment after a GPS gap');

    const oldGap = {
      ...recorder,
      points: [
        { lat: 1, lon: 1, t: 1_000_000 - 4_000_000, sog: 1 },
        { lat: 1.001, lon: 1, t: 1_000_000 - 3_600_000, sog: 1, gap: true },
        { lat: 1.002, lon: 1, t: 1_000_000 - 3_500_000, sog: 1 },
      ],
    } as unknown as TrackRecorder;
    expect(renderPanel({ recorder: oldGap })).not.toContain('new segment after a GPS gap');
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
    expect(body).toContain('add tracks under Resources (custom)');
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

  it('reveals the passage debrief once the recording clears the time and distance floors', () => {
    const recorder = {
      points: [
        { lat: 0, lon: 0, t: 0, sog: 2 },
        { lat: 0.01, lon: 0, t: 600_000, sog: 3 },
      ],
      paused: false,
      stats: { distanceMeters: 1112, durationSeconds: 600, avgSog: 1.85, maxSog: 3 },
      pause: vi.fn(),
      resume: vi.fn(),
      clear: vi.fn(),
    } as unknown as TrackRecorder;
    const body = renderPanel({ recorder });
    expect(body).toContain('Passage debrief');
    expect(body).toContain('Underway');
    expect(body).toContain('Stopped');
    expect(body).toContain('Avg underway');
    expect(body).toContain('Top underway');
    expect(body).toContain('Longest leg');
    expect(body).not.toContain('The debrief appears once the current track covers');
  });

  it('states the debrief thresholds while the recording is still short', () => {
    const body = renderPanel();
    expect(body).toContain('Passage debrief');
    expect(body).toContain(
      'The debrief appears once the current track covers at least 10 min and 0.25 nm',
    );
    expect(body).not.toContain('Longest leg');
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
