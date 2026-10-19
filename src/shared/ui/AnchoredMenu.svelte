<script lang="ts">
import { onDestroy, type Snippet, tick } from 'svelte';
import { registerDismiss } from './dialog';
import { type FloatingAlign, type FloatingPlacement, floatingPosition } from './floating-position';
import { onKeydownAction, trapFocus } from './focus';
import { menuFocusLeft } from './menu-focus';
import { type SurfaceMotion, surfaceTransition } from './transitions';

interface Props {
  open: boolean;
  onClose: () => void;
  // The aria-label for the transparent backdrop dismiss button.
  backdropLabel: string;
  // A CSS class forwarded onto the surface element so each consumer can position it via a
  // :global block in its own scoped style. The primitive adds no position: relative or
  // container-type, so it never inserts a containing block between the consumer and its ancestor.
  surfaceClass?: string;
  // Optional inline style forwarded onto the surface, for a consumer that positions the menu
  // dynamically (the chart context menu clamps to the press point) rather than via a static class.
  surfaceStyle?: string;
  // Optional trigger for viewport-fixed, collision-aware placement. Consumers with a bespoke
  // coordinate system, such as the chart context menu, omit it and keep owning surfaceStyle.
  anchor?: HTMLElement;
  preferredPlacement?: FloatingPlacement;
  anchorAlign?: FloatingAlign;
  ariaLabel?: string;
  // The surface role, 'group' by default; a true menu passes 'menu' so its role="menuitem" rows
  // are exposed as a menu rather than a generic group.
  role?: string;
  // Trap Tab navigation inside the surface, for a consumer that turns the menu into a modal step
  // (role="dialog") in place. It also declares aria-modal, matching SlideOver's contract.
  focusTrap?: boolean;
  id?: string;
  // Optional ref binding and keyboard handler forwarded to the surface element, so consumers
  // that need arrow-key navigation can attach their handler without wrapping the content in an
  // additional non-semantic div that would trip the a11y no-static-element-interactions rule.
  surfaceRef?: HTMLElement;
  onKeydown?: (event: KeyboardEvent) => void;
  onFocusOut?: (event: FocusEvent) => void;
  // The shared close-on-focus-out contract: called when focus moves to a concrete control outside
  // the surface while open (menuFocusLeft semantics, so an internal step change or a transient
  // loss to the body never fires it). Consumers pass their close function instead of re-deriving
  // the check from a surfaceRef binding.
  onFocusLeft?: () => void;
  // Runs after the visible anchored surface has a measured layout box, so initial focus follows
  // placement in the browser as well as the DOM style update.
  onPositioned?: () => void;
  onClick?: (event: MouseEvent) => void;
  // How the surface arrives: a dropdown grows from its anchor corner, a full-width bottom sheet
  // rises from below.
  motion?: Extract<SurfaceMotion, 'grow' | 'below'>;
  children: Snippet;
}

let {
  open,
  onClose,
  backdropLabel,
  surfaceClass,
  surfaceStyle,
  anchor,
  preferredPlacement = 'auto',
  anchorAlign = 'start',
  ariaLabel,
  role = 'group',
  focusTrap = false,
  id,
  surfaceRef = $bindable(),
  onKeydown,
  onFocusOut,
  onFocusLeft,
  onPositioned,
  onClick,
  motion = 'grow',
  children,
}: Props = $props();

let backdrop = $state<HTMLButtonElement>();
let destroyed = false;
onDestroy(() => {
  destroyed = true;
});

// A replacement form can take focus before the outgoing menu's DOM is removed. Wait for that
// update before reading props, whose derived owner may already be inert during the focus event.
async function handleFocusOut(event: FocusEvent): Promise<void> {
  const surface = event.currentTarget;
  await tick();
  if (
    destroyed ||
    !(surface instanceof HTMLElement) ||
    !surface.isConnected ||
    surface.closest('[inert]') ||
    surface.contains(document.activeElement)
  ) {
    return;
  }
  onFocusOut?.(event);
  // Focus moving to the menu's own trigger is not leaving: a browser that focuses a button on
  // pointer-down would close the menu there, and the same tap's click would toggle it open again.
  if (open && onFocusLeft && menuFocusLeft(event.relatedTarget, surfaceRef)) {
    if (isOwnOpener(event.relatedTarget, surface)) return;
    onFocusLeft();
  }
}

function isOwnOpener(target: EventTarget | null, surface: Element | undefined): boolean {
  if (!(target instanceof Node)) return false;
  if (anchor?.contains(target)) return true;
  return surface?.closest('[data-menu-opener-group]')?.contains(target) ?? false;
}

let automaticStyle = $state('position: fixed; visibility: hidden;');
const resolvedSurfaceStyle = $derived(
  anchor ? `${surfaceStyle ?? ''}; ${automaticStyle}` : surfaceStyle,
);

$effect(() => {
  if (!open || !anchor) return;
  automaticStyle = 'position: fixed; visibility: hidden;';
  let disposed = false;
  let positioned = false;

  const position = (): void => {
    const surface = surfaceRef;
    if (!surface) return;
    const result = floatingPosition(
      anchor.getBoundingClientRect(),
      // offsetWidth and offsetHeight are the untransformed layout dimensions. Measuring the bounding
      // box during the opening scale transition would understate the final size and let the fully
      // expanded surface cross a viewport edge by a few pixels.
      { width: surface.offsetWidth, height: surface.offsetHeight },
      {
        width: document.documentElement.clientWidth,
        height: document.documentElement.clientHeight,
      },
      { placement: preferredPlacement, align: anchorAlign },
    );
    automaticStyle = `position: fixed; left: ${Math.round(result.left)}px; top: ${Math.round(result.top)}px; visibility: visible; --anchored-origin-y: ${result.opensBelow ? 'top' : 'bottom'};`;
    if (!positioned) {
      void tick().then(() => {
        if (disposed || positioned || destroyed) return;
        // Check the captured DOM before reactive props: an outgoing owner's derived state can
        // already be inert while its menu surface remains connected for a transition.
        if (!surface.isConnected || surface.closest('[inert]')) return;
        if (surfaceRef !== surface || !open) return;
        // tick flushes the style attribute, not browser layout. Measure that visible placement
        // before a consumer focuses an item. A later resize can complete a surface whose ancestor
        // does not yet have a layout box, without a timer or repeated focus attempts.
        const bounds = surface.getBoundingClientRect();
        if (bounds.width === 0 || bounds.height === 0) return;
        positioned = true;
        onPositioned?.();
      });
    }
  };

  let frame: number | undefined;
  const schedulePosition = (): void => {
    if (frame !== undefined) return;
    frame = requestAnimationFrame(() => {
      frame = undefined;
      position();
    });
  };
  schedulePosition();
  const observer = new ResizeObserver(schedulePosition);
  observer.observe(anchor);
  if (surfaceRef) observer.observe(surfaceRef);
  const visualViewport = window.visualViewport;
  window.addEventListener('resize', schedulePosition);
  window.addEventListener('scroll', schedulePosition, true);
  visualViewport?.addEventListener('resize', schedulePosition);
  visualViewport?.addEventListener('scroll', schedulePosition);

  return () => {
    disposed = true;
    if (frame !== undefined) cancelAnimationFrame(frame);
    observer.disconnect();
    window.removeEventListener('resize', schedulePosition);
    window.removeEventListener('scroll', schedulePosition, true);
    visualViewport?.removeEventListener('resize', schedulePosition);
    visualViewport?.removeEventListener('scroll', schedulePosition);
  };
});

// Live chrome (an element marked data-live-chrome: the status bar, which holds MOB) stays live under
// every menu. The backdrop stops at its top edge (--bar-block-size, which the shell publishes), so a
// tap there reaches the chrome's control instead of the backdrop, and that tap also closes the menu
// without being swallowed, so MOB is one tap away whatever is open. Taps anywhere else still meet the
// backdrop. The menu's own opener group (its trigger) and anchor are excluded, since their click
// toggles it, and so is its own backdrop, whose click closes it once.
$effect(() => {
  if (!open) return;
  const onPointerDown = (event: PointerEvent): void => {
    const target = event.target;
    if (!(target instanceof Element) || !target.closest('[data-live-chrome]')) return;
    const surface = surfaceRef;
    if (target === backdrop || surface?.contains(target) || isOwnOpener(target, surface)) return;
    onClose();
  };
  document.addEventListener('pointerdown', onPointerDown, true);
  return () => document.removeEventListener('pointerdown', onPointerDown, true);
});

// Gate registerDismiss on open so the handler is never in the stack while the menu is closed.
// The weather menu previously registered ungated and relied on conditional mounting; the primitive
// must not assume that.
$effect(() => {
  if (!open) return;
  return registerDismiss(onClose);
});
</script>

{#if open}
  <!-- Transparent backdrop: catches outside taps to dismiss. Fixed positioning covers the full
       viewport regardless of the containing block, so a tap anywhere outside the surface closes. -->
  <button
    type="button"
    class="overlay-backdrop anchored-menu-backdrop"
    aria-label={backdropLabel}
    tabindex="-1"
    onclick={onClose}
    bind:this={backdrop}
  ></button>
  <!-- biome-ignore lint/a11y/useAriaPropsSupportedByRole: role is a prop (group by default, menu for
       context menus, dialog for a modal step); all support aria-label, and aria-modal is set only
       with the focus trap, which is what a dialog consumer turns on. Biome cannot resolve the
       dynamic role statically. -->
  <!-- biome-ignore lint/a11y/noStaticElementInteractions: role is a dynamic prop, and menu consumers
       delegate activation from their semantic button children. -->
  <!-- biome-ignore lint/a11y/useKeyWithClickEvents: the delegated handler observes button clicks,
       including keyboard-generated clicks; it does not create a separate pointer-only action. -->
  <div
    class={surfaceClass ? `anchored-menu-surface ${surfaceClass}` : 'anchored-menu-surface'}
    {role}
    aria-label={ariaLabel}
    aria-modal={focusTrap ? 'true' : undefined}
    style={resolvedSurfaceStyle}
    {id}
    bind:this={surfaceRef}
    use:onKeydownAction={onKeydown}
    use:trapFocus={focusTrap}
    onfocusout={handleFocusOut}
    onclick={onClick}
    transition:surfaceTransition={motion}
  >
    {@render children()}
  </div>
{/if}

<style>
.anchored-menu-surface {
  /* Placement and visibility are immediate. The reduced-motion duration reset must not create
     a visibility transition that leaves the surface unfocusable after positioning. */
  transition-property: none;
  /* The grow transition originates at the inline-start top corner by default, matching the
     corner-anchored dropdown. A consumer's :global block can override transform-origin for a
     bottom-sheet that grows from the bottom edge. */
  transform-origin: top left;
}
/* Override the .overlay-backdrop base (position: absolute) with fixed so the backdrop covers the
   viewport regardless of the nearest positioned ancestor, down to the status bar's top edge. A tap
   anywhere outside the surface closes the menu. Inside a modal dialog the bar is inert, so the
   backdrop covers it too, and a tap meant to close the menu cannot reach the dialog's own
   buttons. */
.anchored-menu-backdrop {
  position: fixed;
  inset-block-end: var(--bar-block-size, 0px);
}
:global(dialog) .anchored-menu-backdrop {
  inset-block-end: 0;
}
</style>
