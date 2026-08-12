<script lang="ts">
import {
  type DraftChart,
  MAX_USER_CHART_NAME_LENGTH,
  MAX_USER_CHART_URL_LENGTH,
  shouldShareUserChart,
  type UserCharts,
} from '$entities/user-charts';
import { TextField } from '$shared/ui';
import ChartSourceReview from './ChartSourceReview.svelte';

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
      <span class="caps-label">Review and save</span>
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
      {#if draft}
        <ChartSourceReview
          source={draft.source}
          {shareWithServer}
          {writeBlocked}
          disabled={busy}
          onShareChange={(share) => (shareWithServer = share)}
        />
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
      <span class="caps-label">Chart files on this server</span>
      <p class="muted-note muted-note--xs">
        Put PMTiles files in your server chart provider, such as Chart Locker or
        signalk-pmtiles-plugin. Server charts appear in this list automatically and are available to
        every station.
      </p>
    </section>
    <div class="field">
      <TextField
        variant="stacked"
        type="url"
        label="From a PMTiles URL"
        value={url}
        placeholder="https://.../chart.pmtiles"
        disabled={busy}
        maxLength={MAX_USER_CHART_URL_LENGTH}
        onInput={(value) => (url = value)}
        onCommit={(value) => (url = value)}
        onEnter={stageUrl}
      />
      <div class="panel-controls">
        <button
          type="button"
          class="btn btn-ghost"
          onclick={stageUrl}
          disabled={busy || !url.trim()}
        >
          Import
        </button>
      </div>
      <p class="muted-note muted-note--xs">
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
/* The review-and-rename step shown after an import is staged, before it is saved. */
.review {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
</style>
