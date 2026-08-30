// The deliberate-unlock thresholds. A wet sleeve or a stray palm produces short, chaotic contacts;
// unlocking takes most of the track's travel, and the keyboard path takes a sustained hold.

export const UNLOCK_DRAG_PX = 200;
export const UNLOCK_DRAG_FRACTION = 0.8;
export const HOLD_TO_UNLOCK_MS = 1500;

// A track that has not yielded a measurable travel (a broken or unmounted layout) falls back to
// the fixed distance, so a degenerate zero-width track can never turn a nudge into an unlock.
export function unlockThreshold(maxTravel: number): number {
  return maxTravel > 0
    ? Math.min(UNLOCK_DRAG_PX, maxTravel * UNLOCK_DRAG_FRACTION)
    : UNLOCK_DRAG_PX;
}
