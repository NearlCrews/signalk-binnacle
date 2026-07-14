<script lang="ts">
import type { ZoneState } from '$shared/signalk';
import { SubViewHeader } from '$shared/ui';
import type { TileDef, TileDeps, TileReading } from './tile-catalog';

interface Props {
  def: TileDef;
  deps: TileDeps;
  reading: TileReading;
  zone: ZoneState;
  historicalOnly?: boolean;
  onBack: () => void;
}

const { def, deps, reading, zone, historicalOnly = false, onBack }: Props = $props();

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

const primaryCell = $derived.by(() => {
  const live = def.paths.map((path) => deps.store.cell(path)).find((cell) => cell.epoch > 0);
  return live ?? (def.paths[0] ? deps.store.cell(def.paths[0]) : undefined);
});

const sourceLabel = $derived(
  def.paths.length === 0 ? 'Computed in Binnacle' : (primaryCell?.source?.label ?? 'Unknown'),
);
const age = $derived(primaryCell ? ageLabel(primaryCell.epoch) : 'Not streamed');
const stateLabel = $derived(
  reading.state === 'live'
    ? 'Live'
    : reading.state === 'stale'
      ? 'Stale'
      : reading.state === 'placeholder'
        ? 'Reported blank'
        : 'No report',
);
const zoneLabel = $derived(zone === 'alarm' ? 'Alarm' : zone === 'warning' ? 'Warning' : 'Normal');
</script>

<div class="detail">
  <SubViewHeader title={def.label} backLabel="Back to instruments" {onBack} />

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
.paths {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.paths h3 {
  margin: 0;
}
.path-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.path-list li {
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
