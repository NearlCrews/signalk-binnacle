import type { MenuItem } from './menu-item';

// The bar's default pinned set: the Menu opener, Center, Follow, and AIS. The single source of the
// default, imported by the composition root for the persisted-value fallback. Menu leads because
// the topbar hamburger is a cross-screen reach on a phone, where every unpinned journey starts;
// AIS holds the fourth slot so one Safety action is thumb-reachable out of the box, carrying its
// live collision-risk count. Charts and Instruments stay one tap away inside the menu.
export const DEFAULT_PINNED: readonly string[] = ['menu', 'center', 'follow', 'ais'];

// The pinned actions in stored order, so toolbar customization controls both membership and position.
// Unknown ids are skipped for forward and backward compatibility, and duplicates render once.
export function resolvePinned(items: MenuItem[], pinnedIds: unknown): MenuItem[] {
  const list = Array.isArray(pinnedIds) ? pinnedIds : [];
  const byId = new Map(items.map((item) => [item.id, item]));
  const seen = new Set<string>();
  const out: MenuItem[] = [];
  for (const id of list) {
    if (typeof id !== 'string' || seen.has(id)) continue;
    const item = byId.get(id);
    if (!item) continue;
    seen.add(id);
    out.push(item);
  }
  return out;
}

// The most pills the bottom bar shows before collapsing the rest into a "More" popover. When the
// pinned set exceeds this, one slot is reserved for the More pill itself.
export const MAX_BAR_PILLS = 6;

// The same cap on a phone-width bar. It matches DEFAULT_PINNED's length on purpose: at a lower cap
// the reserved More slot pushes all but the first default action two taps away on the form factor
// most likely to be at a helm.
export const MAX_COMPACT_BAR_PILLS = 4;

// How many control-size pills fit in a measured toolbar. The toolbar uses this in addition to the
// responsive caps because browser zoom and a larger root font can turn a CSS-pixel-wide phone into
// a much narrower control grid without changing the media-query width.
export function barCapacity(
  available: number,
  controlSize: number,
  gap: number,
  maximum: number,
): number {
  if (
    !Number.isFinite(available) ||
    !Number.isFinite(controlSize) ||
    !Number.isFinite(gap) ||
    available <= 0 ||
    controlSize <= 0 ||
    maximum <= 0
  ) {
    return Math.max(1, maximum);
  }
  return Math.max(1, Math.min(maximum, Math.floor((available + gap) / (controlSize + gap))));
}

export function splitBarActions(
  actions: MenuItem[],
  max: number,
): { visible: MenuItem[]; overflow: MenuItem[] } {
  if (actions.length <= max) return { visible: [...actions], overflow: [] };
  return { visible: actions.slice(0, max - 1), overflow: actions.slice(max - 1) };
}

// Add an id when absent, remove it when present, returning a fresh array.
export function togglePinned(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
}

// Move one pinned id to an insertion slot, preserving the rest of the stored toolbar order.
export function reorderPinned(ids: string[], id: string, slot: number): string[] {
  const from = ids.indexOf(id);
  if (from < 0) return ids;
  const next = ids.filter((x) => x !== id);
  const bounded = Math.max(0, Math.min(slot, next.length));
  next.splice(bounded, 0, id);
  return next;
}
