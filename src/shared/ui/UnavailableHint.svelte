<script lang="ts">
// A screen-reader-only explanation of why a control is grayed out, paired with a matching `title`
// attribute on the control. The title is mouse-only, so this announces the same reason to assistive
// technology. Shared by the layer rows, the app-menu tiles, and the bottom-bar pills so every grayed
// surface explains itself with identical markup. Renders nothing when there is no hint.
const { hint, id }: { hint?: string; id?: string } = $props();
</script>

{#if hint}
  <span {id} class="visually-hidden">{hint}</span>
{/if}
