<script lang="ts">
import type { AuthController } from '$shared/signalk';

interface Props {
  auth: AuthController;
  requestsUrl: string;
  insecureTransport?: boolean;
}

const { auth, requestsUrl, insecureTransport = false }: Props = $props();
</script>

{#if auth.status === 'requesting'}
  <div class="auth-banner" role="status" aria-live="polite">
    <p class="lead">
      This Signal K server requires approval before Binnacle can connect and save to the boat.
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
      leave this tab open. Binnacle connects automatically after approval. Grant
      <strong>read and write</strong>
      so routes, waypoints, tracks, course control, alarms, and profiles can use the server.
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
{:else if auth.upgradeOutcome}
  {@const outcomeCopy = {
    declined: {
      message: 'Write access was declined. Binnacle still has read-only access.',
      action: 'Request again',
    },
    unanswered: {
      message:
        'The write access request was not approved in time. It may still be waiting in Signal K under Security, then Access Requests.',
      action: 'Request again',
    },
    unreachable: {
      message: 'Could not reach the server to request write access. Binnacle still has read-only access.',
      action: 'Try again',
    },
  }[auth.upgradeOutcome]}
  <div class="auth-banner warn" role="status" aria-live="polite">
    {outcomeCopy.message}
    <button type="button" class="btn btn-ghost btn-pill" onclick={() => auth.requestWriteAccess()}>
      {outcomeCopy.action}
    </button>
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

{#if insecureTransport}
  <div class="auth-banner warn" role="status">
    This connection is not encrypted. Signal K device credentials and boat data can be observed on
    this network. Enable HTTPS in Signal K to protect them.
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
