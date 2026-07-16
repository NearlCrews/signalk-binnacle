export { default as ProfileSwitcher } from './ProfileSwitcher.svelte';
export { createProfileBindings } from './profile-bindings';
export { downloadProfileJson, type ImportedProfile } from './profile-io';
export { createProfilesController } from './profiles-controller.svelte';

let profilesPanelModule: Promise<typeof import('./ProfilesPanel.svelte')> | undefined;

export function loadProfilesPanel(): Promise<typeof import('./ProfilesPanel.svelte')> {
  profilesPanelModule ??= import('./ProfilesPanel.svelte').catch((error: unknown) => {
    profilesPanelModule = undefined;
    throw error;
  });
  return profilesPanelModule;
}
