// The fly/slide duration shared by the SlideOver dock and the floating weather panel, in one place
// so the two panel transitions stay in sync. Milliseconds: JS transition timings sit outside the
// CSS token contract, so they cannot be a custom property.
export const PANEL_TRANSITION_MS = 180;
