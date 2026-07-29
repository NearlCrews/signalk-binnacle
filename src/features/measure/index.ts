import { createRetryableLazyLoader } from '$shared/lib';

const measureStripLoader = createRetryableLazyLoader(() => import('./MeasureStrip.svelte'));

export function loadMeasureStrip(): Promise<typeof import('./MeasureStrip.svelte')> {
  return measureStripLoader();
}

export type { MeasureOverlay } from './measure-overlay';
export { createMeasureOverlay } from './measure-overlay-proxy';
