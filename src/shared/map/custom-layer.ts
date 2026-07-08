// MapLibre 5 passes a render-args object carrying the projection matrix; older builds pass the matrix
// directly. Accept both, returning an empty array when neither shape is present so a caller's length
// check rejects the frame as unrecognized. Shared by the WebGL custom layers (wind particles, the
// marine radar echo) so the shape probe lives in one place.
export function matrixOf(args: unknown): number[] {
  if (Array.isArray(args)) return args;
  const data = (args as { defaultProjectionData?: { mainMatrix?: number[] } })
    .defaultProjectionData;
  return data?.mainMatrix ?? [];
}
