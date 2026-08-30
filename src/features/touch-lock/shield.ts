// Shield geometry for the wet-screen lock. The lock covers the viewport with real DOM panels and
// leaves true holes over the safety surfaces (the MOB key, the emergency rail), so a tap on an
// alarm acknowledge hits the actual control underneath with no reliance on clip-path hit-testing.
// Panels tile the viewport as horizontal bands split at every hole edge; adjacent panels share
// exact float edges, so fractional device-pixel rounding cannot open a seam that leaks a tap.

export interface ShieldRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface ShieldViewport {
  width: number;
  height: number;
}

function clampToViewport(rect: ShieldRect, viewport: ShieldViewport): ShieldRect {
  const left = Math.max(0, rect.left);
  const top = Math.max(0, rect.top);
  const right = Math.min(viewport.width, rect.left + rect.width);
  const bottom = Math.min(viewport.height, rect.top + rect.height);
  return { top, left, width: right - left, height: bottom - top };
}

// The blocking panels covering everything except the holes. Bands between consecutive hole edges,
// each swept left to right past the holes that intersect it; overlapping holes merge in the sweep.
export function shieldPanels(viewport: ShieldViewport, holes: readonly ShieldRect[]): ShieldRect[] {
  const clamped = holes
    .map((hole) => clampToViewport(hole, viewport))
    .filter((hole) => hole.width > 0 && hole.height > 0);
  if (clamped.length === 0) {
    return [{ top: 0, left: 0, width: viewport.width, height: viewport.height }];
  }
  const edges = [
    ...new Set([
      0,
      viewport.height,
      ...clamped.flatMap((hole) => [hole.top, hole.top + hole.height]),
    ]),
  ].sort((a, b) => a - b);
  const panels: ShieldRect[] = [];
  for (let i = 0; i < edges.length - 1; i += 1) {
    const top = edges[i];
    const bottom = edges[i + 1];
    const banded = clamped
      .filter((hole) => hole.top < bottom && hole.top + hole.height > top)
      .sort((a, b) => a.left - b.left);
    let x = 0;
    for (const hole of banded) {
      if (hole.left > x) panels.push({ top, left: x, width: hole.left - x, height: bottom - top });
      x = Math.max(x, hole.left + hole.width);
    }
    if (x < viewport.width) {
      panels.push({ top, left: x, width: viewport.width - x, height: bottom - top });
    }
  }
  return panels;
}

// Where the lock card may sit: the largest vertical span free of holes, treating each hole as a
// full-width band. Keeps the card out of the emergency rail's way even when a tall alert stack
// reaches toward the center. A degenerate result falls back to the whole viewport.
export function lockCardBand(
  viewportHeight: number,
  holes: readonly ShieldRect[],
): { top: number; bottom: number } {
  const bands = holes
    .map((hole) => ({
      top: Math.max(0, hole.top),
      bottom: Math.min(viewportHeight, hole.top + hole.height),
    }))
    .filter((band) => band.bottom > band.top)
    .sort((a, b) => a.top - b.top);
  let cursor = 0;
  let best = { top: 0, bottom: 0 };
  for (const band of bands) {
    if (band.top - cursor > best.bottom - best.top) best = { top: cursor, bottom: band.top };
    cursor = Math.max(cursor, band.bottom);
  }
  if (viewportHeight - cursor > best.bottom - best.top) {
    best = { top: cursor, bottom: viewportHeight };
  }
  return best.bottom > best.top ? best : { top: 0, bottom: viewportHeight };
}
