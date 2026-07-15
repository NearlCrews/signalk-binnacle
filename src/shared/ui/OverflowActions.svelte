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
let trigger: HTMLButtonElement | undefined;
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
  position: absolute;
  inset-inline-end: 0;
  inset-block-end: calc(100% + var(--space-1));
  z-index: var(--z-menu);
  display: flex;
  flex-direction: column;
  min-inline-size: 13rem;
  padding: var(--space-1);
}

:global(.overflow-actions-menu .menu-item) {
  justify-content: flex-start;
  gap: var(--space-2);
  white-space: nowrap;
}
</style>
