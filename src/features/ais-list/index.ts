import { createRetryableLazyUiLoader } from '$shared/lib';

const aisListPanelLoader = createRetryableLazyUiLoader(() => import('./AisListPanel.svelte'));

export function loadAisListPanel(): Promise<typeof import('./AisListPanel.svelte')> {
  return aisListPanelLoader();
}
