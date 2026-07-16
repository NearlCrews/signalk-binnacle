<script lang="ts">
import { LogOut, Trash2 } from '@lucide/svelte';
import type { PrivacyReport } from '$shared/privacy';
import { InlineConfirm } from '$shared/ui';

interface Props {
  onForgetCredentials: () => Promise<PrivacyReport>;
  onEraseAllLocalData: () => Promise<PrivacyReport>;
}

const { onForgetCredentials, onEraseAllLocalData }: Props = $props();
let confirming = $state<'credentials' | 'all' | undefined>();
let working = $state<'credentials' | 'all' | undefined>();
let report = $state<PrivacyReport | undefined>();
let actionError = $state<string | undefined>();
const reloadPending = $derived((report?.clearedOwnerIds.length ?? 0) > 0);

async function run(action: 'credentials' | 'all'): Promise<void> {
  if (working || reloadPending) return;
  working = action;
  confirming = undefined;
  report = undefined;
  actionError = undefined;
  try {
    report = action === 'credentials' ? await onForgetCredentials() : await onEraseAllLocalData();
  } catch {
    report = undefined;
    actionError = 'The local privacy action failed before it could finish. Try again.';
  } finally {
    working = undefined;
  }
}

const OWNER_LABELS: Record<string, string> = {
  'signalk-credentials': 'Signal K credentials',
  'local-settings': 'settings and profiles',
  'indexed-db': 'offline browser databases',
  'cache-storage': 'offline browser caches',
  'service-worker': 'offline service worker',
  'cross-tab-broadcast': 'other open Binnacle tabs',
};

function failureText(ownerId: string, message: string): string {
  return `${OWNER_LABELS[ownerId] ?? ownerId}: ${message}`;
}

const reportText = $derived.by(() => {
  if (actionError) return actionError;
  if (!report) return undefined;
  if (report.status === 'blocked') return report.reason ?? 'The action is blocked for safety.';
  if (report.status === 'partial') {
    return `Some local data could not be removed. ${report.failures.map((failure) => failureText(failure.ownerId, failure.message)).join(' ')} Reloading shortly.`;
  }
  return report.operation === 'forget-credentials'
    ? 'Binnacle credentials were removed from this device. Reloading…'
    : 'Binnacle local data and credentials were removed. Reloading…';
});
</script>

<section class="panel-section" aria-label="Device privacy">
  <h3 class="caps-label">Device privacy</h3>
  <p class="muted-note">
    These actions affect this device only. Server routes, waypoints, tracks, profiles, Chart Locker
    data, administrator sessions, and server-side device authorization are not deleted or revoked.
    Synced profiles return after this device signs in and syncs again. Profiles and changes that
    have not synced will be lost.
  </p>
  {#if working}
    <p class="muted-note" role="status">
      {working === 'credentials' ? 'Removing credentials…' : 'Removing local data…'}
    </p>
  {/if}
  {#if reportText}
    <p
      class:alert-note={actionError !== undefined || report?.status !== 'completed'}
      class:muted-note={report?.status === 'completed'}
      role={report?.status === 'completed' ? 'status' : 'alert'}
    >
      {reportText}
    </p>
  {/if}
  {#if confirming === 'credentials'}
    <InlineConfirm
      question="Forget Binnacle's Signal K device token on this device?"
      confirmLabel="Forget credentials"
      onConfirm={() => void run('credentials')}
      onCancel={() => (confirming = undefined)}
    />
  {:else if confirming === 'all'}
    <InlineConfirm
      question="Erase all Binnacle settings, offline browser caches, unsaved local data, profiles, and credentials from this device? Profiles and changes that have not synced will be lost."
      confirmLabel="Erase local data"
      onConfirm={() => void run('all')}
      onCancel={() => (confirming = undefined)}
    />
  {:else if !reloadPending}
    <div class="panel-controls">
      <button
        type="button"
        class="btn"
        disabled={working !== undefined}
        onclick={() => (confirming = 'credentials')}
      >
        <LogOut size={16} aria-hidden="true" />
        Forget credentials
      </button>
      <button
        type="button"
        class="btn sev-danger"
        disabled={working !== undefined}
        onclick={() => (confirming = 'all')}
      >
        <Trash2 size={16} aria-hidden="true" />
        Erase all local data
      </button>
    </div>
  {/if}
</section>
