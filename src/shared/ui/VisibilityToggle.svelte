<script lang="ts">
import { resolveToggleDescription, type VisibilityToggleProps } from './visibility-toggle';

interface Props extends VisibilityToggleProps {
  // The row's own name, so a list of these switches is distinguishable to a screen reader.
  itemName?: string;
}

const { visible, onToggle, disabled = false, description, describedBy, itemName }: Props = $props();

const ownDescriptionId = $props.id();
const described = $derived(
  resolveToggleDescription({ description, describedBy }, ownDescriptionId),
);
// The name never flips with the state; the switch's checked state carries that.
const name = $derived(itemName ? `Show ${itemName} on chart` : 'Show on chart');
</script>

<label class="visibility-toggle" title={description ?? name}>
  <!-- biome-ignore-start lint/a11y/useAriaPropsForRole: a native checkbox carries its checked state to the switch role; ARIA in HTML forbids aria-checked where the native attribute exists. -->
  <input
    type="checkbox"
    role="switch"
    aria-label={name}
    aria-describedby={described.describedBy}
    checked={visible}
    {disabled}
    onchange={(e) => onToggle(e.currentTarget.checked)}
  >
  <!-- biome-ignore-end lint/a11y/useAriaPropsForRole: the range above is the native switch input. -->
</label>
{#if described.ownText}
  <span id={described.describedBy} class="visually-hidden">{described.ownText}</span>
{/if}

<style>
/* The switch is smaller than the gloved-hand floor, so its label carries the 44 px target. */
.visibility-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-inline-size: var(--control-size);
  min-block-size: var(--control-size);
  cursor: pointer;
}
</style>
