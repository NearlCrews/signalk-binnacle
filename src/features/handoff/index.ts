import { createRetryableLazyUiLoader } from '$shared/lib';

export { createHandoffClient, type HandoffClient } from './handoff-client';
export {
  createHandoffController,
  type HandoffController,
  type HandoffDeps,
} from './handoff-controller.svelte';

const handoffPanelLoader = createRetryableLazyUiLoader(() => import('./HandoffPanel.svelte'), {
  timeoutMessage: 'Watch handoff took too long to load.',
});

export function loadHandoffPanel(): Promise<typeof import('./HandoffPanel.svelte')> {
  return handoffPanelLoader();
}
