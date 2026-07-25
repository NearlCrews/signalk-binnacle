<script lang="ts">
import LocateFixed from '@lucide/svelte/icons/locate-fixed';
import Trash2 from '@lucide/svelte/icons/trash-2';
import {
  MAX_USER_CHART_NAME_LENGTH,
  shouldShareUserChart,
  type UserChartSource,
  type UserCharts,
  userChartNeedsServerDelete,
  userChartUrlForDisplay,
} from '$entities/user-charts';
import { type Bbox4, formatBounds } from '$shared/geo';
import type { LayerListItem } from '$shared/map';
import { InlineConfirm, SubViewHeader, TextField } from '$shared/ui';
import ChartSpecList from './ChartSpecList.svelte';

interface Props {
  item: LayerListItem;
  userCharts?: UserCharts;
  userSource?: UserChartSource;
  writeBlocked?: boolean;
  onBack: () => void;
  onShowBounds?: (bounds: Bbox4) => void;
}

const {
  item,
  userCharts,
  userSource,
  writeBlocked = false,
  onBack,
  onShowBounds,
}: Props = $props();

let confirming = $state(false);
// Not `name`: that shadows the global window.name, which the linter flags on reassignment.
let chartName = $derived(userSource?.name ?? item.title);

const chart = $derived(item.chart);
const canEdit = $derived(userSource !== undefined && userCharts !== undefined);
const renameBlocked = $derived(
  writeBlocked && userSource !== undefined && shouldShareUserChart(userSource),
);
const deleteBlocked = $derived(
  writeBlocked && userSource !== undefined && userChartNeedsServerDelete(userSource),
);
const chartBounds = $derived(chart?.bounds ?? userSource?.bounds);
const rawChartUrl = $derived(chart?.url ?? userSource?.origin.url);
const chartUrl = $derived(rawChartUrl ? userChartUrlForDisplay(rawChartUrl) : undefined);
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

function saveName(): void {
  if (!canEdit || renameBlocked || !userSource || !userCharts) return;
  const trimmed = chartName.trim();
  if (trimmed && trimmed !== userSource.name) userCharts.rename(userSource.id, trimmed);
}

function doDelete(): void {
  if (deleteBlocked || !userSource || !userCharts) return;
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
      disabled={renameBlocked}
      maxLength={MAX_USER_CHART_NAME_LENGTH}
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
    {#if writeBlocked && userSource?.serverCleanupRequired}
      <p class="alert-note" role="status">
        Read/write Signal K access is needed to remove the legacy server copy before deleting this
        chart from the device.
      </p>
    {/if}
    {#if confirming}
      <InlineConfirm
        question="Delete this chart?"
        onConfirm={doDelete}
        onCancel={() => (confirming = false)}
      />
    {:else}
      <button
        type="button"
        class="btn btn-danger"
        onclick={() => (confirming = true)}
        disabled={deleteBlocked}
      >
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
