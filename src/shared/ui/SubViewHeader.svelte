<script lang="ts">
import ArrowLeft from '@lucide/svelte/icons/arrow-left';

// The back header shared by every in-panel sub-view: an accent back button and a sub-title, rendered
// inside the parent's single SlideOver. The panel-level back is suppressed by the parent while a
// sub-view is open, so this is the only back control on screen.
interface Props {
  title: string;
  backLabel?: string;
  onBack: () => void;
}

const { title, backLabel = 'Back', onBack }: Props = $props();
</script>

<header class="subview-header">
  <button type="button" class="icon-btn icon-btn--accent" aria-label={backLabel} onclick={onBack}>
    <ArrowLeft size={20} aria-hidden="true" />
  </button>
  <h3 class="panel-title panel-title--sub">{title}</h3>
</header>

<style>
.subview-header {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
</style>
