<script lang="ts">
import ArrowDown from '@lucide/svelte/icons/arrow-down';
import ArrowUp from '@lucide/svelte/icons/arrow-up';
import OverflowActions from './OverflowActions.svelte';

interface Props {
  label: string;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove: (direction: -1 | 1) => void;
}

const { label, canMoveUp, canMoveDown, onMove }: Props = $props();
let open = $state(false);
</script>

<OverflowActions
  {open}
  label={`Reorder ${label}`}
  onToggle={() => (open = !open)}
  onClose={() => (open = false)}
>
  <button
    type="button"
    role="menuitem"
    class="menu-item"
    disabled={!canMoveUp}
    onclick={() => onMove(-1)}
  >
    <ArrowUp size={18} aria-hidden="true" />
    Move up
  </button>
  <button
    type="button"
    role="menuitem"
    class="menu-item"
    disabled={!canMoveDown}
    onclick={() => onMove(1)}
  >
    <ArrowDown size={18} aria-hidden="true" />
    Move down
  </button>
</OverflowActions>
