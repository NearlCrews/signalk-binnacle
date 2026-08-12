<script lang="ts">
import { UPGRADE_OUTCOME_COPY, type UpgradeOutcome } from '$shared/signalk';

interface Props {
  // What is blocked, in the panel's own words: only the note-and-button structure is shared.
  message: string;
  // A read and write request is already outstanding, so the request control reports itself, rests,
  // and tells the requester where the human approval happens.
  requesting?: boolean;
  // Ask the server for read and write access. Optional, because a host that cannot make the request
  // (the note detail panel, whose caller wires it conditionally) still owes the reader the note.
  onRequest?: () => void;
  // How the last upgrade attempt ended, so the outcome lands beside the button that asked instead
  // of only in the app-wide banner an open phone sheet covers.
  outcome?: UpgradeOutcome;
}

const { message, requesting = false, onRequest, outcome }: Props = $props();

const outcomeCopy = $derived(outcome ? UPGRADE_OUTCOME_COPY[outcome] : undefined);
</script>

<!-- The write-blocked notice with its own request control, so a panel that cannot save says so and
     offers the fix in place rather than sending the navigator hunting for the global banner. -->
<p class="muted-note" role="status">{message}</p>
{#if outcomeCopy && !requesting}
  <p class="muted-note" role="status">{outcomeCopy.message}</p>
{/if}
{#if onRequest}
  <button type="button" class="btn btn-ghost" disabled={requesting} onclick={onRequest}>
    {requesting ? 'Requesting access…' : (outcomeCopy?.action ?? 'Request read and write access')}
  </button>
{/if}
{#if requesting}
  <p class="muted-note" role="status">
    Waiting for approval in Signal K under Security, then Access Requests. Read-only keeps working
    until then.
  </p>
{/if}
