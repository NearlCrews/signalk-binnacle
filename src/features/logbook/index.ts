import { createRetryableLazyUiLoader } from '$shared/lib';

export {
  createLogbookController,
  type LogbookController,
  type LogbookDeps,
  type LogbookSuggestion,
} from './logbook-controller.svelte';
export {
  logbookAnchorSuggestion,
  logbookCourseSuggestion,
  logbookHandoffSuggestion,
} from './suggestions';

const logbookPanelLoader = createRetryableLazyUiLoader(() => import('./LogbookPanel.svelte'), {
  timeoutMessage: 'Logbook took too long to load.',
});

export function loadLogbookPanel(): Promise<typeof import('./LogbookPanel.svelte')> {
  return logbookPanelLoader();
}
