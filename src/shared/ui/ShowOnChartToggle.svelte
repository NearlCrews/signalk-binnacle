<script lang="ts">
import { resolveToggleDescription, type VisibilityToggleProps } from './visibility-toggle';

// A full-width "Show X on chart" toggle: the in-panel control that mirrors a layer's visibility (the
// Layers eye stays the source of truth). Shared so every panel that surfaces its own layer reads
// identically. Reuses the .btn lit-state vocabulary, so it themes correctly with no extra styling.
interface Props extends VisibilityToggleProps {
  label: string;
}

const { visible, label, onToggle, disabled = false, description, describedBy }: Props = $props();

const ownDescriptionId = $props.id();
const described = $derived(
  resolveToggleDescription({ description, describedBy }, ownDescriptionId),
);
</script>

<button
  type="button"
  class="btn show-on-chart"
  class:is-on={visible}
  aria-pressed={visible}
  aria-describedby={described.describedBy}
  title={description ?? label}
  {disabled}
  onclick={() => onToggle(!visible)}
>
  {label}
</button>
{#if described.ownText}
  <span id={described.describedBy} class="visually-hidden">{described.ownText}</span>
{/if}

<style>
.show-on-chart {
  inline-size: 100%;
}
</style>
