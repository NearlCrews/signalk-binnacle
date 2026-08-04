<script lang="ts">
import { type ConnectionPhase, isConnectionDown } from '$shared/signalk';

interface Props {
  connectionPhase: ConnectionPhase;
}

const { connectionPhase }: Props = $props();

const down = $derived(isConnectionDown(connectionPhase));
</script>

<!-- Shared by the list and the target detail, so a dropped stream is labeled wherever the navigator
     is reading frozen traffic, not only in the empty state. -->
{#if down}
  <p class="alert-note" role="alert">
    Signal K is disconnected. Positions, closest pass, and time to closest are frozen at the last
    update received.
  </p>
{/if}
