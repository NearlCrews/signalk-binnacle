<script lang="ts">
import type { LatestWriterState } from '$shared/lib';

interface Props {
  state: LatestWriterState;
  errorMessage: string;
  onRetry: () => void;
}

const { state, errorMessage, onRetry }: Props = $props();
</script>

{#if state === 'saving'}
  <p class="muted-note save-status" role="status">Saving…</p>
{:else if state === 'saved'}
  <p class="muted-note save-status" role="status">Saved.</p>
{:else if state === 'error'}
  <div class="save-error" role="alert">
    <p class="alert-note">{errorMessage}</p>
    <button type="button" class="btn btn-ghost" onclick={onRetry}>Try again</button>
  </div>
{/if}

<style>
.save-status,
.save-error p {
  margin: 0;
}
.save-error {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}
</style>
