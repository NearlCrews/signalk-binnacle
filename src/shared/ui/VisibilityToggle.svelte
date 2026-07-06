<script lang="ts">
import { Eye, EyeOff } from '@lucide/svelte';

interface Props {
  // Whether the item is currently visible on the chart.
  visible: boolean;
  onToggle: (visible: boolean) => void;
}

const { visible, onToggle }: Props = $props();
</script>

<button
  type="button"
  class="icon-btn"
  aria-pressed={visible}
  aria-label={visible ? 'Hide on chart' : 'Show on chart'}
  title={visible ? 'Hide on chart' : 'Show on chart'}
  onclick={() => onToggle(!visible)}
>
  {#if visible}
    <Eye size={18} aria-hidden="true" />
  {:else}
    <EyeOff size={18} aria-hidden="true" />
  {/if}
</button>
