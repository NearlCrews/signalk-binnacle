<script lang="ts">
import { MoreHorizontal } from '@lucide/svelte';
import type { Snippet } from 'svelte';
import AnchoredMenu from './AnchoredMenu.svelte';

interface Props {
  open: boolean;
  label: string;
  onToggle: () => void;
  onClose: () => void;
  children: Snippet;
}

const { open, label, onToggle, onClose, children: content }: Props = $props();
let trigger = $state<HTMLButtonElement>();
let surface = $state<HTMLElement | undefined>();

$effect(() => {
  if (!open) return;
  requestAnimationFrame(() =>
    surface?.querySelector<HTMLElement>('button:not(:disabled)')?.focus(),
  );
});

function close(): void {
  onClose();
  trigger?.focus();
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
    onClose={close}
    backdropLabel={`Close ${label.toLowerCase()}`}
    surfaceClass="popover-card overflow-actions-menu"
    anchor={trigger}
    ariaLabel={label}
    role="menu"
    bind:surfaceRef={surface}
  >
    {@render content()}
  </AnchoredMenu>
</div>

<style>
.overflow-actions {
  position: relative;
}

:global(.overflow-actions-menu) {
  z-index: var(--z-menu);
  display: flex;
  flex-direction: column;
  inline-size: min(13rem, calc(100vw - 1rem));
  padding: var(--space-1);
  transform-origin: left var(--anchored-origin-y, top);
}

:global(.overflow-actions-menu .menu-item) {
  justify-content: flex-start;
  gap: var(--space-2);
  white-space: nowrap;
}
</style>
