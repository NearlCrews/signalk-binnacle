import { createRetryableLazyUiLoader } from '$shared/lib';

const historyStripLoader = createRetryableLazyUiLoader(() => import('./HistoryStrip.svelte'));

export function loadHistoryStrip(): Promise<typeof import('./HistoryStrip.svelte')> {
  return historyStripLoader();
}

export {
  createTimeTravelController,
  type TimeTravelController,
} from './time-travel-controller.svelte';
export {
  createTimeTravelOverlay,
  createTimeTravelTrackOverlay,
} from './time-travel-overlay';
export { TIME_TRAVEL_PRESETS, type TimeTravelRangeId } from './time-travel-presets';
