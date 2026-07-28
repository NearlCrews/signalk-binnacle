import type { LucideIcon } from '@lucide/svelte';

// One entry in the app menu. The menu is generic: it renders whatever items it is given,
// so a new option is one more MenuItem in the list, never a change to the menu itself.
export interface MenuItem {
  id: string;
  label: string;
  // The compact label a bottom-bar pill renders when set, so a pill stays short ("Charts") while the
  // full descriptive label is kept elsewhere. The menu tiles and the bar's "More" overflow render
  // the full `label`; only the bar's visible pills render `shortLabel ?? label`.
  shortLabel?: string;
  // The tooltip a bottom-bar pill shows while the action is disabled, when the reason differs from the
  // label (for example "Layers and charts (chart is loading)"). Falls back to the label when unset.
  disabledLabel?: string;
  // Optional leading icon (a lucide-svelte component).
  icon?: LucideIcon;
  disabled?: boolean;
  // A capability whose provider is absent. When false, the launcher and bar render the item grayed and
  // action-blocked with `unavailableHint` as a hover tooltip and screen-reader text, mirroring the
  // layers panel's detect-and-degrade rows, rather than dropping it from the menu. Distinct from
  // `disabled`, which is a transient block (a chart still loading); an absent provider is the steady
  // state until a plugin is installed. Defaults to available when unset.
  available?: boolean;
  // The reason an unavailable item is grayed, shown on hover and to a screen reader (for example
  // "No radar detected. Install a Signal K radar provider plugin..."). Pairs with `available: false`.
  unavailableHint?: string;
  // For a toggle surface (Measure armed, Forecast open), the current on state. When set, the
  // launcher renders the tile with aria-pressed and the accent on-state; when undefined, the item
  // is a plain action and carries no pressed semantics.
  pressed?: boolean;
  // Optional section heading. Consecutive items sharing a group render under one caps-label header,
  // so the menu groups itself from data without the menu component knowing the sections.
  group?: string;
  // How many things are live behind this item right now (active alarms, for example), as a whole
  // number. Rendered as a count chip on the tile, the bar pill, and the overflow row, so a closed
  // panel still shows that it has something waiting. Absent or zero renders nothing.
  count?: number;
  onSelect: () => void;
}

// True when an item cannot be invoked: a transient block (`disabled`, e.g. a chart still loading) or a
// capability whose provider is absent (`available === false`). One predicate so the tile, the bar pill,
// and the overflow row gate interaction identically.
export function itemBlocked(item: MenuItem): boolean {
  return item.disabled === true || item.available === false;
}

// The chip text for an item's live count, or undefined when there is nothing to show. Caps at "99+"
// so a runaway count cannot widen a bar pill past its neighbors; the spoken suffix beside the chip
// carries the true number, which has no width to protect.
export function countBadge(item: MenuItem): string | undefined {
  const count = item.count;
  if (count === undefined || Number.isNaN(count) || count < 1) return undefined;
  return count > 99 ? '99+' : String(count);
}

// The reason a blocked item is grayed, for its hover tooltip and screen-reader text: the provider-absent
// hint wins, then the transient disabled reason. undefined when the item is interactive or carries no
// reason; a caller that always wants a tooltip (the bar pills) falls back to the label.
export function blockedReason(item: MenuItem): string | undefined {
  if (item.available === false) return item.unavailableHint;
  if (item.disabled) return item.disabledLabel;
  return undefined;
}
