<script lang="ts">
import type { Snippet } from 'svelte';
import { scale } from 'svelte/transition';
import { prefersReducedMotion } from '$shared/lib';
import { onKeydownAction } from './focus';

interface Props {
  open: boolean;
  onClose: () => void;
  // Kept in Props to avoid breaking consumers but unused since native popover manages backdrop natively.
  backdropLabel?: string;
  // A CSS class forwarded onto the surface element so each consumer can position it via a
  // :global block in its own scoped style.
  surfaceClass?: string;
  // Optional inline style forwarded onto the surface, for a consumer that positions the menu
  // dynamically.
  surfaceStyle?: string;
  ariaLabel?: string;
  // The surface role, 'group' by default.
  role?: string;
  id?: string;
  surfaceRef?: HTMLElement;
  onKeydown?: (event: KeyboardEvent) => void;
  children: Snippet;
}

let {
  open,
  onClose,
  surfaceClass,
  surfaceStyle,
  ariaLabel,
  role = 'group',
  id,
  surfaceRef = $bindable(),
  onKeydown,
  children,
}: Props = $props();

// Sync programmatic open state with native popover state.
$effect(() => {
  if (!surfaceRef) return;
  if (open) {
    try {
      surfaceRef.showPopover();
    } catch (_) {}
  } else {
    try {
      surfaceRef.hidePopover();
    } catch (_) {}
  }
});

// Sync native light-dismiss with Svelte open state.
function onBeforeToggle(event: ToggleEvent): void {
  if (event.newState === 'closed' && open) {
    onClose();
  }
}
</script>

{#if open}
  <!-- The popover="auto" attribute promotes the menu to the browser's native top layer,
       preventing any z-index stacking issues, and provides native click-outside light dismiss. -->
  <!-- biome-ignore lint/a11y/useAriaPropsSupportedByRole: role is a prop (group by default, menu for
       context menus); both support aria-label, but biome cannot resolve the dynamic role statically. -->
  <div
    popover="auto"
    onbeforetoggle={onBeforeToggle}
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
  transform-origin: top left;
  /* Override default browser popover styles to match our design system */
  border: none;
  padding: 0;
  margin: 0;
  background: transparent;
  color: inherit;
  overflow: visible;
}
</style>
