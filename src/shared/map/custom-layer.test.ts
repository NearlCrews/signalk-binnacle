import { describe, expect, it, vi } from 'vitest';
import { matrixOf } from './custom-layer';

// matrixOf is the load-bearing v6 render-args probe for both WebGL custom layers (wind particles
// and the radar echo): a wrong shape assumption silently blanks both, so the shape contract and
// the warn-once tell are pinned here. Assertions share one module instance, so order matters: the
// recognized shape runs first and must not warn.
describe('matrixOf', () => {
  it('returns the v6 modelViewProjectionMatrix and warns once on an unrecognized shape', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const matrix = Array.from({ length: 16 }, (_, i) => i);
      expect(matrixOf({ modelViewProjectionMatrix: matrix })).toBe(matrix);
      expect(warn).not.toHaveBeenCalled();

      expect(matrixOf({})).toEqual([]);
      expect(warn).toHaveBeenCalledOnce();

      // The warn is once per session, not per frame: a second unrecognized frame stays quiet.
      expect(matrixOf({ defaultProjectionData: { mainMatrix: matrix } })).toEqual([]);
      expect(warn).toHaveBeenCalledOnce();
    } finally {
      warn.mockRestore();
    }
  });
});
