import { createRetryableLazyUiLoader } from '$shared/lib';

export { CATEGORY_ORDER, CATEGORY_TITLES } from './layer-category';
export { LayersView } from './layers-view.svelte';

const layersPanelLoader = createRetryableLazyUiLoader(() => import('./LayersPanel.svelte'), {
  timeoutMessage: 'Layers controls took too long to load.',
});

export function loadLayersPanel(): Promise<typeof import('./LayersPanel.svelte')> {
  return layersPanelLoader();
}
