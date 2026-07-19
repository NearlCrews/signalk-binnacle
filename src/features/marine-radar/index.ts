import { createRetryableLazyLoader } from '$shared/lib';

export {
  createMarineRadarController,
  type MarineRadarDeps,
} from './marine-radar-controller.svelte';
export type { MarineRadarStore } from './marine-radar-store.svelte';
export { createPpiLayer, type PpiLayer, RADAR_UNAVAILABLE_HINT } from './ppi-layer';
export type { RadarStatus } from './radar-types';

const radarControlsLoader = createRetryableLazyLoader(() => import('./RadarControls.svelte'));

export function loadRadarControls(): Promise<typeof import('./RadarControls.svelte')> {
  return radarControlsLoader();
}
