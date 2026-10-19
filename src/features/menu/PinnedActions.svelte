<script lang="ts">
import Ellipsis from '@lucide/svelte/icons/ellipsis';
import { onDestroy, onMount } from 'svelte';
import {
  createMediaQuery,
  LANDSCAPE_SHORT_QUERY,
  NARROW_QUERY,
  rootFontPx,
  Toast,
} from '$shared/lib';
import {
  AnchoredMenu,
  createMenuFocusMachine,
  initializeMenuFocus,
  TransientNote,
  UnavailableHint,
} from '$shared/ui';
import MenuItemCount from './MenuItemCount.svelte';
import MenuItemIcon from './MenuItemIcon.svelte';
import { blockedReason, itemBlocked, type MenuItem } from './menu-item';
import {
  barCapacity,
  MAX_BAR_PILLS,
  MAX_COMPACT_BAR_PILLS,
  splitBarActions,
} from './pinned-actions';

interface Props {
  actions: MenuItem[];
  // A safety alarm is taking the screen: the More menu closes rather than cover its card.
  emergency?: boolean;
}

const { actions, emergency = false }: Props = $props();
const compactPhone = createMediaQuery(NARROW_QUERY);
// A phone held sideways keeps the strip on one row, so the tiles go icon-only there: the label
// collapses to visually-hidden, keeping the accessible name and the 44px target.
const landscapeShort = createMediaQuery(LANDSCAPE_SHORT_QUERY);
// The narrowest tile that still holds an icon over a one-word label; below it the tiles go
// icon-only, so every pinned action stays one tap away on the narrowest phones.
const LABELED_TILE_REM = 5.25;
let moreOpen = $state(false);
let moreTrigger = $state<HTMLButtonElement>();
let moreSurface = $state<HTMLElement>();
let bar = $state<HTMLElement>();
let measuredCapacity = $state<number>();
let barWidth = $state<number>();
let barGap = $state(0);
let rootSize = $state(16);
let largeText = $state(false);

// The shared toolbar-menu focus machine: roving keydown, the Tab redirect, and the open-focus and
// close-focus protocol live in $shared/ui menu-focus, identical to OverflowActions. Initial focus
// follows the placement callback so the surface is visible before a menu item receives focus.
const machine = createMenuFocusMachine({
  surface: () => moreSurface,
  trigger: () => moreTrigger,
  requestClose: () => {
    moreOpen = false;
  },
  focusFrames: 0,
  includeAriaDisabled: true,
});
const responsiveMaximum = $derived(compactPhone.matches ? MAX_COMPACT_BAR_PILLS : MAX_BAR_PILLS);
// Sideways the bar is sized to its own pills, so a width measured from it would only confirm the
// pills already shown; the icon-only pills fit the responsive maximum there at any text size,
// because a screen that short pins controls to 44px.
const capacity = $derived(
  landscapeShort.matches
    ? responsiveMaximum
    : Math.min(responsiveMaximum, measuredCapacity ?? responsiveMaximum),
);
const split = $derived(splitBarActions(actions, capacity));
const slots = $derived(Math.max(1, Math.min(actions.length, capacity)));
const narrowTiles = $derived(
  barWidth !== undefined && (barWidth - barGap * (slots - 1)) / slots < LABELED_TILE_REM * rootSize,
);
const iconOnly = $derived(landscapeShort.matches || largeText || narrowTiles);
const moreActive = $derived(split.overflow.some((action) => action.pressed === true));
const blockedNote = new Toast();
const NOTE_MS = 5_000;

onDestroy(() => blockedNote.dispose());

onMount(() => {
  const element = bar;
  if (!element) return;
  const measure = () => {
    // Sideways the capacity ignores the measurement; rotating back resizes the root and re-measures.
    if (landscapeShort.matches) return;
    const barStyle = getComputedStyle(element);
    rootSize = rootFontPx();
    // Computed control dimensions resolve inherited px, rem, and calc() tokens alike.
    const control = element.querySelector<HTMLElement>('.bar-tile');
    const controlSize = control ? Number.parseFloat(getComputedStyle(control).minBlockSize) : 0;
    const gap = Number.parseFloat(barStyle.columnGap) || 0;
    barGap = gap;
    largeText = rootSize >= 24;
    barWidth = element.clientWidth;
    // The status strip's helm row grants the bar a fixed number of its columns.
    const granted = Number.parseInt(barStyle.getPropertyValue('--bar-capacity'), 10);
    measuredCapacity =
      granted > 0
        ? Math.min(granted, responsiveMaximum)
        : barCapacity(element.clientWidth, controlSize, gap, responsiveMaximum);
  };
  let frame: number | undefined;
  const scheduleMeasure = () => {
    if (frame !== undefined) return;
    frame = requestAnimationFrame(() => {
      frame = undefined;
      measure();
    });
  };
  const observer = new ResizeObserver(scheduleMeasure);
  observer.observe(element);
  observer.observe(document.documentElement);
  measure();
  return () => {
    observer.disconnect();
    if (frame !== undefined) cancelAnimationFrame(frame);
  };
});

function run(action: MenuItem, after?: () => void): void {
  if (itemBlocked(action)) {
    blockedNote.show(blockedReason(action) ?? action.label, NOTE_MS);
    return;
  }
  try {
    action.onSelect();
  } finally {
    after?.();
  }
}

$effect(() => machine.syncOpen(moreOpen));
$effect(() => {
  if (emergency) moreOpen = false;
});
</script>

<div class="pinned-actions strip-center" class:icon-only-bar={iconOnly} bind:this={bar}>
  {#if !moreOpen}
    <!-- Sideways the bar sits flush at the trailing edge, where a centered note would shrink into half
         its width, so the note anchors to the bar's end. -->
    <TransientNote
      message={blockedNote.message}
      noteClass={landscapeShort.matches
        ? 'blocked-pill-note transient-note--end'
        : 'blocked-pill-note'}
    />
  {/if}
  {#each split.visible as action (action.id)}
    <button
      type="button"
      class="btn bar-tile"
      class:icon-only={iconOnly}
      class:is-on={action.pressed === true}
      aria-pressed={action.pressed === undefined ? undefined : action.pressed}
      aria-disabled={itemBlocked(action) ? true : undefined}
      title={blockedReason(action) ?? action.label}
      onclick={() => run(action)}
    >
      <UnavailableHint hint={action.available === false ? action.unavailableHint : undefined} />
      <MenuItemIcon item={action} size={18} />
      <span class="tile-label data-baseline">
        <span class="truncate" class:visually-hidden={iconOnly}
          >{action.shortLabel ?? action.label}</span
        >
        <MenuItemCount item={action} hideBadge={iconOnly} />
      </span>
    </button>
  {/each}
  {#if split.overflow.length > 0}
    <div class="more-wrap" data-menu-opener-group>
      <button
        type="button"
        class="btn bar-tile"
        class:icon-only={iconOnly}
        bind:this={moreTrigger}
        data-menu-opener
        class:is-on={moreActive || moreOpen}
        aria-haspopup="menu"
        aria-expanded={moreOpen}
        aria-controls={moreOpen ? 'bar-more-menu' : undefined}
        aria-label={`More actions (${split.overflow.length})`}
        title="More actions"
        onclick={() => (moreOpen = !moreOpen)}
      >
        <span class="tile-icon"><Ellipsis size={18} aria-hidden="true" /></span>
        <span class="tile-label data-baseline">
          <span class:visually-hidden={iconOnly}>More</span>
          {#if split.overflow.length > 1 && !iconOnly}
            <span class="pill-count" aria-hidden="true">{split.overflow.length}</span>
          {/if}
        </span>
      </button>
      <AnchoredMenu
        open={moreOpen}
        onClose={() => machine.close()}
        backdropLabel="Close more actions"
        surfaceClass="popover-card menu-surface bar-more"
        ariaLabel="More actions"
        role="menu"
        id="bar-more-menu"
        anchor={moreTrigger}
        preferredPlacement="above"
        anchorAlign="end"
        bind:surfaceRef={moreSurface}
        onPositioned={() => initializeMenuFocus(moreSurface, true)}
        onKeydown={machine.handleKeydown}
        onFocusLeft={() => machine.close()}
      >
        {#each split.overflow as action (action.id)}
          <!-- biome-ignore lint/a11y/useAriaPropsSupportedByRole: the dynamic role is menuitemcheckbox exactly when aria-checked is defined. -->
          <button
            type="button"
            role={action.pressed === undefined ? 'menuitem' : 'menuitemcheckbox'}
            class="menu-item"
            class:is-on={action.pressed === true}
            aria-checked={action.pressed}
            aria-disabled={itemBlocked(action) ? true : undefined}
            title={blockedReason(action) ?? action.label}
            onclick={() => run(action, machine.close)}
          >
            <UnavailableHint
              hint={action.available === false ? action.unavailableHint : undefined}
            />
            <MenuItemIcon item={action} size={16} />
            {action.label}
            <MenuItemCount item={action} />
          </button>
        {/each}
        <p class="muted-note blocked-more-note" role="status">{blockedNote.message ?? ''}</p>
      </AnchoredMenu>
    </div>
  {/if}
</div>

<style>
/* The bar's actions are equal tiles, an icon over a one-line label, centered as a pair. Tiles share
   the bar equally, up to one bar column each. A host that sets the tiles on one row with readouts
   (the status strip's helm row) opts into the readouts' two line heights and value baseline through
   the --bar-tile-* variables, and grants --bar-capacity with the column, gap, and inset. A host
   short of height may set --bar-tile-size to hold an icon tile at the physical target floor, since
   its icon does not grow with the text. */
.pinned-actions {
  position: relative;
  /* Fill the host's column whatever the host's own alignment, so capacity is measured against the
     room the bar has, never against tiles that shrink again as one moves into More. */
  justify-self: stretch;
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: var(--bar-tile-column, minmax(0, var(--data-cell-min)));
  justify-content: var(--bar-tile-justify, center);
  column-gap: var(--bar-tile-gap, var(--space-2));
  min-inline-size: 0;
}
.bar-tile {
  display: grid;
  grid-template-rows: var(--bar-tile-rows, auto auto);
  align-content: center;
  justify-items: center;
  gap: var(--bar-tile-row-gap, var(--space-1)) 0;
  min-inline-size: 0;
  margin-inline: var(--bar-tile-inset, 0);
  padding: 0 0.2rem;
  font-size: var(--text-xs);
  font-weight: 600;
}
.tile-icon {
  display: inline-flex;
}
.tile-label {
  max-inline-size: 100%;
  line-height: var(--bar-tile-label-line, 1);
}
/* The numeral strut only earns its place on a row shared with readouts; alone it leaves the large
   font's descent empty under a small label and lifts the pair off center. */
.tile-label::before {
  display: var(--bar-tile-strut, none);
}
.tile-label > .truncate {
  min-inline-size: 0;
}
.bar-tile.icon-only {
  display: flex;
  inline-size: var(--bar-tile-size, var(--control-size));
  min-inline-size: var(--bar-tile-size, var(--control-size));
  min-block-size: var(--bar-tile-size, var(--control-size));
  padding: 0;
}
.pinned-actions.icon-only-bar {
  grid-auto-columns: max-content;
}
.bar-tile[aria-disabled="true"],
.menu-item[aria-disabled="true"] {
  opacity: var(--disabled-opacity);
  cursor: default;
}
@media (hover: hover) and (pointer: fine) {
  .bar-tile[aria-disabled="true"]:hover {
    border-color: var(--border);
    background: var(--surface-raised);
  }
  .menu-item[aria-disabled="true"]:hover {
    background: transparent;
  }
}
.more-wrap {
  position: relative;
  display: grid;
}
.blocked-more-note {
  margin: 0;
  white-space: normal;
}
.blocked-more-note:empty {
  display: none;
}
:global(.blocked-pill-note) {
  inset-block-end: calc(100% + var(--space-1));
  max-inline-size: 16rem;
  font-size: var(--text-sm);
}
:global(.bar-more) {
  --menu-width: 12rem;
  transform-origin: right var(--anchored-origin-y, bottom);
  gap: var(--space-1);
  /* Above the bar it opens from, never over it: the room between the top inset and the bar. */
  max-block-size: calc(var(--room-above-bar) - 1rem);
  overflow-y: auto;
}
/* One strip row on a phone held sideways: the icon tiles sit at the trailing edge at their own
   width instead of sharing out the strip. */
@media (orientation: landscape) and (max-height: 500px) and (max-width: 1000px) {
  .pinned-actions {
    margin-inline-start: auto;
    grid-auto-columns: max-content;
  }
}
</style>
