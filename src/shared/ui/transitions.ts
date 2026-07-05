// The fly/slide duration shared by the SlideOver dock and the floating weather panel, in one place
// so the two panel transitions stay in sync. Milliseconds: JS transition timings sit outside the
// CSS token contract, so they cannot be a custom property.
export const PANEL_TRANSITION_MS = 180;

/**
 * Safely starts a View Transition if supported by the browser,
 * otherwise runs the callback synchronously for progressive enhancement.
 */
export function startViewTransition(callback: () => void | Promise<void>): void {
  if (document.startViewTransition) {
    document.startViewTransition(callback);
  } else {
    void callback();
  }
}
