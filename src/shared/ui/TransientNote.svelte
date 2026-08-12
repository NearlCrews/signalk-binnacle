<script lang="ts">
interface Props {
  // The transient message from a Toast; the note renders only while one is set.
  message: string | undefined;
  // The host's positioning class: each host anchors the note against its own surface.
  noteClass: string;
}

const { message, noteClass }: Props = $props();
</script>

<!-- The timed explanatory note a tap on a blocked or informational control shows, since the title
     tooltip such controls also carry is mouse-hover-only. -->
{#if message}
  <div class={`transient-note popover-card ${noteClass}`} role="status" aria-live="polite">
    <p class="muted-note">{message}</p>
  </div>
{/if}
