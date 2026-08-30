<script lang="ts">
import { type Snippet, untrack } from 'svelte';
import { CustomizeToggle, dialog, PanelHeader, trapFocus } from '$shared/ui';
import InstrumentDetail from './InstrumentDetail.svelte';
import InstrumentsCustomize from './InstrumentsCustomize.svelte';
import type { InstrumentsController } from './instruments-controller.svelte';
import NumericTile from './NumericTile.svelte';
import { staleAgeText, type TileDeps } from './tile-catalog';
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
  // The emergency action the shell injects (the MOB trigger): while the panel is a full-screen
  // modal, aria-modal removes the topbar from the accessibility tree, so the trigger must live
  // inside the dialog subtree. Injected rather than imported so instruments never reaches into
  // the mob feature.
  emergencyAction?: Snippet;
}

const {
  controller,
  deps,
  initialDetailId,
  restoreTrendFocusId,
  onViewTrend,
  onTrendFocusRestored,
  fullscreen = false,
  emergencyAction,
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

<!-- biome-ignore lint/a11y/useAriaPropsSupportedByRole: the dynamic role is always complementary or dialog, and aria-modal is present only for dialog. -->
<div
  class="instruments"
  role={fullscreen ? 'dialog' : 'complementary'}
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
      {#if fullscreen && emergencyAction}
        {@render emergencyAction()}
      {/if}
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
        {@const staleAge = staleAgeText(deps, def, reading)}
        {#if def.kind === 'wind'}
          <WindTile
            label={controller.resolvedLabel(def)}
            {reading}
            {zone}
            sensorGloss={def.sensorGloss}
            kind={def.kind}
            abbr={def.abbr}
            staleAgeText={staleAge}
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
            staleAgeText={staleAge}
            onOpen={() => (detailId = def.id)}
          />
        {/if}
      {/each}
    </div>
  {/if}
</div>

<style>
.tiles {
  display: grid;
  /* The 40% arm caps the full-screen phone layout at two readable columns (and one column on a
     very narrow phone), while staying under the 9rem floor inside the 16-22rem dock. */
  grid-template-columns: repeat(auto-fill, minmax(max(9rem, 40%), 1fr));
  /* Not dense: a full-row tile after a lone half tile leaves a hole, and dense fills it by pulling
     a later narrow tile backward, which Tab (DOM order) does not follow. The gap costs a little
     space; a tab order that disagrees with the visual order costs a keyboard navigator the dock.
     Rows split the leftover dock height so the grid spans the dock, collapsing to min-content (and
     the existing scroll) when the tile set outgrows it. */
  grid-auto-flow: row;
  grid-auto-rows: minmax(min-content, 1fr);
  gap: var(--space-2);
  flex: 1;
  overflow-y: auto;
  padding: var(--space-2) var(--space-3);
}
@media (max-width: 900px) {
  /* The full-screen dock sits under the floating safety rail; reserving the rail's measured
     clearance in the scroll area keeps the last tile row reachable during an alert. 0px when
     quiet, so the reserve costs nothing on a calm watch. */
  .tiles {
    padding-block-end: calc(var(--space-2) + var(--rail-clearance, 0px));
  }
}
.empty {
  grid-column: 1 / -1;
  align-self: start;
}

.customize-instruction {
  padding: 0 var(--space-3) var(--space-2);
}
</style>
