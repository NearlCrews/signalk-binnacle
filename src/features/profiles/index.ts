import { createRetryableLazyUiLoader } from '$shared/lib';

export { createProfileBindings } from './profile-bindings';
export { downloadProfileJson, type ImportedProfile } from './profile-io';
export { createProfilesController } from './profiles-controller.svelte';
export { seedStarterProfiles } from './starter-profiles';

const profilesPanelLoader = createRetryableLazyUiLoader(() => import('./ProfilesPanel.svelte'));

export function loadProfilesPanel(): Promise<typeof import('./ProfilesPanel.svelte')> {
  return profilesPanelLoader();
}
