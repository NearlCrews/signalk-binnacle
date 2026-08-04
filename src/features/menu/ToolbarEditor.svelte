<script lang="ts">
import GripVertical from '@lucide/svelte/icons/grip-vertical';
import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
import { createReorder, InlineConfirm, UnavailableHint } from '$shared/ui';
import MenuItemIcon from './MenuItemIcon.svelte';
import { blockedReason, type MenuItem } from './menu-item';

interface Props {
  items: MenuItem[];
  onReorder?: (id: string, slot: number) => void;
  onReset?: () => void;
}

const { items, onReorder, onReset }: Props = $props();
let list: HTMLElement | undefined = $state(undefined);
let resetArmed = $state(false);

const reorder = createReorder({
  getItems: () => items.map((item) => ({ id: item.id, title: item.label })),
  getListEl: () => list,
  commit: (id, slot) => onReorder?.(id, slot),
  rowAttribute: 'data-toolbar-row',
  handleSelector: '.toolbar-handle',
  itemNoun: 'Action',
});

function handleKeydown(id: string, event: KeyboardEvent): void {
  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') event.stopPropagation();
  reorder.handleKeydown(id, event);
}
</script>

<section class="toolbar-editor" aria-label="Toolbar">
  <div class="toolbar-editor-head">
    <h3 class="caps-label toolbar-title">Toolbar</h3>
    {#if !resetArmed}
      <button type="button" class="btn btn-ghost reset-toolbar" onclick={() => (resetArmed = true)}>
        <RotateCcw size={16} aria-hidden="true" />
        Reset toolbar
      </button>
    {/if}
  </div>
  {#if resetArmed}
    <InlineConfirm
      question="Reset to defaults?"
      confirmLabel="Reset"
      onConfirm={() => {
        resetArmed = false;
        onReset?.();
      }}
      onCancel={() => (resetArmed = false)}
    />
  {/if}
  {#if items.length === 0}
    <p class="muted-note">No toolbar actions pinned.</p>
  {:else}
    <ol class="toolbar-list bare-list" bind:this={list}>
      {#each items as item, i (item.id)}
        {@const indicator = reorder.indicatorFor(item.id)}
        <li
          data-toolbar-row={item.id}
          class="toolbar-row reorder-row"
          class:unavailable={item.available === false}
          class:dragging={reorder.dragId === item.id}
          class:drop-before={indicator.before}
          class:drop-after={indicator.after}
          title={blockedReason(item)}
        >
          <span class="toolbar-row-main">
            <UnavailableHint hint={item.available === false ? item.unavailableHint : undefined} />
            <MenuItemIcon {item} size={18} />
            <span>{item.shortLabel ?? item.label}</span>
          </span>
          <button
            type="button"
            class="icon-btn handle toolbar-handle"
            aria-label={`Move ${item.label}, position ${i + 1} of ${items.length}`}
            aria-keyshortcuts="ArrowUp ArrowDown"
            onpointerdown={(event) => reorder.handlePointerDown(item.id, event)}
            onkeydown={(event) => handleKeydown(item.id, event)}
          >
            <GripVertical size={18} aria-hidden="true" />
          </button>
        </li>
      {/each}
    </ol>
  {/if}
  <span class="visually-hidden" role="status">{reorder.reorderAnnouncement}</span>
</section>

<style>
.toolbar-editor {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding-block: var(--space-1) var(--space-2);
  border-block-end: 1px solid var(--border);
}
.toolbar-editor-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}
.toolbar-title {
  margin: 0;
  padding-inline: var(--space-1);
}
.reset-toolbar {
  min-block-size: var(--row-size);
  white-space: nowrap;
}
.toolbar-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.toolbar-row {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  min-block-size: var(--row-size);
  padding: 0 0 0 var(--space-2);
  border-radius: var(--radius-sm);
  background: var(--surface-raised);
}
.toolbar-row-main {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  flex: 1;
  min-inline-size: 0;
  font-size: var(--text-sm);
}
.toolbar-row-main span:last-child {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
