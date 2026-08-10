import { createRetryableLazyUiLoader } from '$shared/lib';

const helpPanelLoader = createRetryableLazyUiLoader(() => import('./HelpPanel.svelte'), {
  timeoutMessage: 'Help took too long to load.',
});

export function loadHelpPanel(): Promise<typeof import('./HelpPanel.svelte')> {
  return helpPanelLoader();
}
