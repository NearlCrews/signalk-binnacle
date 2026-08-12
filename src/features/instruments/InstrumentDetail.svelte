<script lang="ts">
import { tick } from 'svelte';
import { recentSourceRefs, sourceCue, type ZoneState } from '$shared/signalk';
import { SubViewHeader } from '$shared/ui';
import { primaryPathFor, type TileDef, type TileDeps, type TileReading } from './tile-catalog';

interface Props {
  def: TileDef;
  // The name shown on the tile, which the server's meta displayName can replace. Always supplied by
  // the panel, so the detail heading and the tile it was opened from cannot disagree.
  label: string;
  deps: TileDeps;
  reading: TileReading;
  zone: ZoneState;
  historicalOnly?: boolean;
  onBack: () => void;
  onViewTrend?: () => void;
  restoreTrendFocus?: boolean;
  onTrendFocusRestored?: () => void;
}

const {
  def,
  label,
  deps,
  reading,
  zone,
  historicalOnly = false,
  onBack,
  onViewTrend,
  restoreTrendFocus = false,
  onTrendFocusRestored,
}: Props = $props();
let trendAction: HTMLButtonElement | undefined = $state();

$effect(() => {
  if (!restoreTrendFocus || !trendAction) return;
  void tick().then(() => {
    trendAction?.focus();
    onTrendFocusRestored?.();
  });
});

const valueLine = $derived(
  `${reading.value}${reading.unit ? ` ${reading.unit}` : ''}${
    reading.referenceLabel ? ` (${reading.referenceLabel})` : ''
  }`,
);

function ageLabel(epoch: number): string {
  if (epoch === 0) return 'Never';
  const seconds = Math.max(0, Math.round((deps.clock.now - epoch) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ago`;
}

const primaryPath = $derived(primaryPathFor(deps, def, reading));
const primaryCell = $derived(primaryPath ? deps.store.cell(primaryPath) : undefined);

const sourceLabel = $derived(
  def.paths.length === 0 ? 'Computed in Binnacle' : (primaryCell?.source?.label ?? 'Unknown'),
);
// The recent-handoff cue for the shown value's own path (never a cross-reference comparison).
// Signal K remains the source authority; this only reports what the server sent recently.
const cue = $derived(primaryCell ? sourceCue(primaryCell.sourceTrace, deps.clock.now) : undefined);
const cueText = $derived.by(() => {
  if (cue === undefined) return undefined;
  if (cue.kind === 'changed') {
    return `Source changed ${ageLabel(cue.atEpoch)}: ${cue.from} to ${cue.to}.`;
  }
  return `Multiple recent sources: ${cue.labels.join(', ')}.`;
});
// While the server declares the path timed out, age from the last good value's own epoch (the
// declaration itself is not an update); with no declaration the fallback is the same epoch.
const age = $derived(
  primaryCell
    ? ageLabel(primaryCell.serverStale?.lastValueEpoch ?? primaryCell.epoch)
    : 'Not streamed',
);
// Both stale flavors answer the navigator's question identically, so the badge stays plain
// "Stale"; who noticed first belongs in the explanation sentence below, not in the label.
const stateLabel = $derived.by(() => {
  if (reading.state === 'live') return 'Live';
  if (reading.state === 'stale') return 'Stale';
  return reading.state === 'placeholder' ? 'Reported blank' : 'No report';
});
// The server's own staleness declaration, and which source went quiet when it named one.
const staleSourceNote = $derived.by(() => {
  if (primaryCell?.serverStale === undefined) return undefined;
  const ref = primaryCell.serverStale.sourceRef;
  const lead = 'The Signal K server reports this sensor stopped updating.';
  return ref ? `${lead} No update from ${ref}.` : lead;
});
// What each recent source reports, neutrally: values and ages, no disagreement judgment. Signal K
// remains the source authority. Values re-read through the 1 Hz clock (the age text forces it);
// the revision covers a source appearing or retiring. The formatter applies only when the shown
// path is the def's canonical unit-bearing one (zonesPath): a fallback-chain def can resolve onto
// a path in different units, and a mis-unit number is worse than source and age alone.
const EMPTY_SOURCE_ROWS: Array<{ ref: string; text?: string; age: string }> = [];
const sourceRows = $derived.by(() => {
  const samples = primaryCell?.sourceSamples;
  if (!primaryCell || samples === undefined) return EMPTY_SOURCE_ROWS;
  void primaryCell.sourceSamplesRevision;
  const refs = recentSourceRefs(samples, deps.clock.now);
  if (refs.length === 0) return EMPTY_SOURCE_ROWS;
  const format = primaryPath === def.zonesPath ? def.formatSample : undefined;
  return refs.map((ref) => {
    const sample = samples.get(ref);
    return {
      ref,
      text: sample !== undefined ? format?.(sample.value, deps) : undefined,
      age: ageLabel(sample?.epoch ?? 0),
    };
  });
});
const zoneLabel = $derived(zone === 'alarm' ? 'Alarm' : zone === 'warning' ? 'Warning' : 'Normal');
</script>

<div class="detail">
  <SubViewHeader title={label} backLabel="Back to instruments" {onBack} />

  <p class="muted-note">{def.description}</p>
  {#if historicalOnly}
    <p class="muted-note">Previously recorded, but not reporting live now.</p>
  {/if}

  <dl class="stat-grid">
    <dt>Value</dt>
    <dd><span class="num">{valueLine}</span><span class="unit"></span></dd>
    {#if reading.secondary}
      <dt>Detail</dt>
      <dd><span>{reading.secondary}</span><span class="unit"></span></dd>
    {/if}
    <dt>Status</dt>
    <dd><span>{stateLabel}</span><span class="unit"></span></dd>
    <dt>Zone</dt>
    <dd><span>{zoneLabel}</span><span class="unit"></span></dd>
    <dt>Source</dt>
    <dd><span>{sourceLabel}</span><span class="unit"></span></dd>
    <dt>Updated</dt>
    <dd><span>{age}</span><span class="unit"></span></dd>
  </dl>

  {#if staleSourceNote}
    <p class="muted-note" role="status">{staleSourceNote}</p>
  {/if}

  {#if cueText}
    <p class="muted-note" role="status">{cueText}</p>
  {/if}

  {#if sourceRows.length > 0}
    <section class="sources" aria-label="Recent sources">
      <h3 class="caps-label">Recent sources</h3>
      <ul class="bare-list source-list">
        {#each sourceRows as row (row.ref)}
          <li>
            <span class="path">{row.ref}</span>
            <span class="path-meta">{row.text ? `${row.text}, ` : ''}{row.age}</span>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if onViewTrend}
    <button
      bind:this={trendAction}
      type="button"
      class="btn btn-primary trend-action"
      onclick={onViewTrend}
    >
      View recent trend
    </button>
  {/if}

  <section class="paths" aria-label="Signal K paths">
    <h3 class="caps-label">Signal K paths</h3>
    <ul class="bare-list path-list">
      {#if def.paths.length === 0}
        <li class="muted-note">Computed from the active course, vessel position, and speed.</li>
      {:else}
        {#each def.paths as path (path)}
          {@const cell = deps.store.cell(path)}
          <li>
            <span class="path">{path}</span>
            <span class="path-meta">{ageLabel(cell.epoch)}</span>
          </li>
        {/each}
      {/if}
    </ul>
  </section>
</div>

<style>
.detail {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: 0 var(--space-3) var(--space-3);
  overflow-y: auto;
}
.paths,
.sources {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.paths h3,
.sources h3 {
  margin: 0;
}
.trend-action {
  min-block-size: 44px;
  inline-size: 100%;
}
.path-list,
.source-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.path-list li,
.source-list li {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  padding-block: var(--space-1);
  border-block-start: 1px solid var(--border);
}
.path {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  overflow-wrap: anywhere;
}
.path-meta {
  color: var(--text-muted);
  font-size: var(--text-xs);
}
</style>
