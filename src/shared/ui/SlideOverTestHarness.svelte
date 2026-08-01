<script lang="ts">
import SlideOver from './SlideOver.svelte';

let focusTrap = $state(false);
</script>

<button type="button" onclick={() => (focusTrap = !focusTrap)}>Toggle focus trap</button>
<SlideOver title="Stable panel" onClose={() => {}} {focusTrap}>
  <input aria-label="Panel-local value">
</SlideOver>
