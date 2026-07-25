// MapLibre 6 passes a render-args object carrying `modelViewProjectionMatrix` (world to clip
// space). v5's `defaultProjectionData.mainMatrix` is deliberately NOT read here: in v6 that field
// still exists but became a tile-local matrix, not the world-space MVP, so reading it would
// silently draw with the wrong matrix instead of failing. Shared by the WebGL custom layers (wind
// particles, the marine radar echo) so the shape probe lives in one place. Warns once, not per
// frame, when the shape is not found, so a future render-args change surfaces instead of both
// layers silently going blank forever.
let warnedUnrecognizedShape = false;

export function matrixOf(args: unknown): number[] {
  const opts = args as { modelViewProjectionMatrix?: number[] };
  if (opts.modelViewProjectionMatrix) return opts.modelViewProjectionMatrix;
  if (!warnedUnrecognizedShape) {
    warnedUnrecognizedShape = true;
    console.warn('[custom-layer] unrecognized render-args shape, matrix probe found nothing', args);
  }
  return [];
}
