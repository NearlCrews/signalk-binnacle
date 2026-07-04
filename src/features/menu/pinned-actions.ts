import type { MenuItem } from './menu-item';

// The bar's default pinned set: Center, Follow, Charts (the layers action), and Instruments. The single source of
// the default, imported by the composition root for the persisted-value fallback.
export const DEFAULT_PINNED: readonly string[] = ['center', 'follow', 'layers', 'instruments'];

// The pinned actions in canonical (registry) order. Iterating the registry (not the id list) yields a
// stable order regardless of pin sequence and inherently drops an id with no matching action (a
// removed, renamed, or newer-version action synced down). A non-array input (a corrupt or
// hand-edited stored document, which never passes through the import validator) resolves to empty, so
// this never throws.
export function resolvePinned(items: MenuItem[], pinnedIds: unknown): MenuItem[] {
  const list = Array.isArray(pinnedIds) ? pinnedIds : [];
  const ids = new Set(list.filter((x): x is string => typeof x === 'string'));
  return items.filter((item) => ids.has(item.id));
}

// The most pills the bottom bar shows before collapsing the rest into a "More" popover. When the
// pinned set exceeds this, one slot is reserved for the More pill itself.
export const MAX_BAR_PILLS = 6;

export function splitBarActions(
  actions: MenuItem[],
  max: number,
): { visible: MenuItem[]; overflow: MenuItem[] } {
  if (actions.length <= max) return { visible: [...actions], overflow: [] };
  return { visible: actions.slice(0, max - 1), overflow: actions.slice(max - 1) };
}

// Add an id when absent, remove it when present, returning a fresh array. The stored order is not the
// bar order (resolvePinned re-imposes canonical order), so appending is fine.
export function togglePinned(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
}
