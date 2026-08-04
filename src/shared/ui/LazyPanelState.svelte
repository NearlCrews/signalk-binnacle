<script lang="ts">
import { dialog } from './dialog';
import PanelHeader from './PanelHeader.svelte';

interface Props {
  title: string;
  closeLabel: string;
  state: 'loading' | 'error';
  message: string;
  // The edge the pending frame docks to. It must match the dock of the SlideOver being loaded, since
  // the two dock modifiers carry different border sides and the frame would otherwise border the
  // wrong edge until the import settles.
  dock?: 'left' | 'right';
  onClose: () => void;
  onBack?: () => void;
  backLabel?: string;
  onRetry?: () => void;
}

const {
  title,
  closeLabel,
  state,
  message,
  dock = 'left',
  onClose,
  onBack,
  backLabel,
  onRetry,
}: Props = $props();
</script>

<!-- The pending frame deliberately has no outro. When the import settles it must leave before the
     real, animated SlideOver mounts, or both named landmarks and both sets of controls coexist. -->
<aside
  class="slide-over slide-over--dock-{dock}"
  aria-label={title}
  tabindex="-1"
  use:dialog={onClose}
>
  <PanelHeader {title} {closeLabel} {onClose} {onBack} {backLabel} />
  <div class="panel-body panel-body--flex">
    {#if state === 'loading'}
      <div class="panel-loading" role="status">{message}</div>
    {:else}
      <div class="panel-load-error" role="alert">
        <span>{message}</span>
        {#if onRetry}
          <button type="button" class="btn btn-ghost" onclick={onRetry}>Retry</button>
        {/if}
      </div>
    {/if}
  </div>
</aside>
