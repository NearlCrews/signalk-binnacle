<script lang="ts">
import { X } from '@lucide/svelte';
import { registerDismiss } from '$shared/ui';
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
  grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr));
  gap: var(--space-2);
  align-content: start;
  flex: 1;
  overflow-y: auto;
  padding: var(--space-2) var(--space-3);
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
}
</style>
