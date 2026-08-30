import { createRetryableLazyUiLoader } from '$shared/lib';

export { default as AutopilotChip } from './AutopilotChip.svelte';
export {
  type AutopilotChipState,
  type AutopilotController,
  type AutopilotDeps,
  createAutopilotController,
} from './autopilot-controller.svelte';

const autopilotPanelLoader = createRetryableLazyUiLoader(() => import('./AutopilotPanel.svelte'), {
  timeoutMessage: 'Autopilot controls took too long to load.',
});

export function loadAutopilotPanel(): Promise<typeof import('./AutopilotPanel.svelte')> {
  return autopilotPanelLoader();
}
