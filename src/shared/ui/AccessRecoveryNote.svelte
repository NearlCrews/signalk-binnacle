<script lang="ts">
import type { AccessRecoveryState } from './access-recovery.js';

let {
  state,
  capability,
  accessUrl,
  onRetry,
}: {
  state: AccessRecoveryState;
  capability: string;
  accessUrl: string;
  onRetry: () => void;
} = $props();

const message = $derived.by(() => {
  if (state === 'needs-login') {
    return `Sign in to Signal K as an administrator to ${capability}.`;
  }
  if (state === 'needs-admin') return 'The current Signal K user is not an administrator.';
  if (state === 'checking') return 'Checking Chart Locker administrator access.';
  if (state === 'access-error') {
    return 'Signal K reports an administrator session, but Chart Locker refused it. Retry after the server finishes updating.';
  }
  return 'Chart Locker is not responding. Check the Signal K connection, then retry.';
});
const canSignIn = $derived(state === 'needs-login' || state === 'needs-admin');
const accessLabel = $derived(
  state === 'needs-admin' ? 'Sign in as an administrator' : 'Sign in to Signal K',
);
const canRetry = $derived(state === 'access-error' || state === 'offline' || state === 'error');
</script>

<div class="muted-note access-note" role="status">
  <span>{message}</span>
  {#if canSignIn}
    <a class="btn btn-ghost" href={accessUrl}>{accessLabel}</a>
  {:else if canRetry}
    <button type="button" class="btn btn-ghost" onclick={onRetry}>Retry access</button>
  {/if}
</div>

<style>
.access-note {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-2);
}
</style>
