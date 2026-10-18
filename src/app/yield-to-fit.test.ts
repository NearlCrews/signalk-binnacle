import { describe, expect, it } from 'vitest';
import { yieldedIndexes } from './yield-to-fit';

const chip = (rank: number, width: number) => ({ rank, width });

describe('yieldedIndexes', () => {
  it('keeps every chip when the row fits', () => {
    expect(yieldedIndexes([chip(0, 100), chip(1, 60), chip(2, 44)], 8, 220)).toEqual([]);
  });

  it('gives way highest rank first until the rest fit', () => {
    const chips = [chip(0, 117), chip(1, 63), chip(3, 110), chip(2, 44)];
    expect(yieldedIndexes(chips, 8, 242)).toEqual([2]);
    expect(yieldedIndexes(chips, 8, 190)).toEqual([2, 3]);
  });

  it('never yields an unranked chip, even when it alone overflows', () => {
    expect(yieldedIndexes([chip(0, 300), chip(1, 44)], 8, 200)).toEqual([1]);
  });

  it('counts no width or gap for an absent chip', () => {
    expect(yieldedIndexes([chip(0, 100), chip(4, 0), chip(2, 44)], 8, 152)).toEqual([]);
  });

  it('ignores a rounding hair past the edge', () => {
    expect(yieldedIndexes([chip(0, 100), chip(1, 44.4)], 8, 152)).toEqual([]);
  });
});
