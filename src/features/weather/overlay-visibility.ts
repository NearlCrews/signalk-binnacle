// Whether a visibility write turns an overlay on for the first time: previously hidden and now
// shown. Shared by the field, pressure, waves, and wind overlays, each of which resets its time
// gate and resyncs from scratch only on that transition, never on a redundant true-to-true write.
export function becameVisible(previousVisible: boolean, next: boolean): boolean {
  return next && !previousVisible;
}
