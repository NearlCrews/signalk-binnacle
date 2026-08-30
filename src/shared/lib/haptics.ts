// A tactile registration cue for taps on a bouncing boat, where wet or gloved hands can miss the
// brightness-press visual feedback. One guard for every caller: the Vibration API is absent on
// desktop browsers and all of iOS, and an engine may refuse a call outside a trusted gesture, so
// a missed buzz must never break the action it confirms.
export function vibrate(pattern: number | number[]): void {
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(pattern);
  } catch {
    // The buzz is a courtesy; the confirming action itself must always proceed.
  }
}
