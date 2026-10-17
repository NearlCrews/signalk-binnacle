<script lang="ts">
import GripVertical from '@lucide/svelte/icons/grip-vertical';
import RotateCw from '@lucide/svelte/icons/rotate-cw';
import {
  CustomizeCategory,
  createReorder,
  EmptyState,
  LayerToggle,
  ReorderActions,
  UnavailableHint,
} from '$shared/ui';
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

// One announcement per discovery state. A table rather than a chain, so adding a state is one entry
// and an unhandled one announces nothing rather than borrowing its neighbor's wording.
const HISTORY_STATUS_MESSAGES: Partial<Record<string, string>> = {
  checking: 'Checking for recorded instruments.',
  scanning: 'Scanning recorded instruments.',
  complete: 'Recorded instruments scanned.',
  partial: 'Some recorded instruments could not be scanned. Accepted results were retained.',
  failed: 'Recorded instruments could not be scanned. Live instruments are still available.',
  unavailable: 'No history provider is available. Showing live instruments.',
};
const historyStatusMessage = $derived(HISTORY_STATUS_MESSAGES[controller.historyStatus] ?? '');
</script>

<!-- The reorder controller measures rows and listens for scroll on this element, so it is the one
     scroll container over both sections and it holds the data-tile-row rows (the shown list). -->
<div class="customize-list" bind:this={listEl}>
  <div class="customize-head">
    <h3 class="caps-label">Shown</h3>
  </div>
  <ul class="tile-list bare-list">
    {#each shown as def, i (def.id)}
      {@const indicator = reorder.indicatorFor(def.id)}
      {@const title = optionTitle(def)}
      {@const historicalOnly = controller.isHistoricalOnly(def.id) && neverReported(def.paths)}
      {@const hintId = historicalOnly ? historyHintId(def.id) : undefined}
      <li
        data-tile-row={def.id}
        class="row-interactive reorder-row reorder-line is-on"
        class:dragging={reorder.dragId === def.id}
        class:drop-before={indicator.before}
        class:drop-after={indicator.after}
      >
        <LayerToggle
          label={title}
          description={def.description}
          visible={true}
          onToggle={() => controller.toggleTile(def.id)}
          describedBy={hintId}
        />
        {#if historicalOnly}
          <span id={hintId} class="row-note">Previously seen, no live data</span>
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
        <ReorderActions
          label={title}
          canMoveUp={reorder.canMove(def.id, -1)}
          canMoveDown={reorder.canMove(def.id, 1)}
          onMove={(direction) => reorder.moveBy(def.id, direction)}
        />
      </li>
    {/each}
  </ul>
  <div class="customize-head">
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
  {#if historyStatusMessage}
    <p
      class="muted-note scan-status"
      class:visually-hidden={controller.historyStatus === 'complete'}
      role="status"
    >
      {historyStatusMessage}
    </p>
  {/if}
  {#if availableGroups.length > 0}
    {#each availableGroups as group (group.id)}
      <CustomizeCategory id={`instrument-category-${group.id}`} label={group.title}>
        <ul class="tile-list bare-list">
          {#each group.rows as def (def.id)}
            {@const title = optionTitle(def)}
            {@const historicalOnly =
              controller.isHistoricalOnly(def.id) && neverReported(def.paths)}
            {@const unavailable =
              neverReported(def.paths) && !controller.isLiveDiscovered(def.id) && !historicalOnly}
            {@const unavailableHint = historicalOnly
              ? 'Seen in history, but not reporting live now'
              : 'No data received from this sensor yet'}
            {@const hintId = historicalOnly || unavailable ? historyHintId(def.id) : undefined}
            <li
              class="row-interactive reorder-line"
              class:unavailable
              title={historicalOnly || unavailable ? unavailableHint : undefined}
            >
              <LayerToggle
                label={title}
                description={def.description}
                visible={false}
                onToggle={() => controller.toggleTile(def.id)}
                describedBy={hintId}
              />
              {#if historicalOnly}
                <span id={hintId} class="row-note">Previously seen, no live data</span>
              {:else if unavailable}
                <UnavailableHint id={hintId} hint={unavailableHint} />
              {/if}
            </li>
          {/each}
        </ul>
      </CustomizeCategory>
    {/each}
  {:else}
    <div class="empty-note">
      <EmptyState
        title="No other instruments"
        message="Instruments appear here as the server publishes their readings."
      />
    </div>
  {/if}
</div>
<span class="visually-hidden" role="status">{reorder.reorderAnnouncement}</span>

<style>
.customize-list {
  flex: 1;
  overflow-y: auto;
  min-block-size: 0;
}
.empty-note,
.scan-status {
  padding: 0 var(--space-3) var(--space-2);
}
/* The line, its note, the section heads, the grip rest and lift, and the drag feedback come from the
   shared reorder vocabulary (styles/reorder.css), the same one the trend list and layer rows use. */
</style>
