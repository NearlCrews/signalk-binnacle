<script lang="ts">
import { RefreshCw } from '@lucide/svelte';
import { onDestroy } from 'svelte';
import { formatBounds } from '$shared/geo';
import { Disclosure, SlideOver, TextField } from '$shared/ui';
import type { ManagedChart, ManagedChartsResponse } from './charts-management-client.js';
import { fetchManagedCharts, putChartOverride } from './charts-management-client.js';

interface Props {
  adminAccess: boolean;
  accessUrl: string;
  companionBase: string;
  onClose: () => void;
  onBack?: () => void;
}

const { adminAccess, accessUrl, companionBase, onClose, onBack }: Props = $props();

let data = $state<ManagedChartsResponse | null>(null);
let loadError = $state<string | null>(null);
let refreshing = $state(false);
let loadGeneration = 0;
type SaveState = 'saving' | 'saved' | 'error';
// Per-field save state keyed as "<identifier>:<field>", so each field tracks independently. A field
// with no feedback is simply absent; there is no empty-string sentinel state.
let saveStates = $state<Record<string, SaveState>>({});
// Tracks pending clear-indicator timer ids so they can be canceled if the panel unmounts.
const timerIds: ReturnType<typeof setTimeout>[] = [];
onDestroy(() => {
  for (const id of timerIds) clearTimeout(id);
});

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

// Load on mount. The browser supplies the current same-origin administrator session on every call.
// The generation guard drops a stale response if a manual refresh overtakes it.
$effect(() => {
  void loadCharts();
});

async function saveOverride(
  chart: ManagedChart,
  field: 'name' | 'description',
  value: string,
): Promise<void> {
  if (!adminAccess || data === null) return;
  const key = `${chart.identifier}:${field}`;
  const override = { ...chart.override, [field]: value };
  saveStates[key] = 'saving';
  const ok = await putChartOverride(companionBase, chart.identifier, override);
  saveStates[key] = ok ? 'saved' : 'error';
  if (ok) {
    // Optimistically update the local override so a subsequent save on the same chart
    // carries the latest merged override rather than the stale original.
    data = {
      ...data,
      charts: data.charts.map((c) => (c.identifier === chart.identifier ? { ...c, override } : c)),
    };
    // Clear the saved indicator after a short pause; errors stay until the next action.
    timerIds.push(
      setTimeout(() => {
        delete saveStates[key];
      }, 2000),
    );
  }
}
</script>

{#snippet saveIndicator(key: string, errorMessage: string)}
  {#if saveStates[key] === 'saving'}
    <p class="muted-note save-note" role="status">Saving…</p>
  {:else if saveStates[key] === 'saved'}
    <p class="muted-note save-note" role="status">Saved.</p>
  {:else if saveStates[key] === 'error'}
    <p class="alert-note save-note" role="alert">{errorMessage}</p>
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
    <p class="muted-note">
      Signal K administrator sign-in is needed to edit chart names and descriptions.
      <a href={accessUrl} target="_blank" rel="noopener noreferrer">Sign in to Signal K</a>, then
      return here and refresh the list.
    </p>
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
            onCommit={(value) => void saveOverride(chart, 'name', value)}
          />
          {@render saveIndicator(nameKey, 'Could not save the name. Check access.')}
          <TextField
            variant="stacked"
            label="Description"
            value={chart.override.description ?? chart.description}
            disabled={!adminAccess}
            ariaLabel="Description for {chart.fileName}"
            onCommit={(value) => void saveOverride(chart, 'description', value)}
          />
          {@render saveIndicator(descKey, 'Could not save the description. Check access.')}
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
