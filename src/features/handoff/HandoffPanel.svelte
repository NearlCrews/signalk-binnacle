<script lang="ts">
import { onDestroy, onMount } from 'svelte';
import { MAX_HANDOFF_NOTE_LENGTH } from '$entities/handoff';
import { Clock, formatClockTime, formatMonthDay, MINUTE_MS } from '$shared/lib';
import { InlineConfirm, restoreFocusAfterCancel, SlideOver } from '$shared/ui';
import type { HandoffController } from './handoff-controller.svelte';

interface Props {
  controller: HandoffController;
  onClose: () => void;
  onBack?: () => void;
}

const { controller, onClose, onBack }: Props = $props();

let discardArmed = $state(false);
let discardTrigger = $state<HTMLButtonElement>();

// A coarse minute tick keeps the snapshot ages honest during a long-open panel.
const clock = new Clock(MINUTE_MS);
onDestroy(() => clock.dispose());
onMount(() => {
  void controller.refresh();
});

function takeSnapshot(): void {
  if (controller.create(controller.draft)) controller.draft = '';
}

function ageText(createdAt: number): string {
  const minutes = Math.max(0, Math.round((clock.now - createdAt) / MINUTE_MS));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${(minutes % 60).toString().padStart(2, '0')}m ago`;
}

const SYNC_LABELS = {
  shared: 'Shared with other stations',
  pending: 'Waiting to sync',
  'device-only': 'On this device only',
} as const;
</script>

<SlideOver title="Watch handoff" closeLabel="Close watch handoff" {onClose} {onBack} bodyFlex>
  <p class="muted-note">
    Review status with the oncoming watch: a timestamped snapshot of what this station sees, with a
    short note. It records conditions to review together. It is never a statement that it is safe to
    take watch.
  </p>

  <section class="panel-section" aria-label="New snapshot">
    <h3 class="caps-label">New snapshot</h3>
    {#if controller.error}
      <p class="alert-note" role="alert">{controller.error}</p>
    {/if}
    <label class="note-field">
      <span class="caps-label">Note for the oncoming watch</span>
      <textarea
        class="input"
        bind:value={controller.draft}
        maxlength={MAX_HANDOFF_NOTE_LENGTH}
        rows="3"
        placeholder="Sea state, traffic, engine, anything to watch"
      ></textarea>
    </label>
    <button
      type="button"
      class="btn btn-primary"
      disabled={controller.queueFull}
      onclick={takeSnapshot}
    >
      Take handoff snapshot
    </button>
    {#if controller.draft}
      <p class="muted-note">
        This note stays while this app is open, including when you change panels. Reloading or
        closing the app loses an unsaved note.
      </p>
      {#if discardArmed}
        <InlineConfirm
          question="Discard this handoff note?"
          onCancel={() => {
            discardArmed = false;
            void restoreFocusAfterCancel(() => discardTrigger);
          }}
          onConfirm={() => {
          controller.draft = '';
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
          Discard note
        </button>
      {/if}
    {/if}
    <p class="muted-note">
      Taking a snapshot changes nothing else: no alarms are acknowledged and no navigation is
      altered.
    </p>
  </section>

  <section class="panel-section" aria-label="Snapshots">
    <h3 class="caps-label">Snapshots</h3>
    {#if controller.pendingCount > 0}
      <p class="muted-note" role="status">
        {controller.pendingCount}
        of 10 offline queue slots used.{controller.queueFull ? ' Sync queued snapshots before taking another. No queued records have been removed.' : ''}
      </p>
      <button
        type="button"
        class="btn"
        disabled={controller.syncing}
        onclick={() => void controller.syncDrafts()}
      >
        {controller.syncing ? 'Syncing snapshots…' : 'Retry syncing'}
      </button>
    {/if}
    {#if controller.memoryOnly}
      <p class="alert-note" role="alert">
        Device storage could not be updated. Changes are in memory only; keep this app open until
        syncing finishes.
      </p>
    {/if}
    {#if controller.loadState === 'loading' && controller.records.length === 0}
      <p class="muted-note" role="status">Loading shared snapshots…</p>
    {:else if controller.loadState === 'unavailable'}
      <p class="muted-note" role="status">
        The server's shared store is unavailable, so snapshots stay on this device and sync when it
        returns.
      </p>
    {/if}
    {#if controller.records.length === 0 && controller.loadState !== 'loading'}
      <p class="muted-note">No snapshots yet.</p>
    {:else}
      <ul class="bare-list snapshot-list">
        {#each controller.records as record (record.id)}
          <li class="card-frame snapshot">
            <div class="snapshot-head">
              <span class="num when">
                {formatClockTime(record.createdAt)}
                {formatMonthDay(record.createdAt)}
              </span>
              <span class="muted-note age">{ageText(record.createdAt)}</span>
              <span class="caps-label sync" class:sync-shared={record.sync === 'shared'}>
                {SYNC_LABELS[record.sync]}
              </span>
            </div>
            {#if record.note}
              <p class="snapshot-note">{record.note}</p>
            {/if}
            {#if record.facts.length > 0}
              <dl class="detail-list facts">
                {#each record.facts as fact (fact.label)}
                  <div class="item">
                    <dt>{fact.label}</dt>
                    <dd>{fact.value}</dd>
                  </div>
                {/each}
              </dl>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </section>
</SlideOver>

<style>
.note-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.note-field textarea {
  resize: vertical;
}
.snapshot-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.snapshot {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-2);
}
/* The header wraps at 320 px instead of overflowing: clock, age, and the sync chip each keep
   their own line when squeezed. */
.snapshot-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-1) var(--space-2);
}
.age {
  margin: 0;
}
.sync {
  margin-inline-start: auto;
  color: var(--text-muted);
}
.sync-shared {
  color: var(--text);
}
.snapshot-note {
  margin: 0;
  overflow-wrap: anywhere;
}
.facts dd {
  overflow-wrap: anywhere;
  text-align: end;
}
</style>
