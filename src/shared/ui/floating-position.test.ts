import { describe, expect, it } from 'vitest';
import { floatingPosition } from './floating-position';

describe('floatingPosition', () => {
  const viewport = { width: 360, height: 640 };
  const surface = { width: 208, height: 184 };

  it('opens below and clamps a leading-edge trigger inside the viewport', () => {
    expect(
      floatingPosition(
        { top: 80, right: 52, bottom: 124, left: 8, width: 44, height: 44 },
        surface,
        viewport,
      ),
    ).toEqual({ left: 8, top: 128, opensBelow: true });
  });

  it('opens above and end-aligns a trailing-edge trigger', () => {
    expect(
      floatingPosition(
        { top: 560, right: 352, bottom: 604, left: 308, width: 44, height: 44 },
        surface,
        viewport,
        { placement: 'above', align: 'end' },
      ),
    ).toEqual({ left: 144, top: 372, opensBelow: false });
  });

  it('uses the roomier side and clamps when neither side fully fits', () => {
    expect(
      floatingPosition(
        { top: 120, right: 204, bottom: 164, left: 160, width: 44, height: 44 },
        { width: 208, height: 500 },
        viewport,
      ),
    ).toEqual({ left: 144, top: 132, opensBelow: true });
  });
});
