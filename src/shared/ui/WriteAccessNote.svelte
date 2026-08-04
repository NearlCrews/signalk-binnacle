<script lang="ts">
interface Props {
  // What is blocked, in the panel's own words: only the note-and-button structure is shared.
  message: string;
  // A read/write request is already outstanding, so the request control reports itself and rests.
  requesting?: boolean;
  // Ask the server for read/write access. Optional, because a host that cannot make the request
  // (the note detail panel, whose caller wires it conditionally) still owes the reader the note.
  onRequest?: () => void;
}

const { message, requesting = false, onRequest }: Props = $props();
</script>

<!-- The write-blocked notice with its own request control, so a panel that cannot save says so and
     offers the fix in place rather than sending the navigator hunting for the global banner. -->
<p class="muted-note" role="status">{message}</p>
{#if onRequest}
  <button type="button" class="btn btn-ghost" disabled={requesting} onclick={onRequest}>
    {requesting ? 'Requesting access…' : 'Request read/write access'}
  </button>
{/if}
