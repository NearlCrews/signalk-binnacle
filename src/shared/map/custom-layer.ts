// MapLibre 6 passes a render-args object with `modelViewProjectionMatrix` (world → clip space);
// v5 used `defaultProjectionData.mainMatrix` (which in v6 became a tile-local matrix, not the
// world-space MVP). Older builds pass the matrix directly as an array. Accept all three shapes,
// returning an empty array when none is present so a caller's length check rejects the frame as
// unrecognized. Shared by the WebGL custom layers (wind particles, the marine radar echo) so the
// shape probe lives in one place.
export function matrixOf(args: unknown): number[] {
  if (Array.isArray(args)) return args;
  const opts = args as {
    modelViewProjectionMatrix?: number[];
    defaultProjectionData?: { mainMatrix?: number[] };
  };
  return opts.modelViewProjectionMatrix ?? opts.defaultProjectionData?.mainMatrix ?? [];
}
