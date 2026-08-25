<script lang="ts">
import Eye from '@lucide/svelte/icons/eye';
import EyeOff from '@lucide/svelte/icons/eye-off';
import { resolveToggleDescription, type VisibilityToggleProps } from './visibility-toggle';

const {
  visible,
  onToggle,
  disabled = false,
  description,
  describedBy,
}: VisibilityToggleProps = $props();

const ownDescriptionId = $props.id();
const described = $derived(
  resolveToggleDescription({ description, describedBy }, ownDescriptionId),
);
</script>

<button
  type="button"
  class="icon-btn"
  aria-pressed={visible}
  aria-label={visible ? 'Hide on chart' : 'Show on chart'}
  aria-describedby={described.describedBy}
  title={description ?? (visible ? 'Hide on chart' : 'Show on chart')}
  {disabled}
  onclick={() => onToggle(!visible)}
>
  {#if visible}
    <Eye size={18} aria-hidden="true" />
  {:else}
    <EyeOff size={18} aria-hidden="true" />
  {/if}
</button>
{#if described.ownText}
  <span id={described.describedBy} class="visually-hidden">{described.ownText}</span>
{/if}
