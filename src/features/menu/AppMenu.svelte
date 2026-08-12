<script lang="ts">
import Menu from '@lucide/svelte/icons/menu';
import { onDestroy } from 'svelte';
import { Toast } from '$shared/lib';
import {
  AnchoredMenu,
  CustomizeToggle,
  menuFocusLeft,
  nextRovingIndex,
  type RovingKey,
  TransientNote,
  UnavailableHint,
} from '$shared/ui';
import MenuItemCount from './MenuItemCount.svelte';
import MenuItemIcon from './MenuItemIcon.svelte';
import { blockedReason, itemBlocked, type MenuItem } from './menu-item';
import { resolvePinned } from './pinned-actions';
import ToolbarEditor from './ToolbarEditor.svelte';

interface Props {
  items?: MenuItem[];
  label?: string;
  // Whether to render the topbar trigger. False once the Menu action is pinned to the bottom bar,
  // so exactly one control named Menu exists at a time and the sheet still renders here.
  showTrigger?: boolean;
  // The open state is controlled by the parent, so a panel's "back to menu" action can reopen the
  // menu after it closed on selection. The menu renders the current state and requests transitions.
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // The ids currently pinned to the bottom bar, and the edit-mode state, controlled by the parent.
  pinnedIds?: string[];
  editing?: boolean;
  onEditingChange?: (next: boolean) => void;
  onTogglePin?: (id: string) => void;
  onReorderPinned?: (id: string, slot: number) => void;
  onResetPinned?: () => void;
}

const {
  items = [],
  label = 'Menu',
  showTrigger = true,
  open,
  onOpenChange,
  pinnedIds = [],
  editing = false,
  onEditingChange,
  onTogglePin,
  onReorderPinned,
  onResetPinned,
}: Props = $props();

const pinnedSet = $derived(new Set(pinnedIds));
const pinnedItems = $derived(resolvePinned(items, pinnedIds));

let trigger = $state<HTMLButtonElement>();
let card = $state<HTMLElement>();

// A tap or click on a blocked tile explains itself via Toast's timed-message primitive instead of
// silently doing nothing, since the title tooltip it also carries is mouse-hover-only. Sized
// generously (Toast's 8s default) since this is unfamiliar explanatory text, not a short
// confirmation.
const blockedNote = new Toast();
onDestroy(() => blockedNote.dispose());

// The items split into contiguous groups by their group label, so each renders as a tile section
// with its caps-label header. The launcher stays generic: it renders whatever it is given.
const groups = $derived.by(() => {
  const out: { label: string; items: MenuItem[] }[] = [];
  for (const item of items) {
    // A bar-only action (the Menu opener) is not a launcher tile: it would sit inside the menu it
    // opens. It still appears while customizing, because tapping a tile is the only pin control.
    if (item.barOnly && !editing) continue;
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
  blockedNote.clear();
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
    blockedNote.show(blockedReason(item) ?? item.label);
    return;
  }
  // A tactile confirmation for a tap on a bouncing boat with wet or gloved hands, where the
  // brightness-press CSS feedback can be hard to see; a no-op where the device lacks vibration.
  if ('vibrate' in navigator) navigator.vibrate(10);
  item.onSelect();
  closeMenu(true);
}

// On open, move focus to the first actionable tile via a $effect (not inside the transition) so a
// keyboard user lands inside the menu without a DOM query at transition time.
$effect(() => {
  if (open)
    card?.querySelector<HTMLButtonElement>('.menu-tile:not([aria-disabled="true"])')?.focus();
});

// The tiles wrap into a grid, so both axes step through them in reading order: right and down go
// forward, left and up go back. Mapped onto the shared 1D roving math rather than re-deriving the
// wraparound, which is what let this copy skip the first tile when focus was on the card itself.
const MENU_ROVING_KEYS: Partial<Record<string, RovingKey>> = {
  ArrowRight: 'ArrowDown',
  ArrowDown: 'ArrowDown',
  ArrowLeft: 'ArrowUp',
  ArrowUp: 'ArrowUp',
  Home: 'Home',
  End: 'End',
};

function onCardKeydown(event: KeyboardEvent): void {
  const key = MENU_ROVING_KEYS[event.key];
  if (key === undefined) return;
  // Keep blocked tiles in arrow navigation. They remain focusable so keyboard users can invoke them
  // and receive the same visible explanation as pointer users.
  const tiles = [...(card?.querySelectorAll<HTMLButtonElement>('.menu-tile') ?? [])];
  if (tiles.length === 0) return;
  event.preventDefault();
  const at = tiles.indexOf(document.activeElement as HTMLButtonElement);
  tiles[nextRovingIndex(key, at, tiles.length)]?.focus();
}

function onCardFocusOut(event: FocusEvent): void {
  const next = event.relatedTarget;
  if (next === trigger) return;
  // The shared focus-left test ignores a transient loss to the body (relatedTarget null), which is
  // what an in-place content swap fires when it unmounts the focused control: arming the toolbar
  // Reset confirm replaces its trigger and must not close the whole menu.
  if (!menuFocusLeft(next, card)) return;
  closeMenu(false);
}
</script>

{#if showTrigger}
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
{/if}
<AnchoredMenu
  {open}
  onClose={() => closeMenu(true)}
  backdropLabel="Close menu"
  surfaceClass={editing ? 'launcher surface-elevated editing' : 'launcher surface-elevated'}
  ariaLabel={label}
  id="app-menu-launcher"
  bind:surfaceRef={card}
  onKeydown={onCardKeydown}
  onFocusOut={onCardFocusOut}
>
  {#if items.length === 0}
    <span class="muted-note">No options</span>
  {:else}
    <TransientNote message={blockedNote.message} noteClass="blocked-note-slot" />
    <div class="launcher-scroll">
      <div class="menu-head">
        <CustomizeToggle object="toolbar" {editing} onToggle={() => onEditingChange?.(!editing)} />
      </div>
      {#if editing}
        <!-- Announce the mode change: in edit mode the tile accent means "pinned to the bar", not
             "panel open", which is invisible to a screen reader without this. -->
        <p class="muted-note">Tap an action to pin or unpin it on the bottom toolbar.</p>
        <ToolbarEditor items={pinnedItems} onReorder={onReorderPinned} onReset={onResetPinned} />
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
                class="menu-tile"
                class:is-on={editing ? pinnedSet.has(item.id) : item.pressed === true}
                aria-pressed={editing ? pinnedSet.has(item.id) : item.pressed}
                aria-disabled={!editing && itemBlocked(item) ? true : undefined}
                title={!editing ? blockedReason(item) : undefined}
                onclick={() => select(item)}
              >
                <UnavailableHint
                  hint={item.available === false ? item.unavailableHint : undefined}
                />
                <MenuItemIcon {item} size={28} />
                <span class="tile-label">{item.label}</span>
                {#if item.sublabel}
                  <span class="tile-sublabel">{item.sublabel}</span>
                {/if}
                <MenuItemCount {item} />
              </button>
            {/each}
          </div>
        </section>
      {/each}
    </div>
  {/if}
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
  max-block-size: calc(100 * var(--dvh) - var(--control-size) - var(--space-6));
  padding: var(--space-3);
  /* The surface, border, radius, and shadow come from the shared .surface-elevated frame. */
}
/* The scroll region is an inner wrapper rather than the surface itself, so the blocked-note toast
   can anchor absolutely to the surface: it stays over the visible window at any scroll position
   while contributing no layout height, so blocked feedback never shifts the groups. */
:global(.launcher) .launcher-scroll {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-block-size: 0;
  overflow-y: auto;
  /* Scroll-edge shadows (the local-attachment technique): a soft cue that a tile row continues
     past the cap, gone when the edge is reached because the surface-colored cover scrolls over
     it. Effectively invisible at night-red on the near-black surface, where the heavier group
     rules carry the structure instead. */
  background:
    linear-gradient(var(--surface) 30%, transparent),
    linear-gradient(transparent, var(--surface) 70%) 0 100%,
    radial-gradient(farthest-side at 50% 0, rgb(0 0 0 / 0.18), transparent),
    radial-gradient(farthest-side at 50% 100%, rgb(0 0 0 / 0.18), transparent) 0 100%;
  background-color: var(--surface);
  background-repeat: no-repeat;
  background-size:
    100% 40px,
    100% 40px,
    100% 12px,
    100% 12px;
  background-attachment: local, local, scroll, scroll;
}
/* Matches the StatusStrip's own 900px stack breakpoint, so a landscape tablet never lands in the
   gap where the menu is still a corner dropdown but the status strip below it has already
   stacked to a single column. */
@media (max-width: 900px) {
  :global(.launcher) {
    position: fixed;
    inset-block-start: auto;
    inset-block-end: 0;
    inset-inline-start: 0;
    margin-block-start: 0;
    transform-origin: bottom center;
    inline-size: 100dvw;
    max-inline-size: none;
    max-block-size: calc(80 * var(--dvh));
    padding-block-end: calc(var(--space-3) + var(--system-bar-clearance));
    padding-inline-start: calc(var(--space-3) + env(safe-area-inset-left, 0px));
    padding-inline-end: calc(var(--space-3) + env(safe-area-inset-right, 0px));
    border-inline: 0;
    border-block-end: 0;
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  }
  /* A grab-handle affordance, the standard mobile cue that this surface is a dismissible sheet
     rather than a fixed panel; purely decorative, so aria-hidden via ::before's default absence
     from the accessibility tree. */
  :global(.launcher)::before {
    content: "";
    display: block;
    inline-size: 2.5rem;
    block-size: 0.25rem;
    border-radius: var(--radius-pill);
    background: var(--text-muted);
    margin: 0 auto var(--space-2);
    opacity: 0.5;
  }
}
/* Edit mode is a distinct interaction (tapping a tile pins or unpins it rather than opening it),
   so the whole surface carries a visible mode cue, not just the CustomizeToggle button and the
   muted-note text below: a navigator who taps the menu open mid-edit-mode should see the mode
   before tapping a tile in it. Static, not animated, so it reads at a glance without adding motion
   at the helm. */
/* Just the inset ring, not combined with --shadow-lg: night-red sets --shadow-lg to the literal
   keyword none, and none is not a valid entry inside a comma-separated box-shadow list, so
   appending it here would make the whole declaration invalid at computed-value time and drop the
   ring in exactly the theme where a clear mode cue matters most. */
:global(.launcher.editing) {
  border-color: var(--accent);
  box-shadow: inset 0 0 0 1px var(--accent);
}
/* The customize entry reads as quiet header chrome above the groups: right-aligned ghost, never
   the menu's loudest action. */
.menu-head {
  display: flex;
  justify-content: flex-end;
}
/* Sticky, not absolute: .launcher is both the containing block and the scroll container, so an
   absolutely positioned note scrolls away with the tiles and a navigator who has scrolled down the
   phone sheet never sees the explanation for the tile they just tapped. In flow and sticky, it
   stays at the top of the scrollport for as long as it is shown. */
:global(.blocked-note-slot) {
  inset-block-start: var(--space-3);
  max-inline-size: min(18rem, calc(100% - 2 * var(--space-3)));
}
/* Groups render in the order of the items the launcher is given, at every viewport. Do not add a
   width-conditional `order` here: the phone-only reorder this replaces gave a navigator two mental
   models of the same chartplotter. */
.group {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
/* The caps group heading alone carries the section break by day and dusk; a hairline on top of it
   double-codes the same boundary, so the day rule keeps only the rhythm spacing. */
.group + .group {
  margin-block-start: var(--space-1);
  padding-block-start: var(--space-2);
}
/* At night the dimmed caps heading is not enough of a break on its own, so night-red keeps a
   heavier rule: groups stay visually distinct without introducing a brighter color at night. */
:root[data-theme="night-red"] .group + .group {
  border-block-start: 2px solid var(--border);
}
.group-label {
  padding-inline: var(--space-1);
}
/* auto-fit collapses to as many columns as the group has items (a 1-item group gets one
   full-width tile, a 2-item group gets two half-width tiles) rather than always reserving 3
   columns and leaving dead cells; the 6.5rem floor settles a large group at 3 per row on a 390px
   phone sheet with enough width that "Nearby vessels (AIS)" fits its two clamped lines instead of
   ellipsizing the qualifier. */
.tiles {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(6.5rem, 1fr));
  gap: var(--space-1);
}
.menu-tile {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-1);
  min-block-size: 5rem;
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
.menu-tile :global(svg:not(.menu-item-icon__badge)) {
  color: var(--text-muted);
  transition: color var(--transition-fast);
}
.menu-tile:hover:not(:disabled):not([aria-disabled="true"]) {
  background: var(--accent-tint);
}
.menu-tile:hover:not(:disabled):not([aria-disabled="true"])
  :global(svg:not(.menu-item-icon__badge)),
.menu-tile:focus-visible:not([aria-disabled="true"]) :global(svg:not(.menu-item-icon__badge)) {
  color: var(--accent);
}
.menu-tile:active:not(:disabled):not([aria-disabled="true"]) {
  filter: brightness(var(--brightness-press));
}
/* Scoped on-state: the global .is-on cannot override .menu-tile because Svelte's hash class raises
   .menu-tile's specificity above the global utility, so the accent color, border, and fill are applied
   here instead. The tile also recolors its svg icon to the accent so the shape cue complements the
   color cue under night-red. */
.menu-tile.is-on {
  color: var(--accent);
  border-color: var(--accent);
  background: var(--accent-tint);
}
.menu-tile.is-on :global(svg:not(.menu-item-icon__badge)) {
  color: var(--accent);
}
/* An unavailable tile (aria-disabled) is grayed like a disabled one, but stays focusable and
   hoverable so its title tooltip shows and a screen reader reaches the reason it is grayed; a real
   disabled button suppresses both. The click is guarded in select(). This mirrors the detect-and-
   degrade layer rows, which also gray and explain rather than vanish. */
.menu-tile:disabled,
.menu-tile[aria-disabled="true"] {
  color: var(--text-muted);
  opacity: var(--disabled-opacity);
  cursor: default;
}
/* Capped at 2 lines so tiles within a group stay a uniform height even when one label ("Nearby
   vessels (AIS)") wraps further than its neighbors; the full label remains in the DOM for a screen
   reader, only the visual box is clipped. */
.tile-label {
  text-align: center;
  line-height: 1.2;
  overflow-wrap: anywhere;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  line-clamp: 2;
  overflow: hidden;
}
/* The quiet state line under a tile label (the Orientation tile's current mode): one line,
   muted, so the label keeps one voice across the grid while the state stays visible. */
.tile-sublabel {
  color: var(--text-muted);
  font-size: var(--text-xs);
  line-height: 1.2;
  text-align: center;
}
</style>
