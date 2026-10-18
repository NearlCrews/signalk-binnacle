import { type PersistedCodec, stringArrayPersistedCodec } from '$shared/settings';
import type { MenuItem } from './menu-item';

// The bar's default pinned set: Center, Follow, Charts, and AIS. The single source of the default,
// imported by the composition root for the persisted-value fallback. The menu itself is always the
// bar's leading end, so it is never a pin; AIS holds the fourth slot so one Safety action is
// thumb-reachable out of the box, carrying its live collision-risk count.
export const DEFAULT_PINNED: readonly string[] = ['center', 'follow', 'layers', 'ais'];

// Ids that were once pinnable and no longer are: the menu opener, now the bar's own end.
const RETIRED_PINNED_IDS: ReadonlySet<string> = new Set(['menu']);

export function cleanPinned(ids: readonly string[]): string[] {
  return ids.filter((id) => !RETIRED_PINNED_IDS.has(id));
}

// The persisted pin list: bounded strings, with a retired id dropped on read (rewritten once in the
// current shape) and on write, so a stored or profile-applied list never carries one forward.
export function pinnedIdsCodec(): PersistedCodec<string[]> {
  const strings = stringArrayPersistedCodec({ maxItems: 64, maxLength: 128 });
  return {
    decode(value) {
      const result = strings.decode(value);
      if (result.state === 'invalid') return result;
      const cleaned = cleanPinned(result.value);
      return cleaned.length === result.value.length
        ? result
        : { state: 'migrated', value: cleaned };
    },
    encode: (ids) => cleanPinned(ids),
  };
}

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

// Move one shown pin to a slot counted on the bar as shown, rewriting the stored list in place: an
// id the bar cannot show (from a newer version's profile) keeps its stored position and never
// shifts the slots a reorder counts.
export function reorderShownPinned(
  stored: readonly string[],
  shown: readonly string[],
  id: string,
  slot: number,
): string[] {
  const next = reorderPinned([...shown], id, slot);
  const visible = new Set(shown);
  const unique = stored.filter((x, index) => stored.indexOf(x) === index);
  let at = 0;
  return unique.map((x) => (visible.has(x) ? (next[at++] ?? x) : x));
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
