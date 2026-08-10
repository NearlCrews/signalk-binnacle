import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import { MAX_PROFILES, type Profile, type ProfileSettings } from '$entities/profile';
import type { UnitsStore } from '$entities/units';
import type { AuthController } from '$shared/signalk';
import ProfilesPanel from './ProfilesPanel.svelte';

function fakeUnits(source: 'server' | 'local' = 'local'): UnitsStore {
  return {
    mode: 'metric',
    source,
    localSetting: { value: 'metric', set: vi.fn() },
  } as unknown as UnitsStore;
}

function profiles(count: number): Profile[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `p${index}`,
    name: `Profile ${index}`,
    settings: {} as ProfileSettings,
    createdAt: 1,
    updatedAt: 1,
  }));
}

function renderPanel(overrides: Record<string, unknown> = {}): string {
  return render(ProfilesPanel, {
    props: {
      auth: { writeBlocked: false } as AuthController,
      units: fakeUnits(),
      profiles: profiles(1),
      activeId: 'p0',
      defaultId: undefined,
      syncState: 'local',
      remoteUpdateAvailable: false,
      remoteUpdateChanges: [],
      onRetrySync: vi.fn(),
      onApply: vi.fn(),
      onApplyRemoteUpdate: vi.fn(),
      onKeepCurrentSetup: vi.fn(),
      onSaveNew: vi.fn(),
      onRename: vi.fn(),
      onRemove: vi.fn(),
      onSetDefault: vi.fn(),
      onExport: vi.fn(),
      onImport: vi.fn(),
      onForgetCredentials: vi.fn(),
      onEraseAllLocalData: vi.fn(),
      onClose: vi.fn(),
      ...overrides,
    },
  }).body;
}

function blockedAuth(upgrading: boolean): AuthController {
  return {
    writeBlocked: true,
    upgrading,
    requestWriteAccess: vi.fn(),
  } as unknown as AuthController;
}

// The opening tag of the Save button, so an assertion about its disabled state cannot be satisfied
// by some other control on the panel.
function saveButtonTag(body: string): string {
  const label = body.indexOf('Save current as profile');
  const start = body.lastIndexOf('<button', label);
  return body.slice(start, body.indexOf('>', start) + 1);
}

describe('ProfilesPanel', () => {
  it('discloses the unit source and hides the fallback selector when the server decides', () => {
    const serverLed = renderPanel({ units: fakeUnits('server') });
    expect(serverLed).toContain("Following the Signal K server's unit preference");
    expect(serverLed).not.toContain('Fallback display units');

    const localLed = renderPanel({ units: fakeUnits('local') });
    expect(localLed).toContain('does not publish a unit preference');
    expect(localLed).toContain('Fallback display units');
  });

  it('names the settings a remote update would change', () => {
    const body = renderPanel({
      remoteUpdateAvailable: true,
      remoteUpdateChanges: ['theme', 'thresholds', 'anchorRadiusMeters'],
    });

    expect(body).toContain('The active profile was updated on another station.');
    expect(body).toContain('Theme, Collision thresholds, and Anchor radius');
  });

  it('keeps the prompt generic when nothing portable differs', () => {
    const body = renderPanel({ remoteUpdateAvailable: true, remoteUpdateChanges: [] });

    expect(body).toContain('The active profile was updated on another station.');
    expect(body).not.toContain('Changed:');
  });

  it('leaves the prompt out with no pending remote update', () => {
    expect(renderPanel()).not.toContain('The active profile was updated on another station.');
  });

  it('disables saving at the profile limit and says why', () => {
    const body = renderPanel({ profiles: profiles(MAX_PROFILES) });

    expect(saveButtonTag(body)).toContain('disabled');
    expect(body).toContain('-profile limit. Delete a profile');
    expect(saveButtonTag(renderPanel())).not.toContain('disabled');
  });

  it('announces every sync state that can change while the panel is open', () => {
    expect(renderPanel({ syncState: 'local' })).not.toContain('role="status"');
    expect(renderPanel({ syncState: 'syncing' })).toContain('role="status"');
    expect(renderPanel({ syncState: 'synced' })).toContain('role="status"');
    expect(renderPanel({ syncState: 'waiting' })).toContain('role="status"');
  });

  it('offers the read/write request while syncing is blocked', () => {
    const body = renderPanel({ auth: blockedAuth(false) });

    expect(body).toContain('A write token is needed to sync them to other stations.');
    expect(body).toContain('Request read/write access');
  });

  it('rests the request control while a request is outstanding', () => {
    expect(renderPanel({ auth: blockedAuth(true) })).toMatch(
      /<button[^>]+disabled[^>]*>\s*Requesting access/,
    );
  });

  it('tells the navigator that a waiting sync needs no action', () => {
    expect(renderPanel({ syncState: 'waiting' })).toContain('They will sync automatically');
  });

  it('uses platform-neutral wording in the empty state', () => {
    const body = renderPanel({ profiles: [], activeId: undefined });

    expect(body).toContain('then select Save current as profile');
  });
});
