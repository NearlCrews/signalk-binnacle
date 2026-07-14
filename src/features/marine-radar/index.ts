export {
  createMarineRadarController,
  type MarineRadarDeps,
} from './marine-radar-controller.svelte';
export type { MarineRadarStore } from './marine-radar-store.svelte';
export { createPpiLayer, type PpiLayer, RADAR_UNAVAILABLE_HINT } from './ppi-layer';
export type { RadarStatus } from './radar-types';

let radarControlsModule: Promise<typeof import('./RadarControls.svelte')> | undefined;

export function loadRadarControls(): Promise<typeof import('./RadarControls.svelte')> {
  radarControlsModule ??= import('./RadarControls.svelte').catch((error: unknown) => {
    radarControlsModule = undefined;
    throw error;
  });
  return radarControlsModule;
}
