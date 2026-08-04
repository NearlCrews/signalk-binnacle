import { createRetryableLazyUiLoader } from '$shared/lib';

const measureStripLoader = createRetryableLazyUiLoader(() => import('./MeasureStrip.svelte'));

export function loadMeasureStrip(): Promise<typeof import('./MeasureStrip.svelte')> {
  return measureStripLoader();
}

export type { MeasureOverlay } from './measure-overlay';
export { MEASURE_OVERLAY_ID } from './measure-overlay-contract';
export { createMeasureOverlay } from './measure-overlay-proxy';
