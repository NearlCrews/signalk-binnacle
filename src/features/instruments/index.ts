import { createRetryableLazyUiLoader } from '$shared/lib';

export { createInstrumentsController } from './instruments-controller.svelte';
export { detectKip, KIP_URL } from './kip-launcher';
export { DEFAULT_TILES } from './tile-catalog';

const instrumentsPanelLoader = createRetryableLazyUiLoader(
  () => import('./InstrumentsPanel.svelte'),
);

export function loadInstrumentsPanel(): Promise<typeof import('./InstrumentsPanel.svelte')> {
  return instrumentsPanelLoader();
}
