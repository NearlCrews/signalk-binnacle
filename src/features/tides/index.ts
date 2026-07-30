import { createRetryableLazyUiLoader } from '$shared/lib';

export {
  fetchSignalkTidesReading,
  SIGNALK_TIDES_PLUGIN_ID,
} from './signalk-tides-client';
export { createTidesController, type TidesController } from './tides-controller.svelte';
export type { TideStationSelectionEvent } from './tides-hit-handlers';
export { createTidesLoader, type TidesLoader } from './tides-loader';
export { createTidesOverlay } from './tides-overlay';

const tidesPanelLoader = createRetryableLazyUiLoader(() => import('./TidesPanel.svelte'), {
  timeoutMessage: 'Tides controls took too long to load.',
});

export function loadTidesPanel(): Promise<typeof import('./TidesPanel.svelte')> {
  return tidesPanelLoader();
}
