<script lang="ts">
import GripVertical from '@lucide/svelte/icons/grip-vertical';
import RotateCw from '@lucide/svelte/icons/rotate-cw';
import { createReorder, LayerToggle, UnavailableHint } from '$shared/ui';
import type { InstrumentsController } from './instruments-controller.svelte';
import { instrumentOptionLabels, type TileDef, type TileDeps } from './tile-catalog';

interface Props {
  controller: InstrumentsController;
  deps: TileDeps;
}

const { controller, deps }: Props = $props();

let listEl: HTMLElement | undefined = $state(undefined);

// The shown tiles in their selection order, so dragging visibly reorders these rows; the reorder
// controller addresses rows by their index in this same list. The available tiles hang below in
// catalog order as add-only rows. Rendering the catalog order here instead would divorce the
// visible rows from the movable list, so a drag would commit but never appear to move.
const shown = $derived(controller.tiles);
const selectedIds = $derived(new Set(controller.selectedIds));
const available = $derived(controller.catalog.filter((def) => !selectedIds.has(def.id)));
const optionLabels = $derived(instrumentOptionLabels(controller.catalog));
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
const availableGroups = $derived.by(() =>
  Object.entries(categoryTitles).flatMap(([id, title]) => {
    const rows = available.filter((def) => def.category === id);
    return rows.length > 0 ? [{ id, title, rows }] : [];
  }),
);

const reorder = createReorder({
  getItems: () => shown.map((tile) => ({ id: tile.id, title: optionTitle(tile) })),
  getListEl: () => listEl,
  commit: (id, slot) => controller.reorderTile(id, slot),
  rowAttribute: 'data-tile-row',
  handleSelector: '.handle',
  itemNoun: 'Tile',
});

function optionTitle(def: TileDef): string {
  return optionLabels.get(def.id) ?? def.label;
}

function neverReported(paths: string[]): boolean {
  return paths.length > 0 && paths.every((p) => deps.store.cell(p).epoch === 0);
}

function historyHintId(id: string): string {
  return `instrument-history-${encodeURIComponent(id).replace(/\./g, '%2E')}`;
}

const historyStatusMessage = $derived(
  controller.historyStatus === 'checking'
    ? 'Checking for recorded instruments.'
    : controller.historyStatus === 'scanning'
      ? 'Scanning recorded instruments.'
      : controller.historyStatus === 'complete'
        ? 'Recorded instruments scanned.'
        : controller.historyStatus === 'partial'
          ? 'Some recorded instruments could not be scanned. Accepted results were retained.'
          : controller.historyStatus === 'failed'
            ? 'Recorded instruments could not be scanned. Live instruments are still available.'
            : controller.historyStatus === 'unavailable'
              ? 'No history provider is available. Showing live instruments.'
              : '',
);
</script>

<!-- The reorder controller measures rows and listens for scroll on this element, so it is the one
     scroll container over both sections and it holds the data-tile-row rows (the shown list). -->
<div class="customize-list" bind:this={listEl}>
  <h3 class="caps-label section-label">Shown</h3>
  <ul class="tile-list bare-list">
    {#each shown as def, i (def.id)}
      {@const indicator = reorder.indicatorFor(def.id)}
      {@const title = optionTitle(def)}
      {@const historicalOnly = controller.isHistoricalOnly(def.id) && neverReported(def.paths)}
      {@const hintId = historicalOnly ? historyHintId(def.id) : undefined}
      <li
        data-tile-row={def.id}
        class="row-interactive reorder-row is-on"
        class:dragging={reorder.dragId === def.id}
        class:drop-before={indicator.before}
        class:drop-after={indicator.after}
      >
        <LayerToggle
          {title}
          description={def.description}
          visible={true}
          onToggle={() => controller.toggleTile(def.id)}
          describedBy={hintId}
        />
        {#if historicalOnly}
          <span id={hintId} class="history-note">Previously seen, no live data</span>
        {/if}
        <button
          type="button"
          class="icon-btn handle"
          aria-label={`Move ${title}, position ${i + 1} of ${shown.length}`}
          aria-keyshortcuts="ArrowUp ArrowDown"
          onpointerdown={(e) => reorder.handlePointerDown(def.id, e)}
          onkeydown={(e) => reorder.handleKeydown(def.id, e)}
        >
          <GripVertical size={18} aria-hidden="true" />
        </button>
      </li>
    {/each}
  </ul>
  <div class="available-head">
    <h3 class="caps-label section-label">Available</h3>
    <button
      type="button"
      class="btn btn-ghost rescan"
      disabled={controller.discovering}
      aria-busy={controller.discovering}
      onclick={() => controller.refreshCatalog()}
    >
      <RotateCw size={16} aria-hidden="true" />
      {controller.discovering ? 'Scanning' : 'Rescan'}
    </button>
  </div>
  {#if historyStatusMessage}
    <p
      class="scan-status"
      class:visually-hidden={controller.historyStatus === 'complete'}
      role="status"
    >
      {historyStatusMessage}
    </p>
  {/if}
  {#if availableGroups.length > 0}
    {#each availableGroups as group (group.id)}
      <h4 class="caps-label group-label">{group.title}</h4>
      <ul class="tile-list bare-list">
        {#each group.rows as def (def.id)}
          {@const title = optionTitle(def)}
          {@const historicalOnly = controller.isHistoricalOnly(def.id) && neverReported(def.paths)}
          {@const unavailable = neverReported(def.paths) &&
            !controller.isLiveDiscovered(def.id) &&
            !historicalOnly}
          {@const unavailableHint = historicalOnly
            ? 'Seen in history, but not reporting live now'
            : 'No data received from this sensor yet'}
          {@const hintId = historicalOnly || unavailable ? historyHintId(def.id) : undefined}
          <li
            class="row-interactive"
            class:unavailable
            title={historicalOnly || unavailable ? unavailableHint : undefined}
          >
            <LayerToggle
              {title}
              description={def.description}
              visible={false}
              onToggle={() => controller.toggleTile(def.id)}
              describedBy={hintId}
            />
            {#if historicalOnly}
              <span id={hintId} class="history-note">Previously seen, no live data</span>
            {:else if unavailable}
              <UnavailableHint id={hintId} hint={unavailableHint} />
            {/if}
          </li>
        {/each}
      </ul>
    {/each}
  {:else}
    <p class="muted-note empty-note">No other instruments found yet.</p>
  {/if}
</div>
<span class="visually-hidden" role="status">{reorder.reorderAnnouncement}</span>

<style>
.customize-list {
  flex: 1;
  overflow-y: auto;
  min-block-size: 0;
}
.section-label {
  padding: var(--space-2) var(--space-3) var(--space-1);
}
.section-label:first-child {
  padding-block-start: 0;
}
.available-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  padding-inline-end: var(--space-3);
}
.rescan {
  min-block-size: var(--row-size);
}
.group-label {
  padding: var(--space-1) var(--space-3);
}
.empty-note {
  padding: 0 var(--space-3) var(--space-2);
}
.scan-status {
  margin: 0;
  padding: 0 var(--space-3) var(--space-2);
  color: var(--text-muted);
  font-size: var(--text-sm);
}
.history-note {
  flex-shrink: 0;
  color: var(--text-muted);
  font-size: var(--text-xs);
  white-space: nowrap;
}
/* One line per row: the toggle grows, the grip sits inline at the trailing edge. Without this the
   block-flow row wraps the grip onto its own line and every selected row doubles in height. */
.tile-list li {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  padding-inline-end: var(--space-1);
}

/* The grip rest and lift, the drag feedback, and touch-action: none come from the shared
   .reorder-row (styles/reorder.css), the same vocabulary the layer rows use. */
</style>
