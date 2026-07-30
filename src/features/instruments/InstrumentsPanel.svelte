<script lang="ts">
import { untrack } from 'svelte';
import { CustomizeToggle, dialog, PanelHeader, trapFocus } from '$shared/ui';
import InstrumentDetail from './InstrumentDetail.svelte';
import InstrumentsCustomize from './InstrumentsCustomize.svelte';
import type { InstrumentsController } from './instruments-controller.svelte';
import NumericTile from './NumericTile.svelte';
import type { TileDeps } from './tile-catalog';
import { createTileHistory } from './tile-history.svelte';
import WindTile from './WindTile.svelte';

interface Props {
  controller: InstrumentsController;
  deps: TileDeps;
  initialDetailId?: string;
  restoreTrendFocusId?: string;
  onViewTrend?: (id: string) => void;
  onTrendFocusRestored?: () => void;
  fullscreen?: boolean;
}

const {
  controller,
  deps,
  initialDetailId,
  restoreTrendFocusId,
  onViewTrend,
  onTrendFocusRestored,
  fullscreen = false,
}: Props = $props();

let customizing = $state(false);
let detailId = $state<string | undefined>();
$effect(() => {
  if (initialDetailId && detailId === undefined) detailId = initialDetailId;
});

// Hoisted so the tile selection resolves (validate the persisted ids, scan the catalog) once per
// real change instead of once per clock tick: both the effect below and the template read this.
const tiles = $derived(controller.tiles);
const detailDef = $derived(detailId ? tiles.find((def) => def.id === detailId) : undefined);

// Session-only sparkline history: sampled here on the shared reactive clock so the buffers only
// accumulate while the dock is mounted, matching the subscription lifecycle. The reads are
// untracked so the effect re-runs on the 1 Hz clock and selection changes, not on every delta
// flush; the 5 s sample spacing makes up to a second of staleness invisible.
const history = createTileHistory();
$effect(() => {
  const now = deps.clock.now;
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- local scratch set, never rendered
  const liveIds = new Set<string>();
  for (const def of tiles) {
    if (def.viz !== 'spark') continue;
    liveIds.add(def.id);
    history.sample(
      def.id,
      untrack(() => def.read(deps).siValue),
      now,
    );
  }
  history.prune(liveIds);
});
</script>

<!-- biome-ignore lint/a11y/useAriaPropsSupportedByRole: the dynamic role is dialog exactly when aria-modal is defined. -->
<aside
  class="instruments"
  role={fullscreen ? 'dialog' : undefined}
  aria-label="Instruments"
  aria-modal={fullscreen ? 'true' : undefined}
  tabindex="-1"
  use:dialog={() => controller.setOpen(false)}
  use:trapFocus={fullscreen}
>
  <PanelHeader
    title="Instruments"
    closeLabel={fullscreen ? 'Close instruments, return to chart' : 'Close instruments dock'}
    onClose={() => controller.setOpen(false)}
  >
    {#snippet headerExtra()}
      <CustomizeToggle
        object="instruments"
        editing={customizing}
        compact
        onToggle={() => {
          detailId = undefined;
          customizing = !customizing;
        }}
      />
    {/snippet}
  </PanelHeader>
  {#if detailDef}
    {@const reading = detailDef.read(deps)}
    {@const zone = controller.zoneState(detailDef, reading.siValue)}
    <InstrumentDetail
      def={detailDef}
      label={controller.resolvedLabel(detailDef)}
      {deps}
      {reading}
      {zone}
      historicalOnly={controller.isHistoricalOnly(detailDef.id) &&
        detailDef.paths.every((path) => deps.store.cell(path).epoch === 0)}
      onBack={() => (detailId = undefined)}
      onViewTrend={controller.trendDescriptor(detailDef.id) && onViewTrend
        ? () => onViewTrend(detailDef.id)
        : undefined}
      restoreTrendFocus={restoreTrendFocusId === detailDef.id}
      {onTrendFocusRestored}
    />
  {:else if customizing}
    <div class="customize-instruction">
      <span class="muted-note">Tap an instrument to show or hide. Drag to reorder.</span>
    </div>
    <InstrumentsCustomize {controller} {deps} />
  {:else}
    <div class="tiles">
      {#if tiles.length === 0}
        <p class="muted-note empty">No instruments shown. Use Customize to add one.</p>
      {/if}
      {#each tiles as def (def.id)}
        {@const reading = def.read(deps)}
        {@const zone = controller.zoneState(def, reading.siValue)}
        {#if def.kind === 'wind'}
          <WindTile
            label={controller.resolvedLabel(def)}
            {reading}
            {zone}
            sensorGloss={def.sensorGloss}
            kind={def.kind}
            abbr={def.abbr}
            onOpen={() => (detailId = def.id)}
          />
        {:else}
          <NumericTile
            label={controller.resolvedLabel(def)}
            {reading}
            {zone}
            sensorGloss={def.sensorGloss}
            kind={def.kind}
            abbr={def.abbr}
            viz={def.viz}
            sparkPoints={def.viz === 'spark' ? history.series(def.id) : undefined}
            onOpen={() => (detailId = def.id)}
          />
        {/if}
      {/each}
    </div>
  {/if}
</aside>

<style>
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
.empty {
  grid-column: 1 / -1;
  align-self: start;
}

.customize-instruction {
  padding: 0 var(--space-3) var(--space-2);
}
</style>
