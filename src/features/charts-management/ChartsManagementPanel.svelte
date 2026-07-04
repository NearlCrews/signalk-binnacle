<script lang="ts">
import { onDestroy } from 'svelte';
import { formatBounds } from '$shared/geo';
import type { AuthController } from '$shared/signalk';
import { Disclosure, SlideOver, TextField } from '$shared/ui';
import type { ManagedChart, ManagedChartsResponse } from './charts-management-client.js';
import { fetchManagedCharts, putChartOverride } from './charts-management-client.js';

interface Props {
  auth: AuthController;
  companionBase: string;
  onClose: () => void;
  onBack?: () => void;
}

const { auth, companionBase, onClose, onBack }: Props = $props();

let data = $state<ManagedChartsResponse | null>(null);
let loadError = $state<string | null>(null);
type SaveState = 'saving' | 'saved' | 'error';
// Per-field save state keyed as "<identifier>:<field>", so each field tracks independently. A field
// with no feedback is simply absent; there is no empty-string sentinel state.
let saveStates = $state<Record<string, SaveState>>({});
// Tracks pending clear-indicator timer ids so they can be canceled if the panel unmounts.
const timerIds: ReturnType<typeof setTimeout>[] = [];
onDestroy(() => {
  for (const id of timerIds) clearTimeout(id);
});

// Rebuild the token shape the REST clients expect whenever auth changes so every call carries
// the current bearer token, matching the regions panel's client-rebuild pattern.
const token = $derived(auth.token ?? undefined);

// Load the chart list on mount and refresh when the auth token changes.
// A stale flag guards against a previous slow request overwriting a fresh response when the
// token rotates mid-flight, matching the regions panel's stats-load effect.
$effect(() => {
  // Track the token so a token change triggers a re-fetch with the new credentials.
  void token;
  let stale = false;
  loadError = null;
  void fetchManagedCharts(companionBase, token).then((result) => {
    if (stale) return;
    if (result === undefined) {
      loadError = 'Could not load charts. Check the connection and access.';
    } else {
      data = result;
    }
  });
  return () => {
    stale = true;
  };
});

async function saveOverride(
  chart: ManagedChart,
  field: 'name' | 'description',
  value: string,
): Promise<void> {
  if (auth.writeBlocked || data === null) return;
  const key = `${chart.identifier}:${field}`;
  const override = { ...chart.override, [field]: value };
  saveStates[key] = 'saving';
  const ok = await putChartOverride(companionBase, token, chart.identifier, override);
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
    <p class="muted-note save-note" role="status">Saving...</p>
  {:else if saveStates[key] === 'saved'}
    <p class="muted-note save-note" role="status">Saved.</p>
  {:else if saveStates[key] === 'error'}
    <p class="alert-note save-note" role="alert">{errorMessage}</p>
  {/if}
{/snippet}

<SlideOver title="Chart files" closeLabel="Close chart files panel" {onClose} {onBack} bodyFlex>
  <p class="muted-note">Rename the chart files installed on your server so they read plainly.</p>
  {#if auth.writeBlocked}
    <p class="muted-note">
      A write token is needed to edit chart names and descriptions. Request a read/write token to
      continue.
    </p>
  {/if}

  <section class="panel-section" aria-label="Charts">
    <h3 class="caps-label">Charts</h3>

    {#if loadError !== null}
      <p class="alert-note" role="alert">{loadError}</p>
    {:else if data === null}
      <p class="muted-note" role="status">Loading charts...</p>
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
            disabled={auth.writeBlocked}
            ariaLabel="Display name for {chart.fileName}"
            onCommit={(value) => void saveOverride(chart, 'name', value)}
          />
          {@render saveIndicator(nameKey, 'Could not save the name. Check access.')}
          <TextField
            variant="stacked"
            label="Description"
            value={chart.override.description ?? chart.description}
            disabled={auth.writeBlocked}
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
          <p class="alert-note">{item.error}</p>
        </div>
      {/each}
    </section>
  {/if}

  <p class="muted-note deferred-note">Browser upload of chart archives is not yet available.</p>
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
