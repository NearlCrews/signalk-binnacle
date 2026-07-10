import type { LayerListItem } from '$shared/map';

export interface LayerCategory {
  id: string;
  title: string;
}

// The single source of truth for the Layers-panel categories: their order (top of the map first),
// their titles, and their first-run open state. CATEGORY_ORDER and CATEGORY_DEFAULT_OPEN derive from
// this so the id list never drifts. The order must match the map z-order (the band order in Z_ORDER
// and the registration order in ChartCanvas) so the panel reads the same as the stack and a
// drag-to-reorder lands where the navigator drops it.
const CATEGORIES = [
  { id: 'mine', title: 'My navigation', defaultOpen: true },
  { id: 'live', title: 'Traffic', defaultOpen: true },
  { id: 'reference', title: 'Chart overlays and marks', defaultOpen: false },
  { id: 'ocean', title: 'Ocean conditions', defaultOpen: false },
  { id: 'charts', title: 'Base charts and depth', defaultOpen: true },
] as const;

const KNOWN = new Set<string>(CATEGORIES.map((c) => c.id));
const TITLE = new Map<string, string>(CATEGORIES.map((c) => [c.id, c.title]));

export const CATEGORY_ORDER = CATEGORIES.map((c) => c.id);
export const CATEGORY_DEFAULT_OPEN: Record<string, boolean> = Object.fromEntries(
  CATEGORIES.map((c) => [c.id, c.defaultOpen]),
);
// The plain category titles keyed by id, so a consumer that already knows a source's category (the
// offline-charts builder) reuses the same vocabulary without rebuilding a LayerListItem.
export const CATEGORY_TITLES: Record<string, string> = Object.fromEntries(
  CATEGORIES.map((c) => [c.id, c.title]),
);

// An overlay's declared category wins; otherwise the band picks a default (charts for the chart and
// depth bands, ocean for the weather band, live for traffic, and the navigator's own data for the
// rest, which catches routes, notes, and the track). An unknown declared category also falls to the
// own-data bucket, so a typo never drops a layer out of the panel.
function resolveId(item: LayerListItem): string {
  if (item.category && KNOWN.has(item.category)) return item.category;
  if (item.band === 'basemap' || item.band === 'bathymetry') return 'charts';
  if (item.band === 'weather') return 'ocean';
  if (item.band === 'traffic') return 'live';
  return 'mine';
}

export function layerCategory(item: LayerListItem): LayerCategory {
  const id = resolveId(item);
  return { id, title: TITLE.get(id) ?? '' };
}

// Clamp a reorder target so a row never leaves its own category bucket: the panel order must keep
// matching the map z-order per category, and a drag or arrow-key move that crossed buckets would
// silently change z-order outside the visible category. `slot` is an insertion index into the
// movable list with the moved row removed (view.reorder's contract); the valid span runs from just
// above the bucket's top row to just below its bottom row. A single-row bucket keeps its own slot.
export function clampReorderSlot(movable: LayerListItem[], id: string, slot: number): number {
  const from = movable.findIndex((item) => item.id === id);
  if (from < 0) return slot;
  const category = resolveId(movable[from]);
  let first = -1;
  let last = -1;
  let i = 0;
  for (const item of movable) {
    if (item.id === id) continue;
    if (resolveId(item) === category) {
      if (first < 0) first = i;
      last = i;
    }
    i++;
  }
  if (first < 0) return from;
  return Math.max(first, Math.min(slot, last + 1));
}
