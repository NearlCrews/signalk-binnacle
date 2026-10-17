<script lang="ts">
import type { LoadNoteState } from './load-note';

interface Props {
  state: LoadNoteState;
  message: string;
  onRetry?: () => void;
  // A failed request retries; a capability probe (does the server store routes at all) checks again.
  retryKind?: 'request' | 'probe';
  // The object of a request retry, for the accessible name when a panel can show more than one.
  retryName?: string;
  // A whole accessible name, for a retry that is not a load (Retry profile sync).
  retryLabel?: string;
}

const { state, message, onRetry, retryKind = 'request', retryName, retryLabel }: Props = $props();

const label = $derived(retryKind === 'probe' ? 'Check again' : 'Retry');
const accessibleName = $derived(
  retryLabel ?? (retryKind === 'request' && retryName ? `Retry loading ${retryName}` : undefined),
);
</script>

{#if state === 'error'}
  <!-- The alert is the message alone, so the retry control is not read out as part of it. -->
  <div class="load-note">
    <p class="alert-note" role="alert">{message}</p>
    {#if onRetry}
      <button type="button" class="btn btn-ghost" aria-label={accessibleName} onclick={onRetry}>
        {label}
      </button>
    {/if}
  </div>
{:else}
  <p class="muted-note" role="status">{message}</p>
{/if}

<style>
/* The Retry fills its row, like every lone action. */
.load-note {
  display: grid;
  gap: var(--space-2);
}
.load-note p {
  margin: 0;
}
</style>
