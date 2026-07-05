<script lang="ts">
import type { Snippet } from 'svelte';
import { scale } from 'svelte/transition';
import { prefersReducedMotion } from '$shared/lib';
import { registerDismiss } from './dialog';
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
  children: Snippet;
}

let {
  open,
  onClose,
  backdropLabel,
  surfaceClass,
  surfaceStyle,
  ariaLabel,
  role = 'group',
  id,
  surfaceRef = $bindable(),
  onKeydown,
  children,
}: Props = $props();

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
    onclick={onClose}
  ></button>
  <!-- biome-ignore lint/a11y/useAriaPropsSupportedByRole: role is a prop (group by default, menu for
       context menus); both support aria-label, but biome cannot resolve the dynamic role statically. -->
  <div
    class={surfaceClass ? `anchored-menu-surface ${surfaceClass}` : 'anchored-menu-surface'}
    {role}
    aria-label={ariaLabel}
    style={surfaceStyle}
    {id}
    bind:this={surfaceRef}
    use:onKeydownAction={onKeydown}
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
