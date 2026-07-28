import { createRetryableLazyLoader } from '$shared/lib';

const trendsPanelLoader = createRetryableLazyLoader(() => import('./TrendsPanel.svelte'));

export function loadTrendsPanel(): Promise<typeof import('./TrendsPanel.svelte')> {
  return trendsPanelLoader();
}

export { TrendSessionRecorder } from './session-recorder.svelte';
export {
  createTrendsController,
  type TrendItem,
  type TrendsController,
} from './trends-controller.svelte';
