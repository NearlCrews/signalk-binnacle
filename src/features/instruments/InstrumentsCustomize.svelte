<script lang="ts">
import { GripVertical } from '@lucide/svelte';
import { createReorder, LayerToggle, UnavailableHint } from '$shared/ui';
import type { InstrumentsController } from './instruments-controller.svelte';
import type { TileDeps } from './tile-catalog';

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

const reorder = createReorder({
  getItems: () => shown.map((t) => ({ id: t.id, title: t.label })),
  getListEl: () => listEl,
  commit: (id, slot) => controller.reorderTile(id, slot),
  rowAttribute: 'data-tile-row',
  handleSelector: '.handle',
  itemNoun: 'Tile',
});

function neverReported(paths: string[]): boolean {
  return paths.length > 0 && paths.every((p) => deps.store.cell(p).epoch === 0);
}
</script>

<!-- The reorder controller measures rows and listens for scroll on this element, so it is the one
     scroll container over both sections and it holds the data-tile-row rows (the shown list). -->
<div class="customize-list" bind:this={listEl}>
  <h3 class="caps-label section-label">Shown</h3>
  <ul class="tile-list">
    {#each shown as def, i (def.id)}
      {@const indicator = reorder.indicatorFor(def.id)}
      <li
        data-tile-row={def.id}
        class="row-interactive reorder-row is-on"
        class:dragging={reorder.dragId === def.id}
        class:drop-before={indicator.before}
        class:drop-after={indicator.after}
      >
        <LayerToggle
          title={def.label}
          description={def.description}
          visible={true}
          onToggle={() => controller.toggleTile(def.id)}
        />
        <button
          type="button"
          class="icon-btn handle"
          aria-label={`Move ${def.label}, position ${i + 1} of ${shown.length}`}
          aria-keyshortcuts="ArrowUp ArrowDown"
          onpointerdown={(e) => reorder.handlePointerDown(def.id, e)}
          onkeydown={(e) => reorder.handleKeydown(def.id, e)}
        >
          <GripVertical size={18} aria-hidden="true" />
        </button>
      </li>
    {/each}
  </ul>
  {#if available.length > 0}
    <h3 class="caps-label section-label">Available</h3>
    <ul class="tile-list">
      {#each available as def (def.id)}
        {@const unavailable = neverReported(def.paths)}
        <li
          class="row-interactive"
          class:unavailable
          title={unavailable ? 'No data received from this sensor yet' : undefined}
        >
          <LayerToggle
            title={def.label}
            description={def.description}
            visible={false}
            onToggle={() => controller.toggleTile(def.id)}
          />
          {#if unavailable}
            <UnavailableHint hint="No data received from this sensor yet" />
          {/if}
        </li>
      {/each}
    </ul>
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
.tile-list {
  list-style: none;
  margin: 0;
  padding: 0;
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
