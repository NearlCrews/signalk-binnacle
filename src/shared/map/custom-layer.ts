import type { ProjectionMatrix } from 'maplibre-gl';

export type CustomLayerMatrix = ProjectionMatrix | number[];

const EMPTY_MATRIX: number[] = [];
let warnedUnrecognizedShape = false;

export function matrixOf(args: unknown): CustomLayerMatrix {
  if (Array.isArray(args)) return args;
  // Binnacle's custom-layer vertices use normalized Mercator world coordinates, so they need the
  // default projection's main matrix rather than the raw model-view-projection matrix.
  const data =
    args !== null && typeof args === 'object'
      ? (args as { defaultProjectionData?: { mainMatrix?: ProjectionMatrix } })
          .defaultProjectionData
      : undefined;
  if (data?.mainMatrix) return data.mainMatrix;
  if (!warnedUnrecognizedShape) {
    warnedUnrecognizedShape = true;
    console.warn('[custom-layer] unrecognized render-args shape, matrix probe found nothing', args);
  }
  return EMPTY_MATRIX;
}

export function matrixForWebGl(matrix: CustomLayerMatrix, scratch: Float32Array): Float32Array {
  if (matrix.length !== 16 || scratch.length !== 16) {
    throw new RangeError('WebGL projection matrices must contain 16 values');
  }
  if (matrix instanceof Float32Array) return matrix;
  scratch.set(matrix);
  return scratch;
}
