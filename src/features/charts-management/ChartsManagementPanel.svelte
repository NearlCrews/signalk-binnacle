<script lang="ts">
import RefreshCw from '@lucide/svelte/icons/refresh-cw';
import { onDestroy } from 'svelte';
import { formatBounds } from '$shared/geo';
import {
  AccessRecoveryNote,
  type AccessRecoveryState,
  Disclosure,
  SlideOver,
  TextField,
} from '$shared/ui';
import { createChartOverridesController } from './chart-overrides-controller.svelte.js';
import type { ManagedChart, ManagedChartsResponse } from './charts-management-client.js';
import { fetchManagedCharts, putChartOverride } from './charts-management-client.js';

interface Props {
  adminAccess: boolean;
  accessUrl: string;
  accessState: AccessRecoveryState;
  companionBase: string;
  onClose: () => void;
  onBack?: () => void;
  onRetryAccess: () => void;
}

const {
  adminAccess,
  accessUrl,
  accessState,
  companionBase,
  onClose,
  onBack,
  onRetryAccess,
}: Props = $props();

let data = $state<ManagedChartsResponse | null>(null);
let loadError = $state<string | null>(null);
let refreshing = $state(false);
let loadGeneration = 0;
const overrideController = createChartOverridesController({
  getChart: (id) => data?.charts.find((chart) => chart.identifier === id),
  updateOverride: (id, override) => {
    if (data === null) return;
    data = {
      ...data,
      charts: data.charts.map((chart) =>
        chart.identifier === id ? { ...chart, override } : chart,
      ),
    };
  },
  write: (id, override) => putChartOverride(companionBase, id, override),
});
const saveStates = $derived(overrideController.states);
onDestroy(() => overrideController.dispose());

async function loadCharts(manual = false): Promise<void> {
  const generation = ++loadGeneration;
  if (manual) refreshing = true;
  loadError = null;
  try {
    const result = await fetchManagedCharts(companionBase);
    if (generation !== loadGeneration) return;
    if (result === undefined) {
      loadError = 'Could not load installed charts. Check the connection and access.';
    } else {
      data = result;
    }
  } finally {
    if (generation === loadGeneration) refreshing = false;
  }
}

// Load on mount. The browser supplies the current administrator session on every call.
// The generation guard drops a stale response if a manual refresh overtakes it.
$effect(() => {
  void loadCharts();
});

function saveOverride(chart: ManagedChart, field: 'name' | 'description', value: string): void {
  if (!adminAccess || data === null) return;
  overrideController.save(chart, field, value);
}
</script>

{#snippet saveIndicator(key: string, errorMessage: string, onRetry: () => void)}
  {#if saveStates[key] === 'saving'}
    <p class="muted-note save-note" role="status">Saving…</p>
  {:else if saveStates[key] === 'saved'}
    <p class="muted-note save-note" role="status">Saved.</p>
  {:else if saveStates[key] === 'error'}
    <div class="save-error" role="alert">
      <p class="alert-note save-note">{errorMessage}</p>
      <button type="button" class="btn btn-ghost" onclick={onRetry}>Retry</button>
    </div>
  {/if}
{/snippet}

<SlideOver
  title="Installed charts"
  closeLabel="Close installed charts panel"
  {onClose}
  {onBack}
  backLabel="Back to offline charts"
  bodyFlex
>
  <p class="muted-note">
    Edit how installed charts are named in Binnacle and check whether Chart Locker can read each
    file. Text changes save when you leave the field or press Enter.
  </p>
  {#if !adminAccess}
    <AccessRecoveryNote
      state={accessState}
      capability="edit installed chart details"
      {accessUrl}
      onRetry={onRetryAccess}
    />
  {/if}

  <section class="panel-section" aria-label="Charts">
    <div class="section-heading">
      <h3 class="caps-label">Installed charts</h3>
      <button
        type="button"
        class="btn btn-ghost refresh-button"
        disabled={refreshing}
        onclick={() => void loadCharts(true)}
      >
        <RefreshCw size={16} aria-hidden="true" />
        {refreshing ? 'Refreshing…' : 'Refresh list'}
      </button>
    </div>

    {#if loadError !== null}
      <p class="alert-note" role="alert">{loadError}</p>
      <button type="button" class="btn" onclick={() => void loadCharts(true)}>Try again</button>
    {:else if data === null}
      <p class="muted-note" role="status">Loading charts…</p>
    {:else if data.charts.length === 0}
      <p class="muted-note">
        No charts yet. Drop chart files (.pmtiles) into the server's chart folder and they show up
        here, where you can rename them.
      </p>
    {:else}
      {#each data.charts as chart (chart.identifier)}
        {@const nameKey = `${chart.identifier}:name`}
        {@const descKey = `${chart.identifier}:description`}
        <div class="chart-card card-frame">
          <p class="chart-file">{chart.fileName}</p>
          <Disclosure label="Chart details">
            <dl class="stat-grid">
              <dt>Format</dt>
              <dd>
                <span class="num">{chart.format.toUpperCase()}</span><span class="unit"></span>
              </dd>
              <dt>Zoom range</dt>
              <dd>
                <span class="num">{chart.minzoom} to {chart.maxzoom}</span
                ><span class="unit"></span>
              </dd>
              <dt>Nominal scale</dt>
              <dd>
                <span class="num">1:{chart.scale.toLocaleString()}</span><span class="unit"></span>
              </dd>
              {#if chart.bounds}
                <dt>Bounds</dt>
                <dd class="bounds-val">
                  <span class="num">{formatBounds(chart.bounds)}</span><span class="unit"></span>
                </dd>
              {/if}
            </dl>
          </Disclosure>
          <TextField
            variant="stacked"
            label="Display name"
            value={chart.override.name ?? chart.name}
            disabled={!adminAccess}
            ariaLabel="Display name for {chart.fileName}"
            onCommit={(value) => saveOverride(chart, 'name', value)}
          />
          {@render saveIndicator(nameKey, 'Could not save the name. Check access.', () =>
            overrideController.retry(chart.identifier, 'name'))}
          <TextField
            variant="stacked"
            label="Description"
            value={chart.override.description ?? chart.description}
            disabled={!adminAccess}
            ariaLabel="Description for {chart.fileName}"
            onCommit={(value) => saveOverride(chart, 'description', value)}
          />
          {@render saveIndicator(descKey, 'Could not save the description. Check access.', () =>
            overrideController.retry(chart.identifier, 'description'))}
        </div>
      {/each}
    {/if}
  </section>

  {#if data !== null && data.invalid.length > 0}
    <section class="panel-section" aria-label="Invalid files">
      <h3 class="caps-label">Invalid files</h3>
      {#each data.invalid as item (item.fileName)}
        <div class="card-frame invalid-card">
          <p class="chart-file">{item.fileName}</p>
          <p class="alert-note" role="alert">{item.error}</p>
          <p class="muted-note">
            Replace or remove this file in the Chart Locker chart folder on the Signal K server,
            then refresh this list.
          </p>
        </div>
      {/each}
    </section>
  {/if}

  <p class="muted-note deferred-note">
    To add, replace, or remove chart archives, manage the Chart Locker chart folder on the Signal K
    server, then refresh this list. Browser upload is not available yet.
  </p>
</SlideOver>

<style>
/* A raised card per detected chart, layout-only: border, radius, and surface come from .card-frame
   (cards.css) and the local flex column adds the inner spacing. */
.chart-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
}

.section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}
.section-heading h3 {
  margin: 0;
}
.refresh-button {
  min-block-size: var(--row-size);
  white-space: nowrap;
}
.save-error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.invalid-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-2) var(--space-3);
}

/* The source file name: mono so it reads as a path, muted so it recedes behind the editable name,
   clipped so a long filename cannot break the card layout. */
.chart-file {
  margin: 0;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Bounds are coordinate pairs: mono and tabular so the digits line up at a glance. */
.bounds-val {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
}

/* The deferred-upload note sits at the end of the panel body, always present as a clear signal
   that upload is not yet available rather than leaving the user hunting for an upload button. */
.deferred-note {
  margin-block-start: var(--space-1);
}
</style>
