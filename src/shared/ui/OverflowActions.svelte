<script lang="ts">
import MoreHorizontal from '@lucide/svelte/icons/more-horizontal';
import type { Snippet } from 'svelte';
import AnchoredMenu from './AnchoredMenu.svelte';
import { createMenuFocusMachine, initializeMenuFocus, MENU_ITEM_SELECTOR } from './menu-focus';

interface Props {
  open: boolean;
  label: string;
  onToggle: () => void;
  onClose: () => void;
  children: Snippet;
}

const { open, label, onToggle, onClose, children: content }: Props = $props();
let trigger = $state<HTMLButtonElement>();
let surface = $state<HTMLElement>();

const machine = createMenuFocusMachine({
  surface: () => surface,
  trigger: () => trigger,
  focusFrames: 0,
  // A closure, not the prop itself: capturing onClose at construction would freeze the parent's
  // initial callback identity.
  requestClose: () => onClose(),
});

$effect(() => machine.syncOpen(open));

function handleClick(event: MouseEvent): void {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const item = target.closest<HTMLElement>(MENU_ITEM_SELECTOR);
  if (item && surface?.contains(item)) {
    // The action may mount and focus an editor or confirmation control. Do not request the trigger
    // explicitly here; the close effect restores it only when focus was actually lost.
    machine.close();
  }
}

function handleKeydown(event: KeyboardEvent): void {
  machine.handleKeydown(event);
  // A nested menu owns its navigation keys, not the enclosing panel or launcher grid.
  if (event.defaultPrevented) event.stopPropagation();
}
</script>

<div class="overflow-actions">
  <button
    type="button"
    class="icon-btn"
    aria-label={label}
    aria-expanded={open}
    aria-haspopup="menu"
    bind:this={trigger}
    onclick={onToggle}
  >
    <MoreHorizontal size={18} aria-hidden="true" />
  </button>
  <AnchoredMenu
    {open}
    onClose={() => machine.close()}
    backdropLabel={`Close ${label.toLowerCase()}`}
    surfaceClass="popover-card menu-surface overflow-actions-menu"
    anchor={trigger}
    ariaLabel={label}
    role="menu"
    bind:surfaceRef={surface}
    onPositioned={() => initializeMenuFocus(surface)}
    onKeydown={handleKeydown}
    onFocusLeft={() => machine.close()}
    onClick={handleClick}
  >
    {@render content()}
  </AnchoredMenu>
</div>

<style>
.overflow-actions {
  position: relative;
}

:global(.overflow-actions-menu .menu-item) {
  justify-content: flex-start;
  gap: var(--space-2);
  white-space: nowrap;
}
</style>
