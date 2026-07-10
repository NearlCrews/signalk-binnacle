<script lang="ts">
import { LocateFixed, Trash2 } from '@lucide/svelte';
import type { UserChartSource, UserCharts } from '$entities/user-charts';
import { type Bbox4, formatBounds } from '$shared/geo';
import type { LayerListItem } from '$shared/map';
import { InlineConfirm, SubViewHeader, TextField } from '$shared/ui';
import ChartSpecList from './ChartSpecList.svelte';

interface Props {
  item: LayerListItem;
  userCharts?: UserCharts;
  userSource?: UserChartSource;
  onBack: () => void;
  onShowBounds?: (bounds: Bbox4) => void;
}

const { item, userCharts, userSource, onBack, onShowBounds }: Props = $props();

let confirming = $state(false);
// Not `name`: that shadows the global window.name, which the linter flags on reassignment.
let chartName = $state('');

const chart = $derived(item.chart);
const canEdit = $derived(userSource !== undefined && userCharts !== undefined);
const chartBounds = $derived(chart?.bounds ?? userSource?.bounds);
const chartUrl = $derived(chart?.url ?? userSource?.origin.url);
const chartKind = $derived.by(() => {
  if (chart?.kind === 'vector') return 'Vector';
  if (chart?.kind === 'raster') return 'Raster';
  if (chart?.kind === 'style') return 'Style';
  return 'Unknown';
});
const chartOrigin = $derived(chart?.source === 'user' ? 'User-added URL chart' : 'Signal K server');
const zoom = $derived.by(() => {
  const min = chart?.minzoom ?? userSource?.minzoom ?? 0;
  const max = chart?.maxzoom ?? userSource?.maxzoom ?? min;
  return `${min} to ${max}`;
});
const specRows = $derived([
  { label: 'Name', value: item.title },
  { label: 'Type', value: chartKind },
  { label: 'Origin', value: chartOrigin },
  ...(chartUrl ? [{ label: 'Source', value: chartUrl }] : []),
  { label: 'Zoom', value: zoom },
  { label: 'Bounds', value: chartBounds ? formatBounds(chartBounds) : 'Unknown' },
]);

// Seed the editable name from the user source when this is an imported chart. Server charts are
// read-only, but keeping the same value gives the detail one name source for its form state.
$effect(() => {
  chartName = userSource?.name ?? item.title;
});

function saveName(): void {
  if (!canEdit || !userSource || !userCharts) return;
  const trimmed = chartName.trim();
  if (trimmed && trimmed !== userSource.name) userCharts.rename(userSource.id, trimmed);
}

function doDelete(): void {
  if (!userSource || !userCharts) return;
  // Capture the id before onBack: onBack clears the panel's detail id, which can remove the live
  // userSource prop before the delete runs.
  const { id } = userSource;
  onBack();
  userCharts.remove(id);
}
</script>

<div class="detail">
  <SubViewHeader title="Chart detail" backLabel="Back to layers" {onBack} />

  {#if canEdit}
    <TextField
      variant="stacked"
      label="Name"
      value={chartName}
      ariaLabel="Chart name"
      onCommit={(value) => {
        chartName = value;
        saveName();
      }}
    />
  {/if}

  <ChartSpecList rows={specRows} />

  {#if chartBounds}
    <button type="button" class="btn" onclick={() => onShowBounds?.(chartBounds)}>
      <LocateFixed size={16} aria-hidden="true" />
      Show chart area
    </button>
  {/if}

  {#if canEdit}
    {#if confirming}
      <InlineConfirm
        question="Delete this chart?"
        onConfirm={doDelete}
        onCancel={() => (confirming = false)}
      />
    {:else}
      <button type="button" class="btn btn-danger" onclick={() => (confirming = true)}>
        <Trash2 size={16} aria-hidden="true" />
        Delete chart
      </button>
    {/if}
  {/if}
</div>

<style>
.detail {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  font-size: var(--text-sm);
}
</style>
