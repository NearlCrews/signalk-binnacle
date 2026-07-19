<script lang="ts">
import { Link2 } from '@lucide/svelte';
import {
  type DraftChart,
  MAX_USER_CHART_NAME_LENGTH,
  MAX_USER_CHART_URL_LENGTH,
  shouldShareUserChart,
  type UserCharts,
  userChartUrlHasQuery,
} from '$entities/user-charts';
import { TextField } from '$shared/ui';
import ChartSpecList from './ChartSpecList.svelte';
import { chartSpecRows } from './chart-spec';

interface Props {
  userCharts: UserCharts;
  writeBlocked?: boolean;
  onDone: () => void;
}

const { userCharts, writeBlocked = false, onDone }: Props = $props();

let url = $state('');
let busy = $state(false);
let error = $state<string | undefined>();
// A staged import awaiting review. While set, the form shows the rename-and-review step instead of
// the import inputs; committing it saves the chart.
let draft = $state<DraftChart | undefined>();
let draftName = $state('');
let shareWithServer = $state(true);
let destroyed = false;
let stageGeneration = 0;
let stageController: AbortController | undefined;

$effect(() => {
  return () => {
    destroyed = true;
    stageGeneration += 1;
    stageController?.abort(new DOMException('Chart source canceled', 'AbortError'));
    stageController = undefined;
  };
});

$effect(() => {
  if (writeBlocked) shareWithServer = false;
});

const staged = $derived(draft !== undefined);
const draftHasQuery = $derived(draft ? userChartUrlHasQuery(draft.source.origin.url) : false);

const draftRows = $derived.by(() => {
  if (!draft) return [];
  const spec = chartSpecRows(draft.source);
  return [
    spec.type,
    spec.zoom,
    {
      label: 'Stored',
      value: shareWithServer ? 'This device, and shared to the server' : 'This device only',
    },
  ];
});

// The busy and error envelope shared by the read-to-stage and the commit steps.
async function withBusy(
  action: () => Promise<void>,
  fallbackError: string,
  isCurrent: () => boolean = () => !destroyed,
): Promise<void> {
  if (!isCurrent()) return;
  busy = true;
  error = undefined;
  try {
    await action();
  } catch (e) {
    if (!isCurrent()) return;
    error = e instanceof Error ? e.message : fallbackError;
  } finally {
    if (isCurrent()) busy = false;
  }
}

// Stage an import by reading its metadata, without saving, so the review step can rename it first.
function stageUrl(): void {
  if (busy) return;
  const trimmed = url.trim();
  if (!trimmed) return;
  const generation = ++stageGeneration;
  stageController?.abort(new DOMException('Chart source superseded', 'AbortError'));
  const controller = new AbortController();
  stageController = controller;
  const isCurrent = () => !destroyed && generation === stageGeneration;
  void withBusy(
    async () => {
      const next = await userCharts.stageUrl(trimmed, controller.signal);
      if (!isCurrent()) return;
      draft = next;
      draftName = next.source.name;
      shareWithServer = !writeBlocked && shouldShareUserChart(next.source);
    },
    'Could not read that chart.',
    isCurrent,
  ).finally(() => {
    if (stageController === controller) stageController = undefined;
  });
}

function resetDraft(): void {
  draft = undefined;
  draftName = '';
  shareWithServer = true;
}

function saveDraft(): void {
  if (busy) return;
  const stagedDraft = draft;
  if (!stagedDraft) return;
  void withBusy(async () => {
    userCharts.commit(stagedDraft, draftName, !writeBlocked && shareWithServer);
    onDone();
    resetDraft();
  }, 'Could not add that chart.');
}

function cancelDraft(): void {
  resetDraft();
  error = undefined;
}
</script>

<div class="add-form">
  {#if staged}
    <div class="review" role="group" aria-label="Review imported chart">
      <span class="field-label caps-label">Review and save</span>
      <TextField
        variant="stacked"
        label="Name"
        value={draftName}
        disabled={busy}
        maxLength={MAX_USER_CHART_NAME_LENGTH}
        focusOnOpen
        onInput={(value) => (draftName = value)}
        onCommit={(value) => (draftName = value)}
      />
      <ChartSpecList rows={draftRows} />
      <label class="share-choice">
        <input type="checkbox" bind:checked={shareWithServer} disabled={busy || writeBlocked}>
        <span>Share the full chart URL with the Signal K server</span>
      </label>
      {#if writeBlocked}
        <p class="privacy-note" role="status">
          This chart will stay on this device. Read/write Signal K access is needed to share it with
          the server.
        </p>
      {:else if draftHasQuery}
        <p class:alert-note={shareWithServer} class="privacy-note" role="status">
          {shareWithServer
            ? 'Sharing sends the full URL, including every query value, to the Signal K server.'
            : 'This URL contains query values that may be private. It stays on this device unless you choose to share the full URL.'}
        </p>
      {:else}
        <p class="hint">
          Sharing lets other Signal K clients discover this chart. Turn it off to keep the full URL
          on this device.
        </p>
      {/if}
      <div class="panel-controls">
        <button
          type="button"
          class="btn btn-primary"
          onclick={saveDraft}
          disabled={busy || !draftName.trim()}
        >
          Save chart
        </button>
        <button type="button" class="btn" onclick={cancelDraft} disabled={busy}>Cancel</button>
      </div>
    </div>
  {:else}
    <section class="server-path" aria-label="Chart files on this server">
      <span class="field-label caps-label">Chart files on this server</span>
      <p class="hint">
        Put PMTiles files in your server chart provider, such as Chart Locker or
        signalk-pmtiles-plugin. Server charts appear in this list automatically and are available to
        every station.
      </p>
    </section>
    <div class="field">
      <span class="field-label caps-label" id="add-chart-url-label">
        <Link2 size={14} aria-hidden="true" />
        From a PMTiles URL
      </span>
      <div class="url-row">
        <input
          class="input url"
          type="url"
          placeholder="https://.../chart.pmtiles"
          aria-labelledby="add-chart-url-label"
          bind:value={url}
          maxlength={MAX_USER_CHART_URL_LENGTH}
          disabled={busy}
        >
        <button
          type="button"
          class="btn btn-ghost"
          onclick={stageUrl}
          disabled={busy || !url.trim()}
        >
          Add
        </button>
      </div>
      <p class="hint">
        Use this for a chart archive hosted outside your Signal K server. URLs with query values
        stay on this device by default, and sharing is reviewed before save.
      </p>
    </div>
  {/if}

  {#if busy}
    <p class="muted-note" role="status">{staged ? 'Saving chart…' : 'Reading chart…'}</p>
  {:else if error}
    <p class="alert-note" role="alert">{error}</p>
  {/if}

  {#if !staged}
    <button type="button" class="btn btn-ghost" onclick={onDone} disabled={busy}>Close</button>
  {/if}
</div>

<style>
.add-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding-block: var(--space-2);
}
.field,
.server-path {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.server-path {
  padding: var(--space-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface-raised);
}
.field-label {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
}
.url-row {
  display: flex;
  gap: var(--space-2);
}
/* The box styling comes from the shared .input; only the flex sizing is local. */
.url {
  flex: 1;
  min-inline-size: 0;
}
.hint {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--text-muted);
}
/* The review-and-rename step shown after an import is staged, before it is saved. */
.review {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.share-choice {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  font-size: var(--text-sm);
}
.share-choice input {
  flex: 0 0 auto;
  margin-block-start: 0.15rem;
}
.privacy-note {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--text-muted);
}
</style>
