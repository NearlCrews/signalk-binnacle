export {
  COMPANION_POLL_MS,
  type CompanionState,
  CompanionStatus,
} from './companion-status.svelte';

let regionsPanelModule: Promise<typeof import('./RegionsPanel.svelte')> | undefined;

export function loadRegionsPanel(): Promise<typeof import('./RegionsPanel.svelte')> {
  regionsPanelModule ??= import('./RegionsPanel.svelte').catch((error: unknown) => {
    regionsPanelModule = undefined;
    throw error;
  });
  return regionsPanelModule;
}
