import { createRetryableLazyLoader } from '$shared/lib';

const aisListPanelLoader = createRetryableLazyLoader(() => import('./AisListPanel.svelte'));

export function loadAisListPanel(): Promise<typeof import('./AisListPanel.svelte')> {
  return aisListPanelLoader();
}
