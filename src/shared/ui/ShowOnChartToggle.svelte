<script lang="ts">
// A full-width "Show X on chart" toggle: the in-panel control that mirrors a layer's visibility (the
// Layers eye stays the source of truth). Shared so every panel that surfaces its own layer reads
// identically. Reuses the .btn lit-state vocabulary, so it themes correctly with no extra styling.
interface Props {
  visible: boolean;
  label: string;
  onToggle: (visible: boolean) => void;
  disabled?: boolean;
  // An optional plain-language hover and focus tooltip, matching LayerToggle.
  description?: string;
}

const { visible, label, onToggle, disabled = false, description }: Props = $props();
</script>

<button
  type="button"
  class="btn show-on-chart"
  class:is-on={visible}
  aria-pressed={visible}
  title={description ?? label}
  {disabled}
  onclick={() => onToggle(!visible)}
>
  {label}
</button>

<style>
.show-on-chart {
  inline-size: 100%;
}
</style>
