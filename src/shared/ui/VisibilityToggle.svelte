<script lang="ts">
import Eye from '@lucide/svelte/icons/eye';
import EyeOff from '@lucide/svelte/icons/eye-off';
import type { VisibilityToggleProps } from './visibility-toggle';

type Props = Pick<VisibilityToggleProps, 'visible' | 'onToggle'>;

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
