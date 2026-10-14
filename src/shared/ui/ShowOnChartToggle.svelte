<script lang="ts">
import LayerToggle from './LayerToggle.svelte';
import type { VisibilityToggleProps } from './visibility-toggle';

// A full-width "Show X on chart" row that mirrors a layer's visibility (Layers stays the source of
// truth). It renders LayerToggle, so every visibility control in the app is one switch.
interface Props extends VisibilityToggleProps {
  label: string;
}

const props: Props = $props();
</script>

<div class="show-on-chart">
  <LayerToggle {...props} />
</div>

<style>
.show-on-chart {
  display: flex;
  inline-size: 100%;
  min-block-size: var(--control-size);
}
</style>
