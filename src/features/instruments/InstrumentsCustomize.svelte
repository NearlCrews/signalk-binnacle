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

const reorder = createReorder({
  getItems: () => controller.tiles.map((t) => ({ id: t.id, title: t.label })),
  getListEl: () => listEl,
  commit: (id, slot) => controller.reorderTile(id, slot),
  rowAttribute: 'data-tile-row',
  handleSelector: '.handle',
  itemNoun: 'Tile',
});
</script>

<ul class="tile-list" bind:this={listEl}>
  {#each controller.catalog as def (def.id)}
    {@const selected = controller.selectedIds.includes(def.id)}
    {@const neverReported =
      def.paths.length > 0 && def.paths.every((p) => deps.store.cell(p).epoch === 0)}
    <li
      data-tile-row={selected ? def.id : undefined}
      class="row-interactive"
      class:is-on={selected}
      class:unavailable={neverReported}
      title={neverReported ? 'No data received from this sensor yet' : undefined}
    >
      <LayerToggle
        title={def.label}
        description={def.description}
        visible={selected}
        onToggle={() => controller.toggleTile(def.id)}
      />
      {#if neverReported}
        <UnavailableHint hint="No data received from this sensor yet" />
      {/if}
      {#if selected}
        <button
          type="button"
          class="icon-btn handle"
          aria-label="Reorder {def.label}"
          onpointerdown={(e) => reorder.handlePointerDown(def.id, e)}
          onkeydown={(e) => reorder.handleKeydown(def.id, e)}
        >
          <GripVertical size={16} aria-hidden="true" />
        </button>
      {/if}
    </li>
  {/each}
</ul>
<span class="visually-hidden" role="status">{reorder.reorderAnnouncement}</span>

<style>
.tile-list {
  list-style: none;
  margin: 0;
  padding: 0;
  flex: 1;
  overflow-y: auto;
}

/* One line per row: the toggle grows, the grip sits inline at the trailing edge. Without this the
   block-flow row wraps the grip onto its own line and every selected row doubles in height. */
.tile-list li {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  padding-inline-end: var(--space-1);
}

/* Mirror LayerRow's unavailable treatment: gray out rows for sensors that have never reported. */
.tile-list .unavailable {
  opacity: 0.65;
}
</style>
