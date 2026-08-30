import { describe, expect, it } from 'vitest';
import { lockCardBand, type ShieldRect, shieldPanels } from './shield';

const viewport = { width: 1000, height: 800 };

function contains(rect: ShieldRect, x: number, y: number): boolean {
  return (
    x >= rect.left && x < rect.left + rect.width && y >= rect.top && y < rect.top + rect.height
  );
}

// Every viewport point must be covered by exactly one of: a hole, or one shield panel. A gap
// leaks a tap through the lock; an overlap over a hole blocks a safety control.
function expectExactTiling(holes: ShieldRect[]): void {
  const panels = shieldPanels(viewport, holes);
  for (let x = 0.5; x < viewport.width; x += 33.5) {
    for (let y = 0.5; y < viewport.height; y += 33.5) {
      const inHole = holes.some((hole) => contains(hole, x, y));
      const covering = panels.filter((panel) => contains(panel, x, y)).length;
      expect(covering, `point ${x},${y} inHole=${inHole}`).toBe(inHole ? 0 : 1);
    }
  }
}

describe('shieldPanels', () => {
  it('covers the whole viewport with one panel when there are no holes', () => {
    expect(shieldPanels(viewport, [])).toEqual([{ top: 0, left: 0, width: 1000, height: 800 }]);
  });

  it('tiles exactly around a central hole', () => {
    expectExactTiling([{ top: 300, left: 400, width: 200, height: 100 }]);
  });

  it('tiles exactly around the real shape: a top corner key and a bottom rail', () => {
    expectExactTiling([
      { top: 8, left: 860, width: 96, height: 44 },
      { top: 690, left: 250, width: 500, height: 98 },
    ]);
  });

  it('tiles exactly when holes overlap vertically and horizontally', () => {
    expectExactTiling([
      { top: 100, left: 100, width: 300, height: 300 },
      { top: 250, left: 300, width: 300, height: 300 },
    ]);
  });

  it('shares exact edges with each hole so no seam or overlap surrounds it', () => {
    const hole = { top: 300.25, left: 400.5, width: 200.25, height: 100.5 };
    const panels = shieldPanels(viewport, [hole]);
    const rightOfHole = panels.find((panel) => contains(panel, hole.left + hole.width, hole.top));
    const belowHole = panels.find((panel) => contains(panel, hole.left, hole.top + hole.height));
    expect(rightOfHole?.left).toBe(hole.left + hole.width);
    expect(belowHole?.top).toBe(hole.top + hole.height);
  });

  it('clamps a hole hanging off the viewport edge', () => {
    const panels = shieldPanels(viewport, [{ top: -50, left: 900, width: 200, height: 100 }]);
    expect(panels.some((panel) => contains(panel, 950, 25))).toBe(false);
    expect(panels.some((panel) => contains(panel, 950, 75))).toBe(true);
    expect(panels.some((panel) => contains(panel, 850, 25))).toBe(true);
  });

  it('ignores zero-area and fully off-viewport holes', () => {
    const panels = shieldPanels(viewport, [
      { top: 100, left: 100, width: 0, height: 50 },
      { top: 900, left: 0, width: 100, height: 100 },
    ]);
    expect(panels).toEqual([{ top: 0, left: 0, width: 1000, height: 800 }]);
  });
});

describe('lockCardBand', () => {
  it('returns the whole viewport when there are no holes', () => {
    expect(lockCardBand(800, [])).toEqual({ top: 0, bottom: 800 });
  });

  it('returns the widest span between a top key and a bottom rail', () => {
    const band = lockCardBand(800, [
      { top: 8, left: 860, width: 96, height: 44 },
      { top: 690, left: 250, width: 500, height: 98 },
    ]);
    expect(band).toEqual({ top: 52, bottom: 690 });
  });

  it('falls back to the whole viewport when holes cover every row', () => {
    expect(lockCardBand(800, [{ top: 0, left: 0, width: 10, height: 800 }])).toEqual({
      top: 0,
      bottom: 800,
    });
  });
});
