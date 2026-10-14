<script lang="ts">
import type { EmptyStateProps } from './empty-state';

const { title, message, action }: EmptyStateProps = $props();
</script>

<div class="empty-state">
  <p class="empty-state-title">{title}</p>
  <p class="muted-note">{message}</p>
  {#if action}
    <button type="button" class={action.primary ? 'btn btn-primary' : 'btn'} onclick={action.run}>
      {action.label}
    </button>
  {/if}
</div>
