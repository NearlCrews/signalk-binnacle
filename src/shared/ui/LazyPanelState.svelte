<script lang="ts">
import { dialog } from './dialog';
import LoadNote from './LoadNote.svelte';
import PanelHeader from './PanelHeader.svelte';

interface Props {
  title: string;
  closeLabel: string;
  state: 'loading' | 'error';
  message: string;
  onClose: () => void;
  onBack?: () => void;
  backLabel?: string;
  onRetry?: () => void;
}

const { title, closeLabel, state, message, onClose, onBack, backLabel, onRetry }: Props = $props();
</script>

<!-- The pending frame deliberately has no outro. When the import settles it must leave before the
     real, animated SlideOver mounts, or both named landmarks and both sets of controls coexist. -->
<aside
  class="slide-over slide-over--dock-left"
  aria-label={title}
  tabindex="-1"
  use:dialog={onClose}
>
  <PanelHeader {title} {closeLabel} {onClose} {onBack} {backLabel} />
  <!-- Safari requires an independently scrollable region to be keyboard focusable. -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <!-- biome-ignore lint/a11y/noNoninteractiveTabindex: Safari requires this scroll region in the tab order. -->
  <div class="panel-body panel-body--flex" tabindex="0">
    <LoadNote state={state === 'loading' ? 'loading' : 'error'} {message} {onRetry} />
  </div>
</aside>
