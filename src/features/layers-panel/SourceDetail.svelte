<script lang="ts">
import Link2 from '@lucide/svelte/icons/link-2';
import LocateFixed from '@lucide/svelte/icons/locate-fixed';
import RefreshCw from '@lucide/svelte/icons/refresh-cw';
import Trash2 from '@lucide/svelte/icons/trash-2';
import {
  type DraftChart,
  MAX_USER_CHART_NAME_LENGTH,
  MAX_USER_CHART_URL_LENGTH,
  shouldShareUserChart,
  type UserChartSource,
  type UserCharts,
  userChartNeedsServerDelete,
  userChartUrlForDisplay,
} from '$entities/user-charts';
import { type Bbox4, formatBounds } from '$shared/geo';
import type { LayerListItem } from '$shared/map';
import { InlineConfirm, SubViewHeader, TextField } from '$shared/ui';
import ChartSourceReview from './ChartSourceReview.svelte';
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
let replacementMode = $state<'idle' | 'url' | 'review'>('idle');
let replacementUrl = $state('');
let replacementDraft = $state<DraftChart | undefined>();
let replacementShare = $state(false);
let operation = $state<'reading' | 'saving' | 'sharing' | undefined>();
let operationError = $state<string | undefined>();
let operationStatus = $state<string | undefined>();
let destroyed = false;
let stageGeneration = 0;
let stageController: AbortController | undefined;

const chart = $derived(item.chart);
const canEdit = $derived(userSource !== undefined && userCharts !== undefined);
const renameBlocked = $derived(
  writeBlocked && userSource !== undefined && shouldShareUserChart(userSource),
);
const deleteBlocked = $derived(
  writeBlocked && userSource !== undefined && userChartNeedsServerDelete(userSource),
);
const sourceMutationBlocked = $derived(
  writeBlocked && userSource !== undefined && userChartNeedsServerDelete(userSource),
);
const chartBounds = $derived(chart?.bounds ?? userSource?.bounds);
const rawChartUrl = $derived(chart?.url ?? userSource?.origin.url);
const chartUrl = $derived(rawChartUrl ? userChartUrlForDisplay(rawChartUrl) : undefined);
const sourceShared = $derived(userSource ? shouldShareUserChart(userSource) : false);
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
  ...(userSource
    ? [
        {
          label: 'Stored',
          value: sourceShared ? 'This device, and shared to the server' : 'This device only',
        },
      ]
    : []),
]);
$effect(() => {
  return () => {
    destroyed = true;
    stageGeneration += 1;
    stageController?.abort(new DOMException('Chart source canceled', 'AbortError'));
    stageController = undefined;
  };
});

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

function startReplacement(): void {
  if (!canEdit || sourceMutationBlocked || operation) return;
  replacementMode = 'url';
  replacementUrl = '';
  replacementDraft = undefined;
  operationError = undefined;
  operationStatus = undefined;
}

function cancelReplacement(): void {
  stageGeneration += 1;
  stageController?.abort(new DOMException('Chart source canceled', 'AbortError'));
  stageController = undefined;
  replacementMode = 'idle';
  replacementUrl = '';
  replacementDraft = undefined;
  operation = undefined;
  operationError = undefined;
}

function stageReplacement(url: string): void {
  if (!userSource || !userCharts || sourceMutationBlocked || operation) return;
  const generation = ++stageGeneration;
  stageController?.abort(new DOMException('Chart source superseded', 'AbortError'));
  const controller = new AbortController();
  stageController = controller;
  operation = 'reading';
  operationError = undefined;
  operationStatus = undefined;
  const sourceId = userSource.id;
  void userCharts
    .stageReplacement(sourceId, url, controller.signal)
    .then((draft) => {
      if (destroyed || generation !== stageGeneration) return;
      replacementDraft = draft;
      replacementShare = !writeBlocked && shouldShareUserChart(draft.source);
      replacementMode = 'review';
    })
    .catch((error: unknown) => {
      if (destroyed || generation !== stageGeneration) return;
      if (error instanceof DOMException && error.name === 'AbortError') return;
      operationError =
        error instanceof Error ? error.message : 'Could not read replacement chart metadata.';
    })
    .finally(() => {
      if (!destroyed && generation === stageGeneration) operation = undefined;
      if (stageController === controller) stageController = undefined;
    });
}

function reviewReplacement(): void {
  const trimmed = replacementUrl.trim();
  if (!trimmed) return;
  stageReplacement(trimmed);
}

function refreshMetadata(): void {
  if (!userSource) return;
  stageReplacement(userSource.origin.url);
}

function saveReplacement(): void {
  const draft = replacementDraft;
  if (!draft || !userCharts || operation) return;
  operation = 'saving';
  operationError = undefined;
  operationStatus = undefined;
  void userCharts
    .replace(draft, !writeBlocked && replacementShare)
    .then(() => {
      if (destroyed) return;
      replacementMode = 'idle';
      replacementUrl = '';
      replacementDraft = undefined;
      operationStatus = 'Chart source saved.';
    })
    .catch((error: unknown) => {
      if (destroyed) return;
      operationError =
        error instanceof Error ? error.message : 'Could not apply the replacement chart.';
    })
    .finally(() => {
      if (!destroyed) operation = undefined;
    });
}

function changeSharing(share: boolean): void {
  if (!userSource || !userCharts || writeBlocked || operation) return;
  operation = 'sharing';
  operationError = undefined;
  operationStatus = undefined;
  void userCharts
    .setSharing(userSource.id, share)
    .then(() => {
      if (destroyed) return;
      operationStatus = share
        ? 'Chart sharing saved.'
        : 'Chart now stays on this device. Removing any prior server copy continues in the background.';
    })
    .catch((error: unknown) => {
      if (destroyed) return;
      operationError =
        error instanceof Error ? error.message : 'Could not change the chart sharing preference.';
    })
    .finally(() => {
      if (!destroyed) operation = undefined;
    });
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

  {#if !item.available && item.unavailableHint}
    <p class="muted-note" role="status">{item.unavailableHint}</p>
  {/if}

  {#if chartBounds}
    <button type="button" class="btn" onclick={() => onShowBounds?.(chartBounds)}>
      <LocateFixed size={16} aria-hidden="true" />
      Show chart area
    </button>
  {/if}

  {#if canEdit}
    <section class="panel-section" aria-label="Chart source maintenance">
      <h3 class="caps-label">Source maintenance</h3>
      <p class="muted-note">
        Repair a moved or expired PMTiles link without losing this chart's visibility, opacity, or
        stacking position.
      </p>

      {#if replacementMode === 'idle'}
        <div class="panel-controls">
          <button
            type="button"
            class="btn"
            onclick={startReplacement}
            disabled={sourceMutationBlocked || operation !== undefined}
          >
            <Link2 size={16} aria-hidden="true" />
            Replace source URL
          </button>
          <button
            type="button"
            class="btn"
            onclick={refreshMetadata}
            disabled={sourceMutationBlocked || operation !== undefined}
          >
            <RefreshCw size={16} aria-hidden="true" />
            Refresh metadata
          </button>
        </div>

        {#if userSource}
          <ChartSourceReview
            source={userSource}
            shareWithServer={sourceShared}
            {writeBlocked}
            disabled={operation !== undefined}
            showSpecs={false}
            onShareChange={changeSharing}
          />
        {/if}
      {:else if replacementMode === 'url'}
        <div class="replacement-editor" role="group" aria-label="Replace chart source URL">
          <TextField
            variant="stacked"
            label="Replacement URL"
            value={replacementUrl}
            placeholder="https://.../chart.pmtiles"
            disabled={operation !== undefined}
            maxLength={MAX_USER_CHART_URL_LENGTH}
            focusOnOpen
            onInput={(value) => (replacementUrl = value)}
            onCommit={(value) => (replacementUrl = value)}
            onEnter={reviewReplacement}
          />
          <p class="muted-note">
            The current URL remains active until the replacement metadata is reviewed and saved.
          </p>
          <div class="panel-controls">
            <button
              type="button"
              class="btn btn-primary"
              onclick={reviewReplacement}
              disabled={operation !== undefined || !replacementUrl.trim()}
            >
              Review replacement
            </button>
            <button
              type="button"
              class="btn"
              onclick={cancelReplacement}
              disabled={operation === 'saving' || operation === 'sharing'}
            >
              Cancel
            </button>
          </div>
        </div>
      {:else if replacementDraft}
        <div class="replacement-editor" role="group" aria-label="Review replacement chart">
          <h4 class="caps-label">Review replacement</h4>
          <ChartSourceReview
            source={replacementDraft.source}
            shareWithServer={replacementShare}
            {writeBlocked}
            disabled={operation !== undefined}
            showSource
            onShareChange={(share) => (replacementShare = share)}
          />
          <div class="panel-controls">
            <button
              type="button"
              class="btn btn-primary"
              onclick={saveReplacement}
              disabled={operation !== undefined}
            >
              Save replacement
            </button>
            <button
              type="button"
              class="btn"
              onclick={cancelReplacement}
              disabled={operation !== undefined}
            >
              Cancel
            </button>
          </div>
        </div>
      {/if}

      {#if operation === 'reading'}
        <p class="muted-note" role="status">Reading replacement chart…</p>
      {:else if operation === 'saving'}
        <p class="muted-note" role="status">Saving replacement chart…</p>
      {:else if operation === 'sharing'}
        <p class="muted-note" role="status">Saving chart sharing…</p>
      {:else if operationError}
        <p class="alert-note" role="alert">{operationError}</p>
      {:else if operationStatus}
        <p class="muted-note" role="status">{operationStatus}</p>
      {/if}

      {#if sourceMutationBlocked}
        <p class="muted-note" role="status">
          Read/write Signal K access is needed to repair or refresh this shared chart.
        </p>
      {:else if writeBlocked}
        <p class="muted-note" role="status">
          This device-only chart can be repaired locally. Read/write Signal K access is needed to
          share it.
        </p>
      {/if}
    </section>

    {#if writeBlocked && userSource?.serverCleanupRequired}
      <p class="alert-note" role="status">
        Read/write Signal K access is needed to remove the remaining server copy before deleting
        this chart from the device.
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
.replacement-editor {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
</style>
