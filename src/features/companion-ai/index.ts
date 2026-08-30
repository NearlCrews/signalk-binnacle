import { createRetryableLazyUiLoader } from '$shared/lib';

export {
  ACK_NOTE_MS,
  COMPANION_REFRESH_MS,
  type CompanionAiController,
  type CompanionAiDeps,
  type CompanionAvailability,
  createCompanionAiController,
} from './companion-ai-controller.svelte';
export {
  type CompanionReport,
  type CompanionReportsResult,
  fetchCompanionReports,
  MAX_COMPANION_ANALYZERS,
  MAX_COMPANION_MESSAGE_LENGTH,
  type RunAnalyzerAck,
  runAnalyzer,
} from './companion-client';
export { analyzerTitle, latestCompanionHeadline } from './companion-reports';

const companionAiPanelLoader = createRetryableLazyUiLoader(
  () => import('./CompanionAiPanel.svelte'),
  { timeoutMessage: 'AI advisor took too long to load.' },
);

export function loadCompanionAiPanel(): Promise<typeof import('./CompanionAiPanel.svelte')> {
  return companionAiPanelLoader();
}
