<script lang="ts">
import { Trash2 } from '@lucide/svelte';
import type { LatestWriterState } from '$shared/lib';
import { Disclosure, InlineConfirm, SaveStatus, UnitField } from '$shared/ui';
import { formatBySource } from './estimate.js';
import type { CacheStats } from './regions-client.js';

type FormattedBytes = { value: string; unit: string };

interface Props {
  stats: CacheStats | null;
  usedPercent: number;
  used: FormattedBytes | null;
  cap: FormattedBytes | null;
  pinned: FormattedBytes | null;
  scroll: FormattedBytes | null;
  automatic: FormattedBytes | null;
  ttlDays: number;
  writerState: LatestWriterState;
  adminAccess: boolean;
  confirmingClear: boolean;
  clearNote: string | null;
  chartLabel: (id: string) => string;
  onCommitTtl: (days: number) => void;
  onRetryTtl: () => void;
  onRequestClear: () => void;
  onConfirmClear: () => void;
  onCancelClear: () => void;
}

const {
  stats,
  usedPercent,
  used,
  cap,
  pinned,
  scroll,
  automatic,
  ttlDays,
  writerState,
  adminAccess,
  confirmingClear,
  clearNote,
  chartLabel,
  onCommitTtl,
  onRetryTtl,
  onRequestClear,
  onConfirmClear,
  onCancelClear,
}: Props = $props();
</script>

<section class="panel-section" aria-label="Storage">
  {#if stats !== null}
    <div
      class="storage-track"
      role="progressbar"
      aria-label="Offline chart storage used"
      aria-valuemin="0"
      aria-valuemax="100"
      aria-valuenow={usedPercent}
      aria-valuetext={`${usedPercent}% used`}
    >
      <div class="storage-fill" style:inline-size="{usedPercent}%"></div>
    </div>
    <p class="muted-note">{usedPercent}% of offline chart storage is in use.</p>
    <dl class="stat-grid">
      <dt>Storage used</dt>
      <dd>
        <span class="num">{used?.value ?? '--'}</span>
        <span class="unit">{used?.unit ?? ''} of {cap?.value ?? '--'} {cap?.unit ?? ''}</span>
      </dd>
      <dt>Saved areas</dt>
      <dd>
        <span class="num">{pinned?.value ?? '--'}</span>
        <span class="unit">{pinned?.unit ?? ''}</span>
      </dd>
      <dt>Recently viewed</dt>
      <dd>
        <span class="num">{scroll?.value ?? '--'}</span>
        <span class="unit">{scroll?.unit ?? ''}</span>
      </dd>
      <dt>Automatic caching</dt>
      <dd>
        <span class="num">{automatic?.value ?? '--'}</span>
        <span class="unit">{automatic?.unit ?? ''}</span>
      </dd>
    </dl>
    <p class="muted-note">
      Saved areas are kept until you delete them. Recently viewed charts follow the auto-clear
      setting. Automatic caching follows the boat as it moves.
    </p>
    <Disclosure label="Recently viewed, by chart">
      <dl class="stat-grid">
        {#each formatBySource(stats) as row (row.source)}
          <dt>{chartLabel(row.source)}</dt>
          <dd><span class="num">{row.value}</span> <span class="unit">{row.unit}</span></dd>
        {/each}
      </dl>
    </Disclosure>
  {:else}
    <p class="muted-note" role="status">Loading storage…</p>
  {/if}
  <UnitField
    label="Auto-clear after"
    unit="days"
    value={ttlDays}
    min={0}
    max={365}
    step={1}
    onCommit={onCommitTtl}
  />
  <p class="muted-note">
    Set this to 0 to keep recently viewed charts until storage pressure clears them.
  </p>
  <SaveStatus
    state={writerState}
    errorMessage="Could not save the auto-clear setting."
    onRetry={onRetryTtl}
  />
  {#if confirmingClear}
    <InlineConfirm
      question="Clear recently viewed charts? Your saved areas are kept."
      onConfirm={onConfirmClear}
      onCancel={onCancelClear}
    />
  {:else}
    <div class="panel-controls">
      <button type="button" class="btn btn-danger" disabled={!adminAccess} onclick={onRequestClear}>
        <Trash2 size={16} aria-hidden="true" />
        Clear recently viewed
      </button>
    </div>
  {/if}
  {#if clearNote !== null}
    <p class="muted-note">{clearNote}</p>
  {/if}
</section>

<style>
.storage-track {
  block-size: var(--range-track-h);
  border-radius: var(--radius-pill);
  background: var(--border);
  overflow: hidden;
}
.storage-fill {
  block-size: 100%;
  background: var(--accent);
  transition: inline-size var(--transition-fast);
}
</style>
