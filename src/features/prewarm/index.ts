import { createRetryableLazyUiLoader } from '$shared/lib';

export {
  COMPANION_POLL_MS,
  type CompanionState,
  CompanionStatus,
} from './companion-status.svelte';
export type { CoverageVerdict, RouteCoverageReport } from './route-coverage';

const regionsPanelLoader = createRetryableLazyUiLoader(() => import('./RegionsPanel.svelte'));

export function loadRegionsPanel(): Promise<typeof import('./RegionsPanel.svelte')> {
  return regionsPanelLoader();
}
