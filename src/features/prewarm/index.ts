import { createRetryableLazyUiLoader } from '$shared/lib';

export {
  COMPANION_POLL_MS,
  type CompanionState,
  CompanionStatus,
} from './companion-status.svelte';
export {
  type CoverageRoute,
  type RouteCoverageAssessment,
  routeCoverageAreasKey,
  routeCoverageCatalogKey,
  routeCoverageGeometryKey,
} from './coverage-context';
export type { OfflineSetupState } from './offline-setup';
export type { SavedRegionDto } from './regions-client';
export { loadRegionsClient } from './regions-client-loader';
export type { CoverageVerdict, RouteCoverageReport } from './route-coverage';

const regionsPanelLoader = createRetryableLazyUiLoader(() => import('./RegionsPanel.svelte'));
const offlineSetupPanelLoader = createRetryableLazyUiLoader(
  () => import('./OfflineSetupPanel.svelte'),
);

export function loadRegionsPanel(): Promise<typeof import('./RegionsPanel.svelte')> {
  return regionsPanelLoader();
}

export function loadOfflineSetupPanel(): Promise<typeof import('./OfflineSetupPanel.svelte')> {
  return offlineSetupPanelLoader();
}
