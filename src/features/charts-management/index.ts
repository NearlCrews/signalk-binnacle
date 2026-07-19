import { createRetryableLazyLoader } from '$shared/lib';

const chartsManagementPanelLoader = createRetryableLazyLoader(
  () => import('./ChartsManagementPanel.svelte'),
);

export function loadChartsManagementPanel(): Promise<
  typeof import('./ChartsManagementPanel.svelte')
> {
  return chartsManagementPanelLoader();
}
