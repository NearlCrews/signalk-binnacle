<script lang="ts">
import { untrack } from 'svelte';
import ErrorBoundary from './ErrorBoundary.svelte';

interface Props {
  initiallyFailing?: boolean;
}

const { initiallyFailing = false }: Props = $props();
let failing = $state(untrack(() => initiallyFailing));

function content(): string {
  if (failing) throw new Error('render failed');
  return 'Content ready';
}
</script>

<ErrorBoundary>
  <p>{content()}</p>

  {#snippet fallback(error, reset)}
    <p role="alert">{error instanceof Error ? error.message : 'Unknown render failure'}</p>
    <button
      type="button"
      onclick={() => {
        failing = false;
        reset();
      }}
    >
      Retry render
    </button>
  {/snippet}
</ErrorBoundary>

<button type="button" onclick={() => (failing = true)}>Trigger failure</button>
