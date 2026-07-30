import { createRetryableLazyUiLoader } from '$shared/lib';

const chartsManagementPanelLoader = createRetryableLazyUiLoader(
  () => import('./ChartsManagementPanel.svelte'),
);

export function loadChartsManagementPanel(): Promise<
  typeof import('./ChartsManagementPanel.svelte')
> {
  return chartsManagementPanelLoader();
}
