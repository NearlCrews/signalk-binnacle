import { createRetryableLazyLoader } from '$shared/lib';

export {
  COMPANION_POLL_MS,
  type CompanionState,
  CompanionStatus,
} from './companion-status.svelte';

const regionsPanelLoader = createRetryableLazyLoader(() => import('./RegionsPanel.svelte'));

export function loadRegionsPanel(): Promise<typeof import('./RegionsPanel.svelte')> {
  return regionsPanelLoader();
}
