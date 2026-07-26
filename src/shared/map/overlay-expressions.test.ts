import { describe, expect, it } from 'vitest';
import { iconOffsetExpression } from './overlay-expressions';

describe('iconOffsetExpression', () => {
  it('returns the centered offset when no provided symbol declares an anchor', () => {
    expect(iconOffsetExpression('iconImage', new Map())).toEqual([0, 0]);
  });

  it('scales each anchor offset in lockstep with the marker icon-size zoom stops', () => {
    // MapLibre 6 no longer scales icon-offset by icon-size, so the expression itself must carry
    // the 0.6-at-zoom-9 to 0.9-at-zoom-14 marker scaling or a provided symbol's anchor drifts.
    const offsets = new Map<string, readonly [number, number]>([['sym-a', [10, -20]]]);
    expect(iconOffsetExpression('icon', offsets)).toEqual([
      'interpolate',
      ['linear'],
      ['zoom'],
      9,
      ['match', ['get', 'icon'], 'sym-a', ['literal', [6, -12]], ['literal', [0, 0]]],
      14,
      ['match', ['get', 'icon'], 'sym-a', ['literal', [9, -18]], ['literal', [0, 0]]],
    ]);
  });

  it('keeps centered markers centered at every stop', () => {
    const offsets = new Map<string, readonly [number, number]>([['sym-a', [8, 8]]]);
    const expression = iconOffsetExpression('icon', offsets) as unknown[];
    const stopAtNine = expression[4] as unknown[];
    expect(stopAtNine.at(-1)).toEqual(['literal', [0, 0]]);
  });
});
