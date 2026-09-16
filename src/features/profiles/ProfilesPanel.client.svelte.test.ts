import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Profile, ProfileSettings } from '$entities/profile';
import type { UnitsStore } from '$entities/units';
import type { AuthController } from '$shared/signalk';
import ProfilesPanel from './ProfilesPanel.svelte';

const mounted: Array<() => void> = [];
let lifecycleWarnings: string[] = [];
beforeEach(() => {
  lifecycleWarnings = [];
  const originalWarn = console.warn;
  vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    originalWarn(...args);
    if (args.some((value) => typeof value === 'string' && value.includes('derived_inert'))) {
      lifecycleWarnings.push(args.map(String).join(' '));
    }
  });
});
afterEach(() => {
  for (const dispose of mounted.splice(0).reverse()) dispose();
  try {
    expect(lifecycleWarnings).toEqual([]);
  } finally {
    vi.restoreAllMocks();
  }
});

function mountPanel() {
  const target = document.createElement('div');
  document.body.append(target);
  const profiles: Profile[] = ['Coastal day', 'Night passage'].map((name, index) => ({
    id: `profile-${index}`,
    name,
    settings: {} as ProfileSettings,
    createdAt: 1,
    updatedAt: 1,
  }));
  const onSaveNew = vi.fn();
  const onRename = vi.fn();
  const onRemove = vi.fn();
  const component = mount(ProfilesPanel, {
    target,
    props: {
      auth: { writeBlocked: false } as AuthController,
      units: { source: 'server', mode: 'metric' } as UnitsStore,
      profiles,
      activeId: profiles[0].id,
      defaultId: profiles[0].id,
      syncState: 'local',
      remoteUpdateAvailable: false,
      remoteUpdateChanges: [],
      onRetrySync: vi.fn(),
      onApply: vi.fn(),
      onApplyRemoteUpdate: vi.fn(),
      onKeepCurrentSetup: vi.fn(),
      onSaveNew,
      onRename,
      onRemove,
      onSetDefault: vi.fn(),
      onExport: vi.fn(),
      onImport: vi.fn(),
      onForgetCredentials: vi.fn(),
      onEraseAllLocalData: vi.fn(),
      onClose: vi.fn(),
    },
  });
  flushSync();
  mounted.push(() => {
    void unmount(component);
    target.remove();
  });
  return { target, onSaveNew, onRename, onRemove };
}

function button(target: HTMLElement, label: string): HTMLButtonElement {
  const found = [...target.querySelectorAll<HTMLButtonElement>('button')].find(
    (candidate) =>
      candidate.textContent?.trim() === label || candidate.getAttribute('aria-label') === label,
  );
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}

function activate(target: HTMLElement, label: string): void {
  const control = button(target, label);
  control.focus();
  control.click();
  flushSync();
}

describe('ProfilesPanel cancellation focus', () => {
  it('returns an idle name-form Escape to Save current as profile', async () => {
    const { target, onSaveNew } = mountPanel();
    await tick();
    activate(target, 'Save current as profile');
    expect(document.activeElement).toBe(target.querySelector('input'));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    flushSync();
    await tick();
    expect(document.activeElement).toBe(button(target, 'Save current as profile'));
    expect(target.querySelector('form')).toBeNull();
    expect(onSaveNew).not.toHaveBeenCalled();
  });

  it.each(['Rename profile', 'Delete profile'])(
    'returns canceled %s to the same profile action menu',
    async (label) => {
      const { target, onRename, onRemove } = mountPanel();
      await tick();
      activate(target, 'More actions for Night passage');
      await vi.waitFor(() => expect(document.activeElement).toBe(button(target, 'Rename profile')));
      activate(target, label);
      const cancel = button(target, 'Cancel');
      const promptControl = label === 'Rename profile' ? target.querySelector('input') : cancel;
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      expect(document.activeElement).toBe(promptControl);
      cancel.focus();
      cancel.click();
      flushSync();
      await tick();
      expect(document.activeElement).toBe(button(target, 'More actions for Night passage'));
      expect(onRename).not.toHaveBeenCalled();
      expect(onRemove).not.toHaveBeenCalled();
    },
  );

  it('closes a live action menu when focus leaves without reclaiming the new focus', async () => {
    const { target } = mountPanel();
    await tick();
    activate(target, 'More actions for Night passage');
    await vi.waitFor(() => expect(document.activeElement).toBe(button(target, 'Rename profile')));
    const destination = button(target, 'Save current as profile');
    destination.focus();
    flushSync();
    await vi.waitFor(() => expect(target.querySelector('[role="menu"]')).toBeNull());
    expect(document.activeElement).toBe(destination);
  });

  it('ignores a deferred focus-out after focus has already returned to the live menu', async () => {
    const { target } = mountPanel();
    await tick();
    activate(target, 'More actions for Night passage');
    const rename = button(target, 'Rename profile');
    await vi.waitFor(() => expect(document.activeElement).toBe(rename));
    button(target, 'Save current as profile').focus();
    rename.focus();
    await tick();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    expect(button(target, 'More actions for Night passage').getAttribute('aria-expanded')).toBe(
      'true',
    );
    expect(document.activeElement).toBe(rename);
  });
});
