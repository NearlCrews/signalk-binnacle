import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('matrixOf', () => {
  it('returns the normalized Mercator matrix without losing Float64 precision', async () => {
    const { matrixOf } = await import('./custom-layer');
    const modelViewProjectionMatrix = new Float32Array(16).fill(1);
    const mainMatrix = new Float64Array(
      Array.from({ length: 16 }, (_, index) => index + 0.123456789),
    );

    expect(
      matrixOf({
        modelViewProjectionMatrix,
        defaultProjectionData: { mainMatrix },
      }),
    ).toBe(mainMatrix);
  });

  it('returns a legacy direct array unchanged', async () => {
    const { matrixOf } = await import('./custom-layer');
    const matrix = Array.from({ length: 16 }, (_, index) => index);

    expect(matrixOf(matrix)).toBe(matrix);
  });

  it('warns once for unrecognized render arguments, including null', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { matrixOf } = await import('./custom-layer');

    expect(matrixOf(null)).toEqual([]);
    expect(matrixOf({})).toEqual([]);
    expect(warn).toHaveBeenCalledOnce();
  });
});

describe('matrixForWebGl', () => {
  it('returns an existing Float32Array directly', async () => {
    const { matrixForWebGl } = await import('./custom-layer');
    const matrix = new Float32Array(16);

    expect(matrixForWebGl(matrix, new Float32Array(16))).toBe(matrix);
  });

  it('reuses and overwrites the supplied scratch matrix for Float64 values', async () => {
    const { matrixForWebGl } = await import('./custom-layer');
    const scratch = new Float32Array(16);
    const first = new Float64Array(Array.from({ length: 16 }, (_, index) => index + 0.123456789));
    const second = new Float64Array(
      Array.from({ length: 16 }, (_, index) => 100 + index + 0.987654321),
    );

    expect(matrixForWebGl(first, scratch)).toBe(scratch);
    expect(Array.from(scratch)).toEqual(Array.from(first, (value) => Math.fround(value)));

    expect(matrixForWebGl(second, scratch)).toBe(scratch);
    expect(Array.from(scratch)).toEqual(Array.from(second, (value) => Math.fround(value)));
  });

  it('rejects malformed matrix and scratch lengths', async () => {
    const { matrixForWebGl } = await import('./custom-layer');

    expect(() => matrixForWebGl(new Float64Array(15), new Float32Array(16))).toThrow(RangeError);
    expect(() => matrixForWebGl(new Float64Array(16), new Float32Array(15))).toThrow(RangeError);
  });
});
