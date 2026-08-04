<script lang="ts">
import GripVertical from '@lucide/svelte/icons/grip-vertical';
import RotateCw from '@lucide/svelte/icons/rotate-cw';
import { MAX_TREND_INSTRUMENTS } from '$entities/instrument-trend';
import { CustomizeCategory, createReorder, LayerToggle, UnavailableHint } from '$shared/ui';
import type { TrendItem, TrendsController } from './trends-controller.svelte';

interface Props {
  controller: TrendsController;
}

const { controller }: Props = $props();
let listEl: HTMLElement | undefined = $state();

const selected = $derived(controller.selected);
const selectedIds = $derived(new Set(controller.selectedIds));
const available = $derived(controller.catalog.filter((item) => !selectedIds.has(item.id)));
const atLimit = $derived(selected.length >= MAX_TREND_INSTRUMENTS);
const categoryTitles = {
  navigation: 'Navigation',
  wind: 'Wind',
  depth: 'Depth',
  weather: 'Weather',
  electrical: 'Electrical',
  propulsion: 'Engines',
  tanks: 'Tanks',
  cabin: 'Cabin',
} as const;
const groups = $derived.by(() =>
  Object.entries(categoryTitles).flatMap(([id, title]) => {
    const rows = available.filter((item) => item.category === id);
    return rows.length > 0 ? [{ id, title, rows }] : [];
  }),
);

const reorder = createReorder({
  getItems: () => selected.map((item) => ({ id: item.id, title: item.label })),
  getListEl: () => listEl,
  commit: (id, slot) => controller.reorder(id, slot),
  rowAttribute: 'data-trend-row',
  handleSelector: '.handle',
  itemNoun: 'Trend',
});

function hintId(prefix: string, id: string): string {
  return `${prefix}-${encodeURIComponent(id).replace(/\./g, '%2E')}`;
}

function statusText(item: TrendItem): string | undefined {
  if (item.unavailable) return 'Unavailable on this server';
  if (item.historicalOnly) return 'Previously recorded, but not reporting live now';
  if (!item.hasLiveReport) return 'No live samples received yet';
  return undefined;
}
</script>

<div class="customize-list" bind:this={listEl}>
  <div class="selection-head">
    <h3 class="caps-label">Selected</h3>
    <span class="muted-note">{selected.length} of {MAX_TREND_INSTRUMENTS} selected</span>
  </div>
  <ul class="trend-list bare-list">
    {#each selected as item, index (item.id)}
      {@const indicator = reorder.indicatorFor(item.id)}
      {@const itemStatus = statusText(item)}
      {@const describedBy = itemStatus ? hintId('selected-trend', item.id) : undefined}
      <li
        data-trend-row={item.id}
        class="row-interactive reorder-row is-on"
        class:dragging={reorder.dragId === item.id}
        class:drop-before={indicator.before}
        class:drop-after={indicator.after}
      >
        <LayerToggle
          title={item.label}
          description={item.description}
          visible
          onToggle={() => controller.toggle(item.id)}
          {describedBy}
        />
        {#if itemStatus}
          <span id={describedBy} class="row-note">{itemStatus}</span>
        {/if}
        <button
          type="button"
          class="icon-btn handle"
          aria-label={`Move ${item.label}, position ${index + 1} of ${selected.length}`}
          aria-keyshortcuts="ArrowUp ArrowDown"
          onpointerdown={(event) => reorder.handlePointerDown(item.id, event)}
          onkeydown={(event) => reorder.handleKeydown(item.id, event)}
        >
          <GripVertical size={18} aria-hidden="true" />
        </button>
      </li>
    {/each}
  </ul>

  <div class="available-head">
    <h3 class="caps-label">Available</h3>
    <button
      type="button"
      class="btn btn-ghost"
      disabled={controller.discovering}
      aria-busy={controller.discovering}
      onclick={() => controller.refreshCatalog()}
    >
      <RotateCw size={16} aria-hidden="true" />
      {controller.discovering ? 'Scanning' : 'Rescan'}
    </button>
  </div>
  {#if atLimit}
    <p class="limit-note" role="status">Remove a trend before adding another.</p>
  {/if}
  {#each groups as group (group.id)}
    <CustomizeCategory id={`trend-category-${group.id}`} label={group.title}>
      <ul class="trend-list bare-list">
        {#each group.rows as item (item.id)}
          {@const itemStatus = statusText(item)}
          {@const describedBy = atLimit
            ? hintId('trend-limit', item.id)
            : itemStatus
              ? hintId('available-trend', item.id)
              : undefined}
          <li class="row-interactive" class:unavailable={!atLimit && !item.hasLiveReport}>
            <LayerToggle
              title={item.label}
              description={item.description}
              visible={false}
              disabled={atLimit}
              onToggle={() => controller.toggle(item.id)}
              {describedBy}
            />
            {#if atLimit}
              <UnavailableHint id={describedBy} hint="Remove a trend before adding another." />
            {:else if itemStatus}
              <span id={describedBy} class="row-note">{itemStatus}</span>
            {/if}
          </li>
        {/each}
      </ul>
    </CustomizeCategory>
  {/each}
  {#if groups.length === 0}
    <p class="muted-note empty-note">No other trendable instruments found yet.</p>
  {/if}
</div>
<span class="visually-hidden" role="status">{reorder.reorderAnnouncement}</span>

<style>
.customize-list {
  flex: 1;
  min-block-size: 0;
  overflow-y: auto;
}
.selection-head,
.available-head {
  display: flex;
  min-block-size: var(--row-size);
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}
.selection-head,
.available-head,
.limit-note,
.empty-note {
  padding-inline: var(--space-3);
}
.selection-head h3,
.available-head h3 {
  margin: 0;
}
.limit-note {
  margin: 0 0 var(--space-2);
  color: var(--text-muted);
  font-size: var(--text-sm);
}
.trend-list li {
  display: flex;
  min-inline-size: 0;
  align-items: center;
  gap: var(--space-1);
  padding-inline-end: var(--space-1);
}
.row-note {
  max-inline-size: 8rem;
  flex-shrink: 1;
  color: var(--text-muted);
  font-size: var(--text-xs);
  overflow-wrap: anywhere;
}
</style>
