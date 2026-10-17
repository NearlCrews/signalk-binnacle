<script lang="ts">
import { type AuthController, UPGRADE_OUTCOME_COPY } from '$shared/signalk';

interface Props {
  auth: AuthController;
  requestsUrl: string;
  insecureTransport?: boolean;
  // Dismiss the not-encrypted warning on this device. A warning a navigator cannot act on without
  // server-side work, shown on every load forever, trains them to ignore warnings; the durable
  // copy lives in Help's Signal K access section. Absent leaves the banner permanent.
  onDismissInsecure?: () => void;
}

const { auth, requestsUrl, insecureTransport = false, onDismissInsecure }: Props = $props();
</script>

<!-- Every state reads the same way: the words, then the one action that fixes it (primary) or a
     Dismiss (ghost), as a group on the trailing edge that wraps below the words on a narrow screen. -->
{#if auth.status === 'requesting'}
  <div class="auth-banner action-note action-note--wrap" role="status" aria-live="polite">
    <div class="banner-text">
      <p class="lead">
        This Signal K server requires approval before Binnacle can connect and save to the boat.
      </p>
      <p class="muted-note">
        Approve <strong>{auth.clientId}</strong> in Signal K under Security, then Access Requests,
        and leave this tab open. Binnacle connects automatically after approval. Grant
        <strong>read and write</strong>
        so routes, waypoints, personal notes, tracks, course control, alarms, and profiles can use
        the server. Approval needs the server admin's sign-in, so ask the boat's admin if that is
        not you.
      </p>
    </div>
    <div class="action-group">
      <a class="btn btn-primary" href={requestsUrl} target="_blank" rel="noopener noreferrer">
        Approve in Signal K
      </a>
    </div>
  </div>
{:else if auth.status === 'denied' && auth.accessOutcome}
  <div class="auth-banner warn action-note action-note--wrap" role="status" aria-live="polite">
    <div class="banner-text">
      <p>
        {auth.accessOutcome === 'unreachable'
          ? 'Could not reach the Signal K server to request access, so Binnacle cannot read or save boat data yet.'
          : 'The access request was not approved in time. It may still be waiting in Signal K under Security, then Access Requests.'}
      </p>
      <p class="muted-note">
        Trying again keeps the same device ID, <strong>{auth.clientId}</strong>, so an approval
        already waiting in Signal K still counts. Grant <strong>read and write</strong> when
        approving. Approval needs the server admin's sign-in, so ask the boat's admin if that is not
        you.
      </p>
    </div>
    <div class="action-group">
      <button type="button" class="btn btn-primary" onclick={() => auth.requestAccess()}>
        Try again
      </button>
    </div>
  </div>
{:else if auth.status === 'denied'}
  <div class="auth-banner denied action-note action-note--wrap" role="alert">
    <div class="banner-text">
      <p>
        Signal K declined access for <strong>{auth.clientId}</strong>, so Binnacle cannot read or
        save boat data.
      </p>
      <p class="muted-note">
        Requesting again introduces Binnacle under a new device ID, since a refused one stays
        refused. Approve the newest entry in Signal K under Security, then Access Requests, and
        grant
        <strong>read and write</strong>
        so routes, waypoints, personal notes, tracks, course control, alarms, and profiles can use
        the server. Approval needs the server admin's sign-in, so ask the boat's admin if that is
        not you.
      </p>
    </div>
    <div class="action-group">
      <button type="button" class="btn btn-primary" onclick={() => auth.requestAccess()}>
        Request again
      </button>
    </div>
  </div>
{:else if auth.upgrading}
  <div class="auth-banner action-note action-note--wrap" role="status" aria-live="polite">
    <p class="banner-text">
      Requesting read and write access as <strong>{auth.upgradeClientId ?? auth.clientId}</strong>.
      Approve it in Signal K under Security, then Access Requests; the current read-only access
      keeps working until then. Approval needs the server admin's sign-in, so ask the boat's admin
      if that is not you.
    </p>
    <div class="action-group">
      <a class="btn btn-primary" href={requestsUrl} target="_blank" rel="noopener noreferrer">
        Approve in Signal K
      </a>
    </div>
  </div>
{:else if auth.upgradeOutcome}
  {@const outcomeCopy = UPGRADE_OUTCOME_COPY[auth.upgradeOutcome]}
  <div class="auth-banner warn action-note action-note--wrap" role="status" aria-live="polite">
    <p class="banner-text">{outcomeCopy.message}</p>
    <div class="action-group">
      <button type="button" class="btn btn-primary" onclick={() => auth.requestWriteAccess()}>
        {outcomeCopy.action}
      </button>
    </div>
  </div>
{:else if auth.writeBlocked}
  <div class="auth-banner warn action-note action-note--wrap" role="status" aria-live="polite">
    <p class="banner-text">
      Binnacle has read-only access. Saving routes, waypoints, personal notes, tracks, course,
      alarms, and radar controls needs read and write.
    </p>
    <div class="action-group">
      <button type="button" class="btn btn-primary" onclick={() => auth.requestWriteAccess()}>
        Request read and write access
      </button>
    </div>
  </div>
{/if}

{#if insecureTransport}
  <div class="auth-banner warn action-note action-note--wrap" role="status">
    <p class="banner-text">
      This connection is not encrypted. Signal K device credentials and boat data can be observed on
      this network. Enable HTTPS in Signal K to protect them.
    </p>
    {#if onDismissInsecure}
      <div class="action-group">
        <button type="button" class="btn btn-ghost" onclick={onDismissInsecure}>Dismiss</button>
      </div>
    {/if}
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
/* The words take the row; the action group keeps its own width beside them. */
.banner-text {
  flex: 1 1 20rem;
  margin: 0;
}
.banner-text p {
  margin: 0;
}
.banner-text p + p {
  margin-block-start: var(--space-1);
}
</style>
