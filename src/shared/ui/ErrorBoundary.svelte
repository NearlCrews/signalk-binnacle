<script lang="ts">
import type { Snippet } from 'svelte';

interface Props {
  children: Snippet;
  fallback: Snippet<[unknown, () => void]>;
}

const { children, fallback }: Props = $props();
</script>

<svelte:boundary>
  {@render children()}

  {#snippet failed(error: unknown, reset: () => void)}
    {@render fallback(error, reset)}
  {/snippet}
</svelte:boundary>
