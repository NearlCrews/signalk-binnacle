<script lang="ts">
import type { Snippet } from 'svelte';

// One category section inside a customize list: a caps heading over the category's rows. The
// heading names the section programmatically, so a screen reader reaching the rows knows which
// category it is in rather than relying on the visual order. Shared so the customize panels cannot
// drift in either the heading rhythm or the naming.
interface Props {
  // The heading's element id, which the section is labelled by. Unique within the document.
  id: string;
  label: string;
  children: Snippet;
}

const { id, label, children }: Props = $props();
</script>

<section aria-labelledby={id}>
  <h4 class="caps-label group-label" {id}>{label}</h4>
  {@render children()}
</section>

<style>
.group-label {
  margin-block: var(--space-2) var(--space-1);
  padding-inline: var(--space-3);
}
</style>
