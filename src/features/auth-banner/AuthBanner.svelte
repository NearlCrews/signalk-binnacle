<script lang="ts">
import type { AuthController } from '$shared/signalk';

interface Props {
  auth: AuthController;
  requestsUrl: string;
}

const { auth, requestsUrl }: Props = $props();
</script>

{#if auth.status === 'requesting'}
  <div class="auth-banner" role="status" aria-live="polite">
    <p class="lead">
      Binnacle needs your approval to save routes, waypoints, and alarms to the boat.
      <a
        class="btn btn-primary btn-pill"
        href={requestsUrl}
        target="_blank"
        rel="noopener noreferrer"
      >
        Approve in Signal K
      </a>
    </p>
    <p class="muted-note">
      Approve <strong>{auth.clientId}</strong> in Signal K under Security, then Access Requests, and
      this connects on its own. Grants <strong>read and write</strong>: routes, waypoints, tracks,
      course control, alarms, and profiles all save to the server.
    </p>
  </div>
{:else if auth.status === 'denied'}
  <div class="auth-banner denied" role="alert">
    Access was denied.
    <button type="button" class="btn btn-ghost btn-pill" onclick={() => auth.requestAccess()}>
      Request again
    </button>
  </div>
{:else if auth.upgrading}
  <div class="auth-banner" role="status" aria-live="polite">
    Requesting read and write access as <strong>{auth.upgradeClientId ?? auth.clientId}</strong>.
    Approve it in Signal K under Security, then Access Requests; the current read-only access keeps
    working until then.
    <a class="btn btn-ghost btn-pill" href={requestsUrl} target="_blank" rel="noopener noreferrer">
      Approve in Signal K
    </a>
  </div>
{:else if auth.writeBlocked}
  <div class="auth-banner warn" role="status" aria-live="polite">
    Binnacle has read-only access. Saving routes, waypoints, tracks, course, alarms, and radar
    controls needs read and write.
    <button type="button" class="btn btn-ghost btn-pill" onclick={() => auth.requestWriteAccess()}>
      Request read/write access
    </button>
  </div>
{/if}

<style>
.auth-banner {
  padding: var(--space-2) var(--space-4);
  font-size: var(--text-base);
  background: var(--surface-raised);
  color: var(--text);
  border-block-end: 1px solid var(--border);
}
.auth-banner.denied {
  color: var(--alarm);
}
/* Read-only access is a capability limit, not a danger, so it reads as a warning, not an alarm, and is
   announced politely. This keeps a bright-red pixel off the screen at night. */
.auth-banner.warn {
  color: var(--warning);
}
.auth-banner p {
  margin: 0;
}
.auth-banner p + p {
  margin-block-start: var(--space-1);
}
/* The action reuses the shared .btn .btn-primary .btn-pill vocabulary; only the display is
   overridden, since this button sits inline within a sentence rather than in a panel button row. */
.auth-banner .btn {
  display: inline-flex;
  margin-inline-start: var(--space-2);
  vertical-align: middle;
  text-decoration: none;
}
</style>
