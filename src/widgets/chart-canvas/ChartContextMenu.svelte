<script lang="ts">
import MapPin from '@lucide/svelte/icons/map-pin';
import Navigation from '@lucide/svelte/icons/navigation';
import NotebookPen from '@lucide/svelte/icons/notebook-pen';
import Route from '@lucide/svelte/icons/route';
import Ruler from '@lucide/svelte/icons/ruler';
import { AnchoredMenu, InlineConfirm, rovingFocus } from '$shared/ui';

interface Props {
  // The press point in chart pixels, and the chart's pixel size, so the menu clamps inside the
  // visible area instead of overflowing an edge.
  x: number;
  y: number;
  width: number;
  height: number;
  onGoToHere: () => void;
  // Opens the routes panel and starts a new route in drawing mode, so the navigator can build a route
  // straight from the chart instead of going to the panel first.
  onStartRoute: () => void;
  // Optional: absent when the app does not wire dropping. Write access is unknowable client-side,
  // so a refused save surfaces as the Waypoints panel error rather than hiding the item.
  onDropWaypoint?: () => void;
  // Opens the bounded personal-note editor at the pressed chart position.
  onAddNote?: () => void;
  // Optional: arms the measure tool with its first point at the pressed position, so measuring
  // starts where the navigator is looking instead of via the app menu.
  onMeasureFrom?: () => void;
  onClose: () => void;
}

const {
  x,
  y,
  width,
  height,
  onGoToHere,
  onStartRoute,
  onDropWaypoint,
  onAddNote,
  onMeasureFrom,
  onClose,
}: Props = $props();

// AnchoredMenu owns the backdrop dismiss and the gated dismiss-stack registration (Escape peels the
// topmost surface in order). A stable wrapper is handed to it so it registers once instead of
// re-registering on every parent render, which the parent's fresh onClose closure would otherwise
// cause, breaking last-opened-first order; the wrapper reads the latest onClose when it fires.
const close = (): void => onClose();

// Wide enough for the longest label ("Start a route here") at the inherited font size; the menu
// is fixed to this width below so the clamp math always matches the rendered box.
const MENU_WIDTH = 240;
// Mirrors the .menu-item control height (--control-size, 2.75rem at the 16px base) for the
// above-or-below clamp math; the layout arithmetic needs a pixel number, not a CSS token.
const ITEM_HEIGHT = 44;
// The menu's top plus bottom padding, mirroring 2 * --space-1 (0.25rem each at the 16px base), so
// the clamp height matches the rendered box; the CSS padding below uses the same token.
const MENU_PADDING = 8;
// The clear margin kept from each viewport edge, mirroring --space-2 (0.5rem at the 16px base).
const EDGE = 8;

// Clamp the anchor so the menu (centered on x) stays a margin clear of both side edges.
const left = $derived(
  Math.min(
    Math.max(x, MENU_WIDTH / 2 + EDGE),
    Math.max(MENU_WIDTH / 2 + EDGE, width - MENU_WIDTH / 2 - EDGE),
  ),
);
// Prefer above the press so a finger does not cover the menu; drop below near the top edge.
let confirmingGoTo = $state(false);
const itemCount = $derived(
  confirmingGoTo ? 3 : 2 + (onDropWaypoint ? 1 : 0) + (onAddNote ? 1 : 0) + (onMeasureFrom ? 1 : 0),
);
const menuHeight = $derived(itemCount * ITEM_HEIGHT + MENU_PADDING);
const above = $derived(y > menuHeight + EDGE * 2 || y > height / 2);
const top = $derived(above ? y - EDGE : y + EDGE);
</script>

<AnchoredMenu
  open={true}
  onClose={close}
  backdropLabel="Dismiss menu"
  surfaceClass="popover-card chart-context-menu"
  ariaLabel={confirmingGoTo ? 'Confirm chart navigation' : 'Chart actions'}
  role={confirmingGoTo ? 'dialog' : 'menu'}
  focusTrap={confirmingGoTo}
  surfaceStyle={`left: ${left}px; top: ${top}px; inline-size: ${MENU_WIDTH}px; transform: translate(-50%, ${above ? '-100%' : '0'});`}
  onFocusLeft={close}
>
  {#if confirmingGoTo}
    <div class="goto-confirm">
      <InlineConfirm
        question="Start navigation to this chart position? Check the destination before relying on it."
        confirmLabel="Start navigation"
        onConfirm={onGoToHere}
        onCancel={() => (confirmingGoTo = false)}
      />
    </div>
  {:else}
    <!-- rovingFocus lands the keyboard on the first row and moves it with the arrow keys; the
           display:contents wrapper carries the action without inserting a box between the menu surface
           and its rows. -->
    <div class="rows" use:rovingFocus={'[role="menuitem"]'}>
      <button
        type="button"
        role="menuitem"
        class="menu-item item"
        onclick={() => (confirmingGoTo = true)}
      >
        <Navigation size={16} aria-hidden="true" />
        Go to here
      </button>
      <button type="button" role="menuitem" class="menu-item item" onclick={onStartRoute}>
        <Route size={16} aria-hidden="true" />
        Start a route here
      </button>
      {#if onDropWaypoint}
        <button type="button" role="menuitem" class="menu-item item" onclick={onDropWaypoint}>
          <MapPin size={16} aria-hidden="true" />
          Drop waypoint
        </button>
      {/if}
      {#if onAddNote}
        <button type="button" role="menuitem" class="menu-item item" onclick={onAddNote}>
          <NotebookPen size={16} aria-hidden="true" />
          Add note here
        </button>
      {/if}
      {#if onMeasureFrom}
        <button type="button" role="menuitem" class="menu-item item" onclick={onMeasureFrom}>
          <Ruler size={16} aria-hidden="true" />
          Measure from here
        </button>
      {/if}
    </div>
  {/if}
</AnchoredMenu>

<style>
:global(.chart-context-menu) {
  position: absolute;
  z-index: var(--z-menu);
  padding: var(--space-1);
}
/* Transparent to layout so the rows stay direct children of the menu surface and keep its padding;
   it adds no box and no containing block. */
.rows {
  display: contents;
}
.item {
  white-space: nowrap;
}
.goto-confirm {
  padding: var(--space-2);
}
</style>
