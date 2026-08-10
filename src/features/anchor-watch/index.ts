import { createRetryableLazyUiLoader } from '$shared/lib';

export { default as AnchorStrip } from './AnchorStrip.svelte';
export { ANCHOR_TONE } from './anchor-alarm';
export { createAnchorController } from './anchor-controller.svelte';
export { ANCHOR_OVERLAY_ID, createAnchorOverlay } from './anchor-overlay';

const anchorPanelLoader = createRetryableLazyUiLoader(() => import('./AnchorPanel.svelte'), {
  timeoutMessage: 'Anchor watch controls took too long to load.',
});

export function loadAnchorPanel(): Promise<typeof import('./AnchorPanel.svelte')> {
  return anchorPanelLoader();
}
