<script lang="ts">
import MapPin from '@lucide/svelte/icons/map-pin';
import Navigation from '@lucide/svelte/icons/navigation';
import NotebookPen from '@lucide/svelte/icons/notebook-pen';
import Route from '@lucide/svelte/icons/route';
import Ruler from '@lucide/svelte/icons/ruler';
import { AnchoredMenu, InlineConfirm, initializeMenuFocus, rovingFocus } from '$shared/ui';

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

let anchor = $state<HTMLElement>();
let surface = $state<HTMLElement>();
let confirmingGoTo = $state(false);
</script>

<span
  class="chart-menu-anchor"
  aria-hidden="true"
  bind:this={anchor}
  style:left={`${Math.min(width, Math.max(0, x))}px`}
  style:top={`${Math.min(height, Math.max(0, y))}px`}
></span>
<AnchoredMenu
  open={true}
  onClose={close}
  backdropLabel="Dismiss menu"
  surfaceClass="popover-card chart-context-menu"
  ariaLabel={confirmingGoTo ? 'Confirm chart navigation' : 'Chart actions'}
  role={confirmingGoTo ? 'dialog' : 'menu'}
  focusTrap={confirmingGoTo}
  {anchor}
  bind:surfaceRef={surface}
  onPositioned={() => { if (!confirmingGoTo) initializeMenuFocus(surface); }}
  preferredPlacement="above"
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
.chart-menu-anchor {
  position: absolute;
  inline-size: 0;
  block-size: 0;
  pointer-events: none;
}
:global(.chart-context-menu) {
  z-index: var(--z-menu);
  padding: var(--space-1);
  inline-size: min(15rem, calc(100dvw - 1rem));
  max-block-size: calc(100 * var(--dvh) - 1rem);
  overflow-y: auto;
  overscroll-behavior: contain;
  font-size: var(--text-sm);
}
/* Transparent to layout so the rows stay direct children of the menu surface and keep its padding;
   it adds no box and no containing block. */
.rows {
  display: contents;
}
.item {
  white-space: normal;
  text-align: start;
}
.goto-confirm {
  padding: var(--space-2);
}
</style>
