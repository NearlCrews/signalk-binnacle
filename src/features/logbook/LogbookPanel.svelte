<script lang="ts">
import { onMount } from 'svelte';
import { formatClockTime, formatDayClock, formatMonthDay, MINUTE_MS } from '$shared/lib';
import { adminLoginUrl } from '$shared/signalk';
import { InlineConfirm, restoreFocusAfterCancel, SlideOver } from '$shared/ui';
import { type LogbookEntry, MAX_LOGBOOK_TEXT_LENGTH } from './logbook-client';
import type { LogbookController } from './logbook-controller.svelte';

interface Props {
  controller: LogbookController;
  origin: string;
  onClose: () => void;
  onBack?: () => void;
}

const { controller, origin, onClose, onBack }: Props = $props();
const loginUrl = $derived(
  adminLoginUrl(
    origin,
    typeof location === 'undefined'
      ? '/signalk-binnacle/'
      : `${location.pathname}${location.search}${location.hash}`,
  ),
);

let discardArmed = $state(false);
let discardTrigger = $state<HTMLButtonElement>();

// Seed the composer from a pending offer without ever clobbering typed text: an offer lands only
// in an empty composer or over the previous offer's untouched text, and a composer the navigator
// cleared does not re-seed the same offer.
$effect(() => {
  const offered = controller.suggestion;
  if (!offered || offered.text === controller.seededText) return;
  if (controller.draft !== '' && controller.draft !== controller.seededText) return;
  controller.draft = offered.text;
  controller.seededText = offered.text;
});

onMount(() => {
  if (controller.open) controller.open();
  else controller.start();
  const refresh = () => {
    if (
      document.visibilityState !== 'hidden' &&
      controller.availability === 'available' &&
      Date.now() - (controller.lastCheckedMs ?? 0) >= MINUTE_MS
    )
      void controller.refresh();
  };
  const timer = setInterval(refresh, MINUTE_MS);
  window.addEventListener('focus', refresh);
  document.addEventListener('visibilitychange', refresh);
  return () => {
    clearInterval(timer);
    window.removeEventListener('focus', refresh);
    document.removeEventListener('visibilitychange', refresh);
  };
});

$effect(() => {
  if (controller.availability === 'available' && controller.loadState === 'idle') {
    void controller.refresh();
  }
});

const writesDisabled = $derived(controller.busy);
const offerInComposer = $derived(
  controller.suggestion !== undefined && controller.draft === controller.suggestion.text,
);

async function submit(): Promise<void> {
  const submitted = controller.draft;
  if ((await controller.addEntry(submitted)) && controller.draft === submitted) {
    controller.draft = '';
    controller.seededText = '';
  }
}

function useSuggestion(): void {
  const offered = controller.suggestion;
  if (!offered) return;
  controller.draft = offered.text;
  controller.seededText = offered.text;
}

function dismissSuggestion(): void {
  if (offerInComposer) controller.draft = '';
  controller.seededText = '';
  controller.dismissSuggestion();
}

interface DayGroup {
  key: string;
  label: string;
  entries: LogbookEntry[];
}

// Entries arrive newest first, so contiguous runs of one local calendar day group correctly.
const dayGroups = $derived.by<DayGroup[]>(() => {
  const groups: DayGroup[] = [];
  for (const entry of controller.entries) {
    const key = new Date(entry.timeMs).toDateString();
    const last = groups.at(-1);
    if (last?.key === key) {
      last.entries.push(entry);
    } else {
      groups.push({ key, label: formatMonthDay(entry.timeMs), entries: [entry] });
    }
  }
  return groups;
});
</script>

<SlideOver title="Logbook" closeLabel="Close logbook panel" {onClose} {onBack} bodyFlex>
  {#if controller.error}
    <p class="alert-note" role="alert">{controller.error}</p>
  {/if}

  <p class="muted-note">
    Keep a written log of the passage. Entries save to the boat's logbook on the Signal K server.
  </p>
  {#if controller.draft}
    <p class="muted-note">
      This draft stays while this app is open, including when you change panels. Reloading or
      closing the app loses it.
    </p>
    {#if discardArmed}
      <InlineConfirm
        question="Discard this log draft?"
        onCancel={() => {
          discardArmed = false;
          void restoreFocusAfterCancel(() => discardTrigger);
        }}
        onConfirm={() => {
        controller.draft = '';
        controller.seededText = controller.suggestion?.text ?? '';
        discardArmed = false;
      }}
      />
    {:else}
      <button
        type="button"
        class="btn btn-ghost"
        bind:this={discardTrigger}
        onclick={() => (discardArmed = true)}
      >
        Discard draft
      </button>
    {/if}
  {/if}

  {#if controller.availability === 'absent'}
    <section class="panel-section" aria-label="Logbook provider not detected">
      <h3 class="caps-label">Not detected</h3>
      <p class="muted-note" role="status">
        No logbook provider was found on the server, so entries have nowhere to save yet.
      </p>
      <p class="muted-note">
        The Logbook plugin runs on the Signal K server, keeps the log as plain files on the boat,
        and adds position, heading, speed, wind, and barometer to every entry. An administrator can
        install and enable signalk-logbook from the Signal K App Store.
      </p>
      <div class="panel-controls">
        <button
          type="button"
          class="btn btn-ghost"
          disabled={controller.checking}
          onclick={() => void controller.recheck()}
        >
          {controller.checking ? 'Checking…' : 'Check again'}
        </button>
      </div>
    </section>
  {:else if controller.availability === 'unauthorized'}
    <section class="panel-section" aria-label="Logbook access">
      <h3 class="caps-label">Access</h3>
      <p class="muted-note">
        This logbook requires a Signal K administrator browser session. Sign in to Signal K, then
        check again.
      </p>
      <div class="panel-controls">
        <a class="btn" href={loginUrl} target="_blank" rel="noopener noreferrer"
          >Sign in to Signal K (new tab)</a
        >
        <button
          type="button"
          class="btn btn-ghost"
          disabled={controller.checking}
          onclick={() => void controller.recheck()}
        >
          {controller.checking ? 'Checking…' : 'Check again'}
        </button>
      </div>
    </section>
  {:else if controller.availability === 'error'}
    <section class="panel-section" aria-label="Logbook connection">
      <p class="alert-note" role="alert">Could not reach the logbook. Check the connection.</p>
      <div class="panel-controls">
        <button
          type="button"
          class="btn"
          disabled={controller.checking}
          onclick={() => void controller.recheck()}
        >
          {controller.checking ? 'Retrying…' : 'Retry'}
        </button>
      </div>
    </section>
  {:else if controller.availability === 'unknown'}
    <p class="muted-note" role="status">Checking for the logbook provider…</p>
  {:else}
    <section class="panel-section" aria-label="New entry">
      <h3 class="caps-label">New entry</h3>
      {#if controller.suggestion}
        <p class="muted-note" role="status">
          Suggested at {formatClockTime(controller.suggestion.offeredAt)}. Nothing is logged until
          you tap Log it.
        </p>
        {#if !offerInComposer}
          <p class="card-frame suggested-text">{controller.suggestion.text}</p>
        {/if}
      {/if}
      <label class="entry-field">
        <span class="field-label">Entry text</span>
        <textarea
          class="input"
          bind:value={controller.draft}
          maxlength={MAX_LOGBOOK_TEXT_LENGTH}
          rows="3"
          placeholder="What happened, in your own words"
        ></textarea>
      </label>
      <div class="panel-controls">
        <button
          type="button"
          class="btn btn-primary"
          disabled={writesDisabled || controller.draft.trim() === ''}
          onclick={() => void submit()}
        >
          {controller.busy ? 'Logging…' : offerInComposer ? 'Log it' : 'Add entry'}
        </button>
        {#if controller.suggestion && !offerInComposer}
          <button type="button" class="btn" onclick={useSuggestion}>Use suggestion</button>
        {/if}
        {#if controller.suggestion}
          <button type="button" class="btn btn-ghost" onclick={dismissSuggestion}>Dismiss</button>
        {/if}
      </div>
      <p class="muted-note muted-note--xs">
        Position, heading, speed, wind, and barometer are added by the server when the entry is
        logged.
      </p>
    </section>

    <section class="panel-section" aria-label="Recent entries">
      <h3 class="caps-label">Recent entries</h3>
      <button
        type="button"
        class="btn btn-ghost"
        disabled={controller.refreshing}
        onclick={() => void controller.refresh()}
      >
        {controller.refreshing ? 'Refreshing entries…' : 'Refresh entries'}
      </button>
      {#if controller.lastCheckedMs !== undefined}
        <p class="muted-note">
          Last checked {formatMonthDay(controller.lastCheckedMs)}
          {formatDayClock(controller.lastCheckedMs, { zone: true })}.
        </p>
      {/if}
      {#if controller.loadState === 'loading'}
        <p class="muted-note" role="status">Loading recent entries…</p>
      {:else if controller.loadState === 'error'}
        <p class="alert-note" role="alert">
          Could not load recent entries. Anything already received stays listed below.
        </p>
        <div class="panel-controls">
          <button type="button" class="btn" onclick={() => void controller.refresh()}>Retry</button>
        </div>
      {/if}
      {#if controller.loadState === 'ready' && controller.entries.length === 0}
        <p class="muted-note">No entries in the last two days. Add the first one above.</p>
      {:else if controller.entries.length > 0}
        {#each dayGroups as group (group.key)}
          <h4 class="caps-label">{group.label}</h4>
          <ul class="bare-list entry-list">
            {#each group.entries as entry (entry.datetime)}
              <li class="entry">
                <span class="num when">{formatClockTime(entry.timeMs)}</span>
                {#if entry.text}
                  <span class="entry-text">{entry.text}</span>
                {:else}
                  <span class="entry-text auto-entry">
                    Automatic entry: position and conditions recorded.
                  </span>
                {/if}
                {#if entry.category && entry.category !== 'navigation'}
                  <span class="caps-label category">{entry.category}</span>
                {/if}
              </li>
            {/each}
          </ul>
        {/each}
        <p class="muted-note muted-note--xs">
          The last two logged days are shown. The full log lives in the Logbook webapp on the Signal
          K server.
        </p>
      {/if}
    </section>
  {/if}
</SlideOver>

<style>
.entry-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.entry-field textarea {
  resize: vertical;
}
.field-label {
  font-size: var(--text-sm);
  color: var(--text-muted);
}
.suggested-text {
  margin: 0;
  padding: var(--space-2);
  overflow-wrap: anywhere;
}
.entry-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.entry {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  font-size: var(--text-sm);
}
.when {
  flex-shrink: 0;
  color: var(--text-muted);
}
.entry-text {
  overflow-wrap: anywhere;
}
.auto-entry {
  color: var(--text-muted);
}
.category {
  flex-shrink: 0;
  margin-inline-start: auto;
  color: var(--text-muted);
}
</style>
