<script lang="ts">
import { CustomizeToggle, PanelHeader, registerDismiss } from '$shared/ui';
import InstrumentsCustomize from './InstrumentsCustomize.svelte';
import type { InstrumentsController } from './instruments-controller.svelte';
import NumericTile from './NumericTile.svelte';
import type { TileDeps } from './tile-catalog';
import WindTile from './WindTile.svelte';

interface Props {
  controller: InstrumentsController;
  deps: TileDeps;
}

const { controller, deps }: Props = $props();

let customizing = $state(false);

const FULLSCREEN_BREAKPOINT_PX = 900;
// Paired with the @media (max-width: 900px) block below: mirrors the CSS breakpoint so the
// close-button label matches the panel's visual mode (dock vs. full-screen overlay). Listener
// lives in an effect with cleanup: the panel is conditionally mounted, so a bare listener would
// accumulate one copy per open cycle.
let fullscreenQueryMatches = $state(false);
$effect(() => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
  const query = window.matchMedia(`(max-width: ${FULLSCREEN_BREAKPOINT_PX}px)`);
  fullscreenQueryMatches = query.matches;
  const handler = (e: MediaQueryListEvent) => {
    fullscreenQueryMatches = e.matches;
  };
  query.addEventListener('change', handler);
  return () => query.removeEventListener('change', handler);
});

// Register with the shared Escape stack while open, so one Escape closes only the topmost surface.
$effect(() => {
  if (!controller.open) return;
  return registerDismiss(() => controller.setOpen(false));
});
</script>

<aside class="instruments" aria-label="Instruments" tabindex="-1">
  <PanelHeader
    title="Instruments"
    closeLabel={fullscreenQueryMatches
      ? 'Close instruments, return to chart'
      : 'Close instruments dock'}
    onClose={() => controller.setOpen(false)}
  >
    {#snippet headerExtra()}
      <CustomizeToggle
        object="instruments"
        editing={customizing}
        onToggle={() => (customizing = !customizing)}
      />
    {/snippet}
  </PanelHeader>
  {#if customizing}
    <div class="customize-instruction">
      <span class="muted-note">Tap an instrument to show or hide. Drag to reorder.</span>
    </div>
    <InstrumentsCustomize {controller} {deps} />
  {:else}
    <div class="tiles">
      {#each controller.tiles as def (def.id)}
        {@const reading = def.read(deps)}
        {@const zone = controller.zoneState(def, reading.siValue)}
        {#if def.kind === 'wind'}
          <WindTile
            label={def.label}
            {reading}
            {zone}
            sensorGloss={def.sensorGloss}
            kind={def.kind}
            abbr={def.abbr}
          />
        {:else}
          <NumericTile
            label={def.label}
            {reading}
            {zone}
            sensorGloss={def.sensorGloss}
            kind={def.kind}
            abbr={def.abbr}
          />
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
  display: grid;
  /* The 40% arm caps the full-screen phone layout at two readable columns (and one column on a
     very narrow phone), while staying under the 9rem floor inside the 16-22rem dock. */
  grid-template-columns: repeat(auto-fill, minmax(max(9rem, 40%), 1fr));
  /* Dense flow backfills the hole a wide tile leaves after a lone half tile; rows split the
     leftover dock height so the grid spans the dock, collapsing to min-content (and the existing
     scroll) when the tile set outgrows it. */
  grid-auto-flow: row dense;
  grid-auto-rows: minmax(min-content, 1fr);
  gap: var(--space-2);
  flex: 1;
  overflow-y: auto;
  padding: var(--space-2) var(--space-3);
}

.customize-instruction {
  padding: 0 var(--space-3) var(--space-2);
}

@media (max-width: 900px) {
  .instruments {
    position: fixed;
    inset: 0;
    z-index: var(--z-panel);
    inline-size: auto;
    background: var(--surface);
  }
}
</style>
