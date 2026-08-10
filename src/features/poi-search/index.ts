import { createRetryableLazyUiLoader } from '$shared/lib';

export type { Poi } from './poi-search-rows';

const poiSearchPanelLoader = createRetryableLazyUiLoader(() => import('./PoiSearchPanel.svelte'), {
  timeoutMessage: 'Find places controls took too long to load.',
});

export function loadPoiSearchPanel(): Promise<typeof import('./PoiSearchPanel.svelte')> {
  return poiSearchPanelLoader();
}
