<script lang="ts">
import type { DisplaySettingsController } from './display-settings.svelte';

interface Props {
  controller: Pick<DisplaySettingsController, 'dim'>;
}

const { controller }: Props = $props();
</script>

{#if controller.dim > 0}
  <div class="dim-overlay" style:opacity={controller.dim} aria-hidden="true"></div>
{/if}

<style>
/* Simulates turning a backlight down past its hardware minimum, so the layer is physically black
   in every theme rather than a theme token. Pointer-events stays none so every control beneath
   keeps working, and the controller's opacity ceiling keeps alarms distinguishable. */
.dim-overlay {
  position: fixed;
  inset: 0;
  background: #000;
  pointer-events: none;
  /* One step past the ladder's top so menus and panels dim with the chart. Native top-layer
     dialogs (the MOB confirm) still paint above it at full brightness, which an emergency
     surface should. */
  z-index: calc(var(--z-menu) + 1);
}
</style>
