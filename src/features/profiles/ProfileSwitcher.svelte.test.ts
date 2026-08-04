import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import type { Profile, ProfileSettings } from '$entities/profile';
import ProfileSwitcher from './ProfileSwitcher.svelte';

const profile: Profile = {
  id: 'p1',
  name: 'Coastal cruising',
  settings: {} as ProfileSettings,
  createdAt: 1,
  updatedAt: 1,
};

function renderSwitcher(overrides: Record<string, unknown> = {}): string {
  return render(ProfileSwitcher, {
    props: { active: profile, onClick: vi.fn(), ...overrides },
  }).body;
}

describe('ProfileSwitcher', () => {
  it('carries the pending remote update in both the indicator and the label', () => {
    const body = renderSwitcher({ hasUpdate: true });

    expect(body).toContain('update-dot');
    expect(body).toContain('Profile Coastal cruising, update available, open profiles');
  });

  it('shows no update signal by default', () => {
    const body = renderSwitcher();

    expect(body).not.toContain('update-dot');
    expect(body).not.toContain('update available');
  });

  it('names the active profile in the hover title, not just the label', () => {
    expect(renderSwitcher()).toContain('title="Profile Coastal cruising, open profiles"');
    expect(renderSwitcher({ active: undefined })).toContain('title="No profile, open profiles"');
  });
});
