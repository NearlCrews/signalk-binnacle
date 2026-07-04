<script lang="ts">
import { GripVertical, X } from '@lucide/svelte';
import { untrack } from 'svelte';
import { createReorder, LayerToggle, registerDismiss, UnavailableHint } from '$shared/ui';
import type { InstrumentsController } from './instruments-controller.svelte';
import NumericTile from './NumericTile.svelte';
import type { TileDeps } from './tile-catalog';
import { TILE_CATALOG } from './tile-catalog';
import WindTile from './WindTile.svelte';

interface Props {
  controller: InstrumentsController;
  deps: TileDeps;
  // Exposed for SSR testing only; seeds the initial customizing state.
  customizing?: boolean;
}

const { controller, deps, customizing: initCustomizing = false }: Props = $props();

// untrack: intentionally seeds from the prop's initial value only; prop exists for SSR testing.
let customizing = $state(untrack(() => initCustomizing));

const FULLSCREEN_BREAKPOINT_PX = 900;
// Paired with the @media (max-width: 900px) block below: mirrors the CSS breakpoint so the
// close-button label matches the panel's visual mode (dock vs. full-screen overlay).
let fullscreenQueryMatches = $state(false);
if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
  const query = window.matchMedia(`(max-width: ${FULLSCREEN_BREAKPOINT_PX}px)`);
  fullscreenQueryMatches = query.matches;
  query.addEventListener('change', (e: MediaQueryListEvent) => {
    fullscreenQueryMatches = e.matches;
  });
}

// Register with the shared Escape stack while open, so one Escape closes only the topmost surface.
$effect(() => {
  if (!controller.open) return;
  return registerDismiss(() => controller.setOpen(false));
});

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

<aside class="instruments" aria-label="Instruments" tabindex="-1">
  <header class="panel-header">
    <h2 class="panel-title">Instruments</h2>
    <button
      type="button"
      class="btn btn-ghost customize"
      onclick={() => (customizing = !customizing)}
    >
      {customizing ? 'Done' : 'Customize'}
    </button>
    <button
      type="button"
      class="icon-btn panel-close"
      aria-label={fullscreenQueryMatches
        ? 'Close instruments, return to chart'
        : 'Close instruments dock'}
      onclick={() => controller.setOpen(false)}
    >
      <X size={18} aria-hidden="true" />
    </button>
  </header>
  {#if customizing}
    <ul class="tile-list" bind:this={listEl}>
      {#each TILE_CATALOG as def (def.id)}
        {@const selected = controller.selectedIds.includes(def.id)}
        {@const neverReported = deps.store.cell(def.zonesPath).epoch === 0}
        <li data-tile-row={def.id} class="row-interactive" class:is-on={selected}>
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
  {:else}
    <div class="tiles">
      {#each controller.tiles as def (def.id)}
        {@const reading = def.read(deps)}
        {@const zone = controller.zoneState(def, reading.siValue)}
        {#if def.kind === 'wind'}
          <WindTile label={def.label} {reading} {zone} sensorGloss={def.sensorGloss} />
        {:else}
          <NumericTile label={def.label} {reading} {zone} sensorGloss={def.sensorGloss} />
        {/if}
      {/each}
    </div>
  {/if}
</aside>

<style>
.instruments {
  inline-size: clamp(16rem, 24vw, 22rem);
  border-inline-start: 1px solid var(--border);
  display: flex;
  flex-direction: column;
}

.tiles {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  overflow-y: auto;
}

.tile-list {
  list-style: none;
  margin: 0;
  padding: 0;
  flex: 1;
  overflow-y: auto;
}

/* Push the close button flush to the end; Customize sits between title and close. */
.customize {
  margin-inline-end: auto;
}

@media (max-width: 900px) {
  .instruments {
    position: fixed;
    inset: 0;
    z-index: var(--z-panel);
    inline-size: auto;
    background: var(--surface);
  }

  .tiles {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr));
  }
}
</style>
