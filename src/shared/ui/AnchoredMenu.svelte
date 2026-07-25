<script lang="ts">
import type { Snippet } from 'svelte';
import { scale } from 'svelte/transition';
import { prefersReducedMotion } from '$shared/lib';
import { registerDismiss } from './dialog';
import { type FloatingAlign, type FloatingPlacement, floatingPosition } from './floating-position';
import { onKeydownAction } from './focus';

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
  id?: string;
  // Optional ref binding and keyboard handler forwarded to the surface element, so consumers
  // that need arrow-key navigation can attach their handler without wrapping the content in an
  // additional non-semantic div that would trip the a11y no-static-element-interactions rule.
  surfaceRef?: HTMLElement;
  onKeydown?: (event: KeyboardEvent) => void;
  onFocusOut?: (event: FocusEvent) => void;
  onClick?: (event: MouseEvent) => void;
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
  id,
  surfaceRef = $bindable(),
  onKeydown,
  onFocusOut,
  onClick,
  children,
}: Props = $props();

let automaticStyle = $state('position: fixed; visibility: hidden;');
const resolvedSurfaceStyle = $derived(
  anchor ? `${surfaceStyle ?? ''}; ${automaticStyle}` : surfaceStyle,
);

$effect(() => {
  if (!open || !anchor) return;
  automaticStyle = 'position: fixed; visibility: hidden;';

  const position = (): void => {
    if (!surfaceRef) return;
    const result = floatingPosition(
      anchor.getBoundingClientRect(),
      // offsetWidth and offsetHeight are the untransformed layout dimensions. Measuring the bounding
      // box during the opening scale transition would understate the final size and let the fully
      // expanded surface cross a viewport edge by a few pixels.
      { width: surfaceRef.offsetWidth, height: surfaceRef.offsetHeight },
      {
        width: document.documentElement.clientWidth,
        height: document.documentElement.clientHeight,
      },
      { placement: preferredPlacement, align: anchorAlign },
    );
    automaticStyle = `position: fixed; left: ${Math.round(result.left)}px; top: ${Math.round(result.top)}px; visibility: visible; --anchored-origin-y: ${result.opensBelow ? 'top' : 'bottom'};`;
  };

  const frame = requestAnimationFrame(position);
  const visualViewport = window.visualViewport;
  window.addEventListener('resize', position);
  window.addEventListener('scroll', position, true);
  visualViewport?.addEventListener('resize', position);
  visualViewport?.addEventListener('scroll', position);

  return () => {
    cancelAnimationFrame(frame);
    window.removeEventListener('resize', position);
    window.removeEventListener('scroll', position, true);
    visualViewport?.removeEventListener('resize', position);
    visualViewport?.removeEventListener('scroll', position);
  };
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
  ></button>
  <!-- biome-ignore lint/a11y/useAriaPropsSupportedByRole: role is a prop (group by default, menu for
       context menus); both support aria-label, but biome cannot resolve the dynamic role statically. -->
  <!-- biome-ignore lint/a11y/noStaticElementInteractions: role is a dynamic prop, and menu consumers
       delegate activation from their semantic button children. -->
  <!-- biome-ignore lint/a11y/useKeyWithClickEvents: the delegated handler observes button clicks,
       including keyboard-generated clicks; it does not create a separate pointer-only action. -->
  <div
    class={surfaceClass ? `anchored-menu-surface ${surfaceClass}` : 'anchored-menu-surface'}
    {role}
    aria-label={ariaLabel}
    style={resolvedSurfaceStyle}
    {id}
    bind:this={surfaceRef}
    use:onKeydownAction={onKeydown}
    onfocusout={onFocusOut}
    onclick={onClick}
    transition:scale={{
      start: 0.92,
      duration: prefersReducedMotion() ? 0 : 140,
      opacity: 0.5,
    }}
  >
    {@render children()}
  </div>
{/if}

<style>
.anchored-menu-surface {
  /* The grow transition originates at the inline-start top corner by default, matching the
     corner-anchored dropdown. A consumer's :global block can override transform-origin for a
     bottom-sheet that grows from the bottom edge. */
  transform-origin: top left;
}
/* Override the .overlay-backdrop base (position: absolute) with fixed so the backdrop covers the
   full viewport regardless of the nearest positioned ancestor. A tap anywhere outside the surface
   closes the menu. */
.anchored-menu-backdrop {
  position: fixed;
}
</style>
