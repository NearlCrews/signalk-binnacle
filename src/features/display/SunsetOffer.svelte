<script lang="ts">
import type { DisplaySettingsController } from './display-settings.svelte';

interface Props {
  controller: DisplaySettingsController;
}

const { controller }: Props = $props();
</script>

{#if controller.sunsetOffer}
  <!-- role=status, not alert: a theme suggestion must never interrupt like a safety call. -->
  <div class="sunset-offer surface-elevated" role="status">
    <p class="prompt">Sunset. Switch to the night theme?</p>
    <div class="actions">
      <button type="button" class="btn" onclick={() => controller.acceptSunsetOffer()}>
        Switch
      </button>
      <button type="button" class="btn btn-ghost" onclick={() => controller.dismissSunsetOffer()}>
        Not now
      </button>
    </div>
  </div>
{/if}

<style>
.sunset-offer {
  position: fixed;
  inset-block-end: calc(var(--space-6) + var(--system-bar-clearance, 0px));
  inset-inline-start: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  z-index: var(--z-menu);
}
.prompt {
  margin: 0;
  font-size: var(--text-sm);
}
.actions {
  display: flex;
  gap: var(--space-1);
}
</style>
