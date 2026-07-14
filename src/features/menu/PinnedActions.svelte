<script lang="ts">
import { Ellipsis } from '@lucide/svelte';
import { onDestroy, onMount } from 'svelte';
import { Toast } from '$shared/lib';
import { AnchoredMenu, UnavailableHint } from '$shared/ui';
import MenuItemIcon from './MenuItemIcon.svelte';
import { blockedReason, itemBlocked, type MenuItem } from './menu-item';
import { MAX_BAR_PILLS, splitBarActions } from './pinned-actions';

interface Props {
  actions: MenuItem[];
}

const { actions }: Props = $props();
let compactPhone = $state(false);
let moreOpen = $state(false);
const split = $derived(splitBarActions(actions, compactPhone ? 2 : MAX_BAR_PILLS));
const moreActive = $derived(split.overflow.some((action) => action.pressed === true));
const blockedNote = new Toast();
const NOTE_MS = 5_000;

onDestroy(() => blockedNote.dispose());
onMount(() => {
  const query = window.matchMedia('(max-width: 600px)');
  const sync = (): void => {
    compactPhone = query.matches;
  };
  sync();
  query.addEventListener('change', sync);
  return () => query.removeEventListener('change', sync);
});

function closeMore(): void {
  moreOpen = false;
}

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
</script>

<div class="pinned-actions strip-center">
  {#if blockedNote.message}
    <p class="blocked-pill-note popover-card" role="status" aria-live="polite">
      {blockedNote.message}
    </p>
  {/if}
  {#each split.visible as action (action.id)}
    <button
      type="button"
      class="btn btn-pill"
      class:is-on={action.pressed === true}
      aria-pressed={action.pressed === undefined ? undefined : action.pressed}
      disabled={action.disabled === true}
      aria-disabled={action.available === false ? true : undefined}
      title={blockedReason(action) ?? action.label}
      onclick={() => run(action)}
    >
      <UnavailableHint hint={action.available === false ? action.unavailableHint : undefined} />
      <MenuItemIcon item={action} size={16} />
      {action.shortLabel ?? action.label}
    </button>
  {/each}
  {#if split.overflow.length > 0}
    <div class="more-wrap">
      <button
        type="button"
        class="btn btn-pill"
        class:is-on={moreActive || moreOpen}
        aria-haspopup="true"
        aria-expanded={moreOpen}
        aria-controls={moreOpen ? 'bar-more-menu' : undefined}
        aria-label={`More actions (${split.overflow.length})`}
        title="More actions"
        onclick={() => (moreOpen = !moreOpen)}
      >
        <Ellipsis size={16} aria-hidden="true" />
        More
        {#if split.overflow.length > 1}
          <span class="pill-count" aria-hidden="true">{split.overflow.length}</span>
        {/if}
      </button>
      <AnchoredMenu
        open={moreOpen}
        onClose={closeMore}
        backdropLabel="Close more actions"
        surfaceClass="popover-card bar-more"
        ariaLabel="More actions"
        id="bar-more-menu"
      >
        {#snippet children()}
          {#each split.overflow as action (action.id)}
            <button
              type="button"
              class="menu-item"
              class:is-on={action.pressed === true}
              aria-pressed={action.pressed === undefined ? undefined : action.pressed}
              disabled={action.disabled === true}
              aria-disabled={action.available === false ? true : undefined}
              title={blockedReason(action) ?? action.label}
              onclick={() => run(action, closeMore)}
            >
              <UnavailableHint
                hint={action.available === false ? action.unavailableHint : undefined}
              />
              <MenuItemIcon item={action} size={16} />
              {action.label}
            </button>
          {/each}
        {/snippet}
      </AnchoredMenu>
    </div>
  {/if}
</div>

<style>
.pinned-actions {
  position: relative;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: var(--space-2);
}
.btn-pill[aria-disabled="true"],
.menu-item[aria-disabled="true"] {
  opacity: var(--disabled-opacity);
  cursor: default;
}
.btn-pill[aria-disabled="true"]:hover {
  border-color: var(--border);
  background: var(--surface-raised);
}
.menu-item[aria-disabled="true"]:hover {
  background: transparent;
}
.more-wrap {
  position: relative;
}
.pill-count {
  font-size: var(--text-xs);
  background: var(--accent-tint);
  border-radius: var(--radius-pill);
  padding: 0 0.3rem;
  color: var(--accent);
}
.blocked-pill-note {
  position: absolute;
  inset-block-end: calc(100% + var(--space-1));
  inset-inline-start: 50%;
  transform: translateX(-50%);
  z-index: var(--z-menu);
  max-inline-size: 16rem;
  padding: var(--space-2) var(--space-3);
  font-size: var(--text-sm);
  text-align: center;
}
:global(.bar-more) {
  position: absolute;
  inset-block-end: calc(100% + var(--space-1));
  inset-inline-end: 0;
  transform-origin: bottom right;
  z-index: var(--z-menu);
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-inline-size: 12rem;
  padding: var(--space-1);
}
@media (max-width: 600px) {
  .pinned-actions {
    flex-wrap: nowrap;
    gap: var(--space-1);
  }
}
</style>
