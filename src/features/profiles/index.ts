import { createRetryableLazyUiLoader } from '$shared/lib';

export { default as ProfileSwitcher } from './ProfileSwitcher.svelte';
export { createProfileBindings } from './profile-bindings';
export { downloadProfileJson, type ImportedProfile } from './profile-io';
export { createProfilesController } from './profiles-controller.svelte';

const profilesPanelLoader = createRetryableLazyUiLoader(() => import('./ProfilesPanel.svelte'));

export function loadProfilesPanel(): Promise<typeof import('./ProfilesPanel.svelte')> {
  return profilesPanelLoader();
}
