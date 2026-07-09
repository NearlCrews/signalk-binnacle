<script lang="ts">
import { Menu } from '@lucide/svelte';
import { onDestroy } from 'svelte';
import { AnchoredMenu, CustomizeToggle, isTabKey, UnavailableHint } from '$shared/ui';
import MenuItemIcon from './MenuItemIcon.svelte';
import { blockedReason, itemBlocked, type MenuItem } from './menu-item';

interface Props {
  items?: MenuItem[];
  label?: string;
  // The open state is controlled by the parent, so a panel's "back to menu" action can reopen the
  // menu after it closed on selection. The menu renders the current state and requests transitions.
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // The ids currently pinned to the bottom bar, and the edit-mode state, controlled by the parent.
  pinnedIds?: string[];
  editing?: boolean;
  onEditingChange?: (next: boolean) => void;
  onTogglePin?: (id: string) => void;
}

const {
  items = [],
  label = 'Menu',
  open,
  onOpenChange,
  pinnedIds = [],
  editing = false,
  onEditingChange,
  onTogglePin,
}: Props = $props();

const pinnedSet = $derived(new Set(pinnedIds));

let trigger = $state<HTMLButtonElement>();
let card = $state<HTMLElement>();

// A tap or click on a blocked tile explains itself here instead of silently doing nothing: the
// title tooltip it also carries is mouse-hover-only, so this is the only reason a touch user, or a
// mouse/keyboard user who never hovered first, ever sees. Mirrors App.svelte's arrivalBanner idiom
// (a state plus a reset timer), sized generously since this is unfamiliar explanatory text, not a
// short confirmation.
let blockedNote = $state<string | undefined>();
let blockedNoteTimer: ReturnType<typeof setTimeout> | undefined;
const BLOCKED_NOTE_MS = 8000;
function dismissBlockedNote(): void {
  clearTimeout(blockedNoteTimer);
  blockedNote = undefined;
}
onDestroy(dismissBlockedNote);

// The items split into contiguous groups by their group label, so each renders as a tile section
// with its caps-label header. The launcher stays generic: it renders whatever it is given.
const groups = $derived.by(() => {
  const out: { label: string; items: MenuItem[] }[] = [];
  for (const item of items) {
    const label = item.group ?? '';
    const last = out.at(-1);
    if (last && last.label === label) last.items.push(item);
    else out.push({ label, items: [item] });
  }
  return out;
});

function closeMenu(restoreFocus = false): void {
  if (editing) onEditingChange?.(false);
  onOpenChange(false);
  dismissBlockedNote();
  // Return focus to the trigger when the menu closes by keyboard or selection, so a keyboard
  // user lands back on the control that opened it rather than at the top of the document.
  if (restoreFocus) trigger?.focus();
}

function select(item: MenuItem): void {
  // Pinning is a preference, not an invocation, so edit mode toggles the pin even for an action that
  // is currently disabled (Center before the map loads, a panel gated by a missing plugin). The
  // disabled guard only blocks running the action outside edit mode.
  if (editing) {
    onTogglePin?.(item.id);
    return;
  }
  if (itemBlocked(item)) {
    clearTimeout(blockedNoteTimer);
    blockedNote = blockedReason(item);
    blockedNoteTimer = setTimeout(dismissBlockedNote, BLOCKED_NOTE_MS);
    return;
  }
  item.onSelect();
  closeMenu(true);
}

// On open, move focus to the first enabled tile via a $effect (not inside the transition) so a
// keyboard user lands inside the menu without a DOM query at transition time.
$effect(() => {
  if (open) card?.querySelector<HTMLButtonElement>('.tile:not([disabled])')?.focus();
});

// Arrow keys step through the tiles in reading order, wrapping; Home and End jump to the ends.
// Tab and Shift+Tab close the menu and restore focus to the trigger, since the surface is
// non-modal and a Tab that silently moved into the chart would be a WCAG 2.1.1 failure.
function onCardKeydown(event: KeyboardEvent): void {
  if (isTabKey(event)) {
    event.preventDefault();
    closeMenu(true);
    return;
  }
  const tiles = [...(card?.querySelectorAll<HTMLButtonElement>('.tile:not([disabled])') ?? [])];
  if (tiles.length === 0) return;
  const at = Math.max(0, tiles.indexOf(document.activeElement as HTMLButtonElement));
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
    event.preventDefault();
    tiles[(at + 1) % tiles.length]?.focus();
  } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
    event.preventDefault();
    tiles[(at - 1 + tiles.length) % tiles.length]?.focus();
  } else if (event.key === 'Home') {
    event.preventDefault();
    tiles[0]?.focus();
  } else if (event.key === 'End') {
    event.preventDefault();
    tiles.at(-1)?.focus();
  }
}
</script>

<button
  type="button"
  class="icon-pill"
  class:is-on={open}
  bind:this={trigger}
  aria-haspopup="true"
  aria-expanded={open}
  aria-controls={open ? 'app-menu-launcher' : undefined}
  aria-label={label}
  title={label}
  onclick={() => onOpenChange(!open)}
>
  <Menu size={20} aria-hidden="true" />
</button>
<AnchoredMenu
  {open}
  onClose={() => closeMenu(true)}
  backdropLabel="Close menu"
  surfaceClass="launcher surface-elevated"
  ariaLabel={label}
  id="app-menu-launcher"
  bind:surfaceRef={card}
  onKeydown={onCardKeydown}
>
  {#snippet children()}
    {#if items.length === 0}
      <span class="muted-note">No options</span>
    {:else}
      <div class="menu-head">
        <CustomizeToggle object="toolbar" {editing} onToggle={() => onEditingChange?.(!editing)} />
      </div>
      <!-- Reserved height so the note appearing or clearing never shifts the tile grid under a
           mid-tap thumb; the box holds its size whether or not a message is inside it. -->
      <div class="blocked-note-slot" role="status" aria-live="polite">
        {#if blockedNote}
          <p class="blocked-note muted-note">{blockedNote}</p>
        {/if}
      </div>
      {#if editing}
        <!-- Announce the mode change: in edit mode the tile accent means "pinned to the bar", not
             "panel open", which is invisible to a screen reader without this. -->
        <p class="muted-note">Tap an action to pin or unpin it on the bottom toolbar.</p>
      {/if}
      {#each groups as group, gi (gi)}
        <!-- Every menu item carries a group label, so role="group" always has an accessible name
             here; the static role is required by the linter's valid-role rule. -->
        <section class="group" role="group" aria-label={group.label || undefined}>
          {#if group.label}
            <div class="group-label caps-label" aria-hidden="true">{group.label}</div>
          {/if}
          <div class="tiles">
            {#each group.items as item (item.id)}
              <button
                type="button"
                class="tile"
                class:is-on={editing ? pinnedSet.has(item.id) : item.pressed === true}
                aria-pressed={editing ? pinnedSet.has(item.id) : item.pressed}
                disabled={editing ? false : item.disabled === true}
                aria-disabled={!editing && item.available === false ? true : undefined}
                title={item.available === false ? item.unavailableHint : undefined}
                onclick={() => select(item)}
              >
                <UnavailableHint
                  hint={item.available === false ? item.unavailableHint : undefined}
                />
                <MenuItemIcon {item} size={22} />
                <span class="tile-label">{item.label}</span>
              </button>
            {/each}
          </div>
        </section>
      {/each}
    {/if}
  {/snippet}
</AnchoredMenu>

<style>
/* Position the surface absolute under the hamburger, anchored to the inline-start of
   .topbar-start (which carries position: relative). The surface grows from the top-left corner. */
:global(.launcher) {
  position: absolute;
  inset-block-start: 100%;
  inset-inline-start: 0;
  margin-block-start: var(--space-1);
  z-index: var(--z-menu);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  inline-size: min(22rem, calc(100dvw - 2 * var(--space-2)));
  /* Fill the space below the topbar so the grouped grid fits without a scrollbar on a normal screen;
     the topbar is one --control-size tall, and --space-6 leaves a small margin above and below. A
     short helm display still caps here and scrolls. */
  max-block-size: calc(100dvh - var(--control-size) - var(--space-6));
  overflow-y: auto;
  padding: var(--space-3);
  /* The surface, border, radius, and shadow come from the shared .surface-elevated frame. */
}
@media (max-width: 600px) {
  :global(.launcher) {
    position: fixed;
    inset-block-start: auto;
    inset-block-end: 0;
    inset-inline-start: 0;
    margin-block-start: 0;
    transform-origin: bottom center;
    inline-size: 100dvw;
    max-inline-size: none;
    max-block-size: 80dvh;
    border-inline: 0;
    border-block-end: 0;
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  }
}
/* The customize entry reads as quiet header chrome above the groups: right-aligned ghost, never
   the menu's loudest action. */
.menu-head {
  display: flex;
  justify-content: flex-end;
}
/* Reserves room for two lines of the longest unavailableHint in the app at the panel's own width,
   so mounting or clearing the note never reflows the tile grid below it. */
.blocked-note-slot {
  min-block-size: 2.6rem;
}
.blocked-note {
  padding-inline: var(--space-1);
}
.group {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.group + .group {
  margin-block-start: var(--space-1);
  padding-block-start: var(--space-2);
  border-block-start: 1px solid var(--border);
}
.group-label {
  padding-inline: var(--space-1);
}
/* Fixed 3-column grid so labels like "Layers and charts" and "Anchor watch" are not truncated.
   minmax keeps each tile comfortably past the 44px target in both axes. */
.tiles {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--space-1);
}
.tile {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-1);
  min-block-size: 4.5rem;
  padding: var(--space-2) var(--space-1);
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: var(--text-sm);
  cursor: pointer;
  transition:
    background-color var(--transition-fast),
    color var(--transition-fast),
    border-color var(--transition-fast),
    filter var(--transition-fast);
}
/* Every tile-level svg color rule below excludes the add-on badge (:not(.menu-item-icon__badge)):
   these selectors would otherwise beat MenuItemIcon's own color rule for that badge in some tile
   state, silently recoloring it back to the same muted gray as the icon it exists to stand apart
   from. MenuItemIcon owns the badge's color uncontested in every state instead. */
.tile :global(svg:not(.menu-item-icon__badge)) {
  color: var(--text-muted);
  transition: color var(--transition-fast);
}
.tile:hover:not(:disabled):not([aria-disabled="true"]) {
  background: var(--accent-tint);
}
.tile:hover:not(:disabled):not([aria-disabled="true"]) :global(svg:not(.menu-item-icon__badge)),
.tile:focus-visible:not([aria-disabled="true"]) :global(svg:not(.menu-item-icon__badge)) {
  color: var(--accent);
}
.tile:active:not(:disabled):not([aria-disabled="true"]) {
  filter: brightness(var(--brightness-press));
}
/* Scoped on-state: the global .is-on cannot override .tile because Svelte's hash class raises
   .tile's specificity above the global utility, so the accent color, border, and fill are applied
   here instead. The tile also recolors its svg icon to the accent so the shape cue complements the
   color cue under night-red. */
.tile.is-on {
  color: var(--accent);
  border-color: var(--accent);
  background: var(--accent-tint);
}
.tile.is-on :global(svg:not(.menu-item-icon__badge)) {
  color: var(--accent);
}
/* An unavailable tile (aria-disabled) is grayed like a disabled one, but stays focusable and
   hoverable so its title tooltip shows and a screen reader reaches the reason it is grayed; a real
   disabled button suppresses both. The click is guarded in select(). This mirrors the detect-and-
   degrade layer rows, which also gray and explain rather than vanish. */
.tile:disabled,
.tile[aria-disabled="true"] {
  color: var(--text-muted);
  opacity: var(--disabled-opacity);
  cursor: default;
}
.tile-label {
  text-align: center;
  line-height: 1.2;
  overflow-wrap: anywhere;
}
</style>
